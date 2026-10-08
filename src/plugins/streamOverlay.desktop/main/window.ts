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
import { resolveValue, settingsScript } from "./values";

interface Entry {
    name: string;
    file: string;
    manifest: Manifest;
    values: Record<string, OverlayValue>;
}

const hostPath = () => join(app.getPath("temp"), "vencord-streamoverlay-host.html");

/** The transparent, click-through window drawn over the shared screen, and everything that depends on what it shows. */
export class OverlayWindow {
    private win: BrowserWindow | null = null;
    /** what is loaded, in iframe order */
    private entries: Entry[] = [];
    private loadedKey = "";
    private display: { key: string; display: Display; match: string; } | null = null;
    /** bumped by show() and hide(), so an exit animation still playing can tell it was superseded */
    private hideToken = 0;
    /** the page has been played backwards and must be reloaded before it is shown again */
    private exiting = false;
    private readonly input = new OverlayInput(() => this.live(), () => this.entries.map(e => e.manifest.interactive));

    async show(sourceId: string | null, sourceName: string | null, root: string, names: string[], values: OverlayValues) {
        this.hideToken++;

        const found = findOverlays(root, names);
        if (!found.length) {
            this.destroy();
            return null;
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

        const files = found.map(o => o.file);
        const key = JSON.stringify(files);
        const fresh = key !== this.loadedKey;
        if (fresh) {
            writeFileSync(hostPath(), hostHtml(files, manifests.map(m => m.interactive.length > 0)));
            await win.loadURL(pathToFileURL(hostPath()).href);
            this.loadedKey = key;
        }

        // before it becomes visible, so the first frame already has the right values
        await this.applySettings();
        win.showInactive();
        if (fresh) await playEnter(win);

        const keys = unionKeys(manifests);
        this.input.sync(keys, manifests.some(m => m.interactive.length > 0), fresh);

        return { match, displayId: display.id, bounds: display.bounds, overlays: files.length, keys: keys.length };
    }

    async hide(animate = true) {
        const token = ++this.hideToken;
        const win = this.live();

        if (animate && win?.isVisible()) {
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
            frame: false,
            hasShadow: false,
            resizable: false,
            movable: false,
            focusable: false,
            skipTaskbar: true,
            fullscreenable: false,
            alwaysOnTop: true,
            webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
        });
        win.setAlwaysOnTop(true, "screen-saver");
        win.setIgnoreMouseEvents(true);
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
        this.input.stop();
        this.live()?.destroy();
        this.win = null;
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
