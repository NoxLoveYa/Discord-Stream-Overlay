/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Manifest, MediaState, OverlayValue, OverlayValues } from "@plugins/streamOverlay.desktop/types";
import { app, BrowserWindow, type Display } from "electron";
import { writeFileSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";

import { playEnter, playExit } from "./animations";
import { pickDisplay } from "./display";
import { findOverlays } from "./folder";
import { hostHtml } from "./host";
import { OverlayInput } from "./input";
import { readManifest, unionKeys } from "./manifest";
import { SAMPLE_MEDIA } from "./media";
import type { StreamSink } from "./nvenc";
import { resolveValue, settingsScript } from "./values";

const OFFSCREEN_FPS = 30;
const LAYOUT_FPS = 60;

interface Entry {
    name: string;
    file: string;
    manifest: Manifest;
    values: Record<string, OverlayValue>;
}

const hostPath = (layout: boolean) => join(app.getPath("temp"), `vencord-streamoverlay-host${layout ? "-layout" : ""}.html`);

/**
 * The transparent, click-through window drawn over the shared screen, and everything that depends on what it shows. In
 * "stream only" mode the window is never on screen: its pixels are rendered offscreen and handed to the stream sink.
 */
export class OverlayWindow {
    private win: BrowserWindow | null = null;
    private offscreen = false;
    private shown = false;
    private suspended = false;
    private pressed = false;
    private media: MediaState | null = null;
    /** what is loaded, in iframe order */
    private entries: Entry[] = [];
    private loadedKey = "";
    private display: { key: string; display: Display; match: string; } | null = null;
    /** bumped by show() and hide(), so an exit animation still playing can tell it was superseded */
    private hideToken = 0;
    /** the page has been played backwards and must be reloaded before it is shown again */
    private exiting = false;
    private readonly input = new OverlayInput(() => this.live(), () => this.entries.map(e => e.manifest.interactive), () => this.armed());

    /** `layout`: the window of the Layout tab, where the draggable overlays are always ready to be moved */
    constructor(private readonly stream: StreamSink, private readonly layout = false) { }

    /** Mouse from the Layout tab, as fractions of the picture (an offscreen page has no real mouse). */
    pointer(kind: "move" | "down" | "up", fx: number, fy: number) {
        const win = this.live();
        const screenSize = this.display?.display.bounds;
        if (!win || !screenSize || !this.offscreen) return;

        const clamp = (v: number) => Math.min(1, Math.max(0, v));
        const { width, height } = win.getContentBounds();
        const x = Math.round(clamp(fx) * width);
        const y = Math.round(clamp(fy) * height);
        const { webContents } = win;

        // the page only lets the mouse through to an overlay once it has seen the cursor over it, in the units of the
        // full screen (the window may be smaller); a drag in progress already has it
        if (kind !== "move" || !this.pressed) {
            webContents.executeJavaScript(`window.__streamOverlayPointer?.(${Math.round(clamp(fx) * screenSize.width)}, ${Math.round(clamp(fy) * screenSize.height)})`).catch(() => { });
        }
        if (kind !== "move") this.pressed = kind === "down";
        // a move without the button flag reads as a release to the page, and a drag would stop
        webContents.sendInputEvent(kind === "move"
            ? { type: "mouseMove", x, y, ...this.pressed && { button: "left", modifiers: ["leftbuttondown"] } }
            : { type: kind === "down" ? "mouseDown" : "mouseUp", x, y, button: "left", clickCount: 1 });
    }

    currentDisplay() {
        return this.display?.display ?? null;
    }

    /** Takes the on-screen window off the screen (the Layout tab shows it instead) until resume(). */
    suspend() {
        this.suspended = true;
        if (!this.offscreen) this.live()?.hide();
    }

    resume() {
        this.suspended = false;
        if (this.shown && !this.offscreen) this.live()?.showInactive();
    }

    /** The track that is playing, for the overlays that asked for it. */
    setMedia(state: MediaState | null) {
        this.media = state;
        return this.pushMedia();
    }

    private pushMedia() {
        const win = this.live();
        if (!win) return Promise.resolve();

        // the Layout tab has no music of its own to show: a sample gives the overlay something to drag
        const state = this.media ?? (this.layout ? SAMPLE_MEDIA() : null);
        return win.webContents.executeJavaScript(`window.__streamOverlayMedia?.(${JSON.stringify(state)})`).catch(() => { });
    }

    private armed() {
        return this.layout ? this.entries.flatMap(e => e.manifest.draggable ? e.manifest.interactive : []) : [];
    }

    async show(sourceId: string | null, sourceName: string | null, root: string, names: string[], values: OverlayValues, streamOnly = false) {
        this.hideToken++;

        const found = findOverlays(root, names);
        if (!found.length) {
            this.destroy();
            return null;
        }

        // when the encoder cannot be reached the overlay stays on screen rather than disappearing
        const offscreen = streamOnly && await this.stream.start();
        if (offscreen !== this.offscreen) {
            this.destroy();
            this.offscreen = offscreen;
        }

        const manifests = found.map(o => readManifest(o.file));
        this.entries = found.map((o, i) => ({ ...o, manifest: manifests[i], values: values?.[o.name] ?? {} }));

        const { display, match } = await this.displayFor(sourceId, sourceName);
        const win = this.window();

        win.setBounds(display.bounds);
        if (offscreen) win.webContents.frameRate = this.layout ? LAYOUT_FPS : OFFSCREEN_FPS;

        if (this.exiting) {
            this.exiting = false;
            this.loadedKey = "";
        }

        const overlays = found.map((o, i) => ({
            file: o.file,
            keys: manifests[i].keys,
            interactive: manifests[i].interactive.length > 0,
            mouse: manifests[i].mouse,
            media: manifests[i].media
        }));
        const key = JSON.stringify(overlays);
        const fresh = key !== this.loadedKey;
        if (fresh) {
            writeFileSync(hostPath(this.layout), hostHtml(overlays));
            await win.loadURL(pathToFileURL(hostPath(this.layout)).href);
            this.loadedKey = key;
        }

        // before it becomes visible, so the first frame already has the right values
        await this.applySettings();
        await this.pushMedia();
        if (!offscreen && !this.suspended) win.showInactive();
        this.shown = true;
        if (fresh) await playEnter(win);

        const keys = unionKeys(manifests);
        this.input.sync(keys, manifests.some(m => m.mouse), !offscreen && manifests.some(m => m.interactive.length > 0), fresh);
        if (this.layout) await win.webContents.executeJavaScript(`window.__streamOverlayKeys?.(${JSON.stringify(this.armed())})`).catch(() => { });

        return { match, displayId: display.id, bounds: display.bounds, overlays: found.length, keys: keys.length, streamOnly: offscreen };
    }

    async hide(animate = true) {
        const token = ++this.hideToken;
        const win = this.live();

        if (animate && win && this.shown) {
            this.exiting = true;
            await playExit(win);
            if (token !== this.hideToken) return;
        }

        this.destroy();
    }

    reload() {
        const win = this.live();
        this.loadedKey = "";
        win?.webContents.once("did-finish-load", () => void this.applySettings());
        win?.webContents.reloadIgnoringCache();
        this.input.restart();
    }

    /** Values the overlays asked to save since the last call, validated against what each of them declared. */
    async takeChanges() {
        const changes: OverlayValues = {};
        const win = this.live();
        if (!win) return changes;

        const saves: { i: number; values: Record<string, unknown>; }[] =
            await win.webContents.executeJavaScript("window.__streamOverlayTakeSaves?.() ?? []").catch(() => []);

        for (const { i, values } of saves) {
            const entry = this.entries[i];
            if (!entry || !values || typeof values !== "object") continue;

            for (const setting of entry.manifest.settings) {
                if (!Object.prototype.hasOwnProperty.call(values, setting.id)) continue;
                (changes[entry.name] ??= {})[setting.id] = resolveValue(setting, values[setting.id]);
            }
        }
        return changes;
    }

    private live() {
        return this.win && !this.win.isDestroyed() ? this.win : null;
    }

    private window() {
        return this.live() ?? (this.win = this.create());
    }

    private create() {
        const win = new BrowserWindow({
            show: false,
            transparent: true,
            backgroundColor: "#00000000",
            frame: false,
            hasShadow: false,
            resizable: false,
            movable: false,
            focusable: false,
            skipTaskbar: true,
            fullscreenable: false,
            alwaysOnTop: true,
            webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: this.offscreen }
        });
        win.setAlwaysOnTop(true, "screen-saver");
        win.setIgnoreMouseEvents(true);
        // the dirty rectangle is only trusted when pixels and window units are the same thing (no display scaling)
        // a paint can still come after the window was destroyed
        if (this.offscreen) win.webContents.on("paint", (_, dirty, image) => {
            if (win.isDestroyed()) return;
            this.stream.frame(image, image.getSize().width === win.getContentSize()[0] ? dirty : undefined);
        });
        win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        win.webContents.on("will-navigate", e => e.preventDefault());
        win.on("closed", () => {
            this.win = null;
            this.loadedKey = "";
            this.exiting = false;
            this.input.stop();
        });
        return win;
    }

    private destroy() {
        if (this.offscreen) this.stream.stop();
        this.input.stop();
        this.live()?.destroy();
        this.win = null;
        this.shown = false;
        this.entries = [];
        this.loadedKey = "";
        this.display = null;
        this.exiting = false;
    }

    // the display only changes when the shared source does
    private async displayFor(sourceId: string | null, sourceName: string | null) {
        const key = `${sourceId}|${sourceName}`;
        if (this.display?.key !== key) this.display = { key, ...await pickDisplay(sourceId, sourceName) };
        return this.display;
    }

    private applySettings() {
        const win = this.live();
        if (!win) return Promise.resolve([]);

        const frames = win.webContents.mainFrame.framesInSubtree;
        return Promise.all(this.entries.map(({ file, manifest, values }) => {
            const url = pathToFileURL(file).href.toLowerCase();
            const frame = frames.find(f => f.url.toLowerCase() === url);
            if (!frame || !manifest.settings.length) return;
            return frame.executeJavaScript(settingsScript(manifest.settings, values)).catch(() => { });
        }));
    }
}
