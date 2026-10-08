/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { LolState, Manifest, MediaState, OverlayValue, OverlayValues } from "@plugins/streamOverlay.desktop/types";
import { app, BrowserWindow, type Display } from "electron";
import { writeFileSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";

import { playEnter, playExit } from "./animations";
import { pickDisplay } from "./display";
import { findOverlays } from "./folder";
import { fontFaceCssFor, fontStyleScript } from "./fonts";
import { hostHtml } from "./host";
import { OverlayInput } from "./input";
import { subscribeLol } from "./lol";
import { readManifest, unionKeys } from "./manifest";
import { SAMPLE_MEDIA } from "./media";
import type { StreamSink } from "./nvenc";
import { clamp, effectiveFontValue, resolveValue, settingsScript } from "./values";

const OFFSCREEN_FPS = 30;
const LAYOUT_FPS = 60;

interface Entry {
    name: string;
    file: string;
    manifest: Manifest;
    values: Record<string, OverlayValue>;
}

const hostPath = (layout: boolean) => join(app.getPath("temp"), `vencord-streamoverlay-host${layout ? "-layout" : ""}.html`);

// The transparent, click-through window drawn over the shared screen. In "stream only" mode it is never on screen: its
// pixels are rendered offscreen and handed to the stream sink.
export class OverlayWindow {
    private win: BrowserWindow | null = null;
    private offscreen = false;
    private shown = false;
    private suspended = false;
    private pressed = false;
    private media: MediaState | null = null;
    private lol: LolState | null = null;
    private unsubLol: (() => void) | null = null;
    // in iframe order
    private entries: Entry[] = [];
    private loadedKey = "";
    private display: { key: string; display: Display; match: string; } | null = null;
    // bumped by show() and hide(), so an exit animation still playing can tell it was superseded
    private hideToken = 0;
    // the page has been played backwards and must be reloaded before it is shown again
    private exiting = false;
    private readonly input = new OverlayInput(() => this.live(), () => this.entries.map(e => e.manifest.interactive), () => this.armed());

    // `layout`: the window of the Layout tab, where the draggable overlays are always ready to be moved
    constructor(private readonly stream: StreamSink, private readonly layout = false) { }

    // fx/fy are fractions of the picture (an offscreen page has no real mouse)
    pointer(kind: "move" | "down" | "up", fx: number, fy: number) {
        const win = this.live();
        const screenSize = this.display?.display.bounds;
        if (!win || !screenSize || !this.offscreen) return;

        const rx = clamp(fx, 0, 1);
        const ry = clamp(fy, 0, 1);
        const { width, height } = win.getContentBounds();
        const x = Math.round(rx * width);
        const y = Math.round(ry * height);
        const { webContents } = win;

        // the page only lets the mouse through to an overlay once it has seen the cursor over it, in the units of the
        // full screen (the window may be smaller); a drag in progress already has it
        if (kind !== "move" || !this.pressed) {
            webContents.executeJavaScript(`window.__streamOverlayPointer?.(${Math.round(rx * screenSize.width)}, ${Math.round(ry * screenSize.height)})`).catch(() => { });
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

    // the Layout tab shows the overlays instead, until resume()
    suspend() {
        this.suspended = true;
        if (!this.offscreen) this.live()?.hide();
    }

    resume() {
        this.suspended = false;
        if (this.shown && !this.offscreen) this.live()?.showInactive();
    }

    setMedia(state: MediaState | null) {
        this.media = state;
        return this.pushMedia();
    }

    private push(hook: string, state: unknown) {
        return this.live()?.webContents.executeJavaScript(`window.${hook}?.(${JSON.stringify(state)})`).catch(() => { }) ?? Promise.resolve();
    }

    private pushMedia() {
        // the Layout tab has no music of its own to show: a sample gives the overlay something to drag
        return this.push("__streamOverlayMedia", this.media ?? (this.layout ? SAMPLE_MEDIA() : null));
    }

    private pushLol() {
        return this.push("__streamOverlayLol", this.lol);
    }

    // nothing polls while no overlay wants the live game
    private syncLol(wanted: boolean) {
        if (wanted && !this.unsubLol) {
            this.unsubLol = subscribeLol(state => {
                this.lol = state;
                void this.pushLol();
            });
        } else if (!wanted && this.unsubLol) {
            this.unsubLol();
            this.unsubLol = null;
            this.lol = null;
        }
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
            media: manifests[i].media,
            lol: manifests[i].lol
        }));
        const key = JSON.stringify(overlays);
        const fresh = key !== this.loadedKey;
        if (fresh) {
            writeFileSync(hostPath(this.layout), hostHtml(overlays));
            try {
                await win.loadURL(pathToFileURL(hostPath(this.layout)).href);
            } catch (e) {
                // hide() destroyed the window while the page was loading
                if (win.isDestroyed()) return null;
                throw e;
            }
            this.loadedKey = key;
        }
        if (win.isDestroyed()) return null;

        this.syncLol(manifests.some(m => m.lol));
        // before it becomes visible, so the first frame already has the right values
        await this.applySettings();
        await this.pushMedia();
        await this.pushLol();
        // hide() may have destroyed the window while the settings were applied
        if (win.isDestroyed()) return null;
        if (!offscreen && !this.suspended) win.showInactive();
        this.shown = true;
        if (fresh) await playEnter(win);
        // and again during the enter animation: the input helper must not restart for a window that is gone
        if (win.isDestroyed()) return null;

        const keys = unionKeys(manifests);
        this.input.sync(keys, manifests.some(m => m.mouse), !offscreen && manifests.some(m => m.interactive.length > 0), fresh);
        if (this.layout) await this.live()?.webContents.executeJavaScript(`window.__streamOverlayKeys?.(${JSON.stringify(this.armed())})`).catch(() => { });

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

    // validated against what each overlay declared
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
        if (this.offscreen) win.webContents.on("paint", (_, dirty, image) => {
            // a paint can still come after the window was destroyed
            if (win.isDestroyed()) return;
            // the dirty rectangle is only trusted when pixels and window units are the same thing (no display scaling)
            this.stream.frame(image, image.getSize().width === win.getContentSize()[0] ? dirty : undefined);
        });
        win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        win.webContents.on("will-navigate", e => e.preventDefault());
        win.on("closed", () => {
            // destroy() already cleaned up, and a newer window may have taken its place
            if (this.win !== win) return;
            this.syncLol(false);
            this.win = null;
            this.loadedKey = "";
            this.exiting = false;
            this.input.stop();
        });
        return win;
    }

    private destroy() {
        this.syncLol(false);
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

            const code = settingsScript(manifest.settings, values);
            // an imported font file lives in the fonts folder, not the overlay's: its @font-face is injected
            const font = manifest.settings.find(s => s.type === "font");
            const css = font ? fontFaceCssFor(effectiveFontValue(font, manifest.settings, values)) : null;
            return frame.executeJavaScript(code + fontStyleScript(css)).catch(() => { });
        }));
    }
}
