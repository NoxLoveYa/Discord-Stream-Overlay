/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow, desktopCapturer, screen } from "electron";

export interface OverlayConfig {
    color: string;
    width: number;
}

let overlay: BrowserWindow | null = null;
let loadedKey = "";

function overlayHtml({ color, width }: OverlayConfig) {
    // renderer input is untrusted: only allow a hex colour and a bounded integer
    const safeColor = /^#[0-9a-f]{3,8}$/i.test(color) ? color : "#ff0000";
    const safeWidth = Math.min(64, Math.max(1, Math.round(Number(width)) || 4));

    // drawOverlays() equivalent: add further overlay elements here
    return `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">
<div style="position:fixed;inset:0;box-sizing:border-box;border:${safeWidth}px solid ${safeColor}"></div>
</body></html>`;
}

// Discord ids look like "screen-handle:1339034295"; the name comes from STREAM_START ("Screen 1")
async function pickDisplay(sourceId: string | null, sourceName: string | null) {
    const displays = screen.getAllDisplays();
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
    const num = sourceId?.match(/(\d+)$/)?.[1];
    const byId = displays.find(d => String(d.id) === num);
    if (byId) return { display: byId, match: "display-id" };

    const displayId = sources.find(s => s.id === sourceId || s.name === sourceName)?.display_id;
    const byCapturer = displays.find(d => String(d.id) === displayId);
    if (byCapturer) return { display: byCapturer, match: "desktopCapturer" };

    return { display: screen.getPrimaryDisplay(), match: "primary-fallback" };
}

function createOverlay() {
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
    win.on("closed", () => {
        overlay = null;
        loadedKey = "";
    });
    return win;
}

export async function show(_, sourceId: string | null, sourceName: string | null, config: OverlayConfig) {
    const { display, match } = await pickDisplay(sourceId, sourceName);

    if (!overlay || overlay.isDestroyed()) overlay = createOverlay();
    overlay.setBounds(display.bounds);

    const key = JSON.stringify(config);
    if (key !== loadedKey) {
        await overlay.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(overlayHtml(config)));
        loadedKey = key;
    }
    overlay.showInactive();

    return { match, displayId: display.id, bounds: display.bounds };
}

export function hide() {
    if (overlay && !overlay.isDestroyed()) overlay.destroy();
    overlay = null;
    loadedKey = "";
}
