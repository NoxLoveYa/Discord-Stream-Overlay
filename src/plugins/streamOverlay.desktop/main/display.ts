/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { desktopCapturer, screen } from "electron";

/**
 * Finds the display being shared. Discord's source ids look like "screen-handle:1339034295" and the name comes from
 * STREAM_START ("Screen 1"), which matches the name Electron gives the same screen.
 */
export async function pickDisplay(sourceId: string | null, sourceName: string | null) {
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
