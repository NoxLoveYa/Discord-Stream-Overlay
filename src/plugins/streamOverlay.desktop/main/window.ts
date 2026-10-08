/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Manifest, OverlayValue, OverlayValues } from "@plugins/streamOverlay.desktop/types";
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
import type { StreamSink } from "./nvenc";
import { resolveValue, settingsScript } from "./values";

const OFFSCREEN_FPS = 30;

interface Entry {
    name: string;
    file: string;
    manifest: Manifest;
    values: Record<string, OverlayValue>;
}

const hostPath = () => join(app.getPath("temp"), "vencord-streamoverlay-host.html");

/**
 * The transparent, click-through window drawn over the shared screen, and everything that depends on what it shows. In
 * "stream only" mode the window is never on screen: its pixels are rendered offscreen and handed to the stream sink.
 */
export class OverlayWindow {
    private win: BrowserWindow | null = null;
    private offscreen = false;
    private shown = false;
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

    /** Mouse from the Layout tab, as fractions of the picture: the offscreen page has no real mouse. */
    pointer(kind: "move" | "down" | "up", fx: number, fy: number) {
        const win = this.live();
        if (!win || !this.offscreen) return;

        const { width, height } = win.getContentBounds();
        const x = Math.round(Math.min(1, Math.max(0, fx)) * width);
        const y = Math.round(Math.min(1, Math.max(0, fy)) * height);
        const { webContents } = win;

        // the page only lets the mouse through to an overlay once it has seen the cursor over it
        webContents.executeJavaScript(`window.__streamOverlayPointer?.(${x}, ${y})`).catch(() => { });
        webContents.sendInputEvent(kind === "move"
            ? { type: "mouseMove", x, y }
            : { type: kind === "down" ? "mouseDown" : "mouseUp", x, y, button: "left", clickCount: 1 });
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

        if (this.exiting) {
            this.exiting = false;
            this.loadedKey = "";
        }

        const overlays = found.map((o, i) => ({
            file: o.file,
            keys: manifests[i].keys,
            interactive: manifests[i].interactive.length > 0,
            mouse: manifests[i].mouse
        }));
        const key = JSON.stringify(overlays);
        const fresh = key !== this.loadedKey;
        if (fresh) {
            writeFileSync(hostPath(), hostHtml(overlays));
            await win.loadURL(pathToFileURL(hostPath()).href);
            this.loadedKey = key;
        }

        // before it becomes visible, so the first frame already has the right values
        await this.applySettings();
        if (!offscreen) win.showInactive();
        this.shown = true;
        if (fresh) await playEnter(win);

        // an offscreen overlay cannot be dragged, so there is no cursor to relay
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
        if (this.offscreen) {
            win.webContents.setFrameRate(OFFSCREEN_FPS);
            win.webContents.on("paint", (_, __, image) => this.stream.frame(image));
        }
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
