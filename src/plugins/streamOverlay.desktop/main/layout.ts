/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { desktopCapturer, type Display, type NativeImage } from "electron";

import type { StreamSink } from "./nvenc";

let shooting = false;

/** A JPEG of what is on the display right now (what the stream shows, without the overlays), or null. */
export async function screenshot(display: Display, width: number) {
    if (shooting) return null;
    shooting = true;
    try {
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(w * display.bounds.height / display.bounds.width));
        const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: w, height: h } });
        return sources.find(s => s.display_id === String(display.id))?.thumbnail.toJPEG(80) ?? null;
    } catch {
        return null;
    } finally {
        shooting = false;
    }
}

/** Keeps the latest frame of the Layout tab's offscreen window until the settings page comes to look at it. */
export class LayoutSink implements StreamSink {
    private image: NativeImage | null = null;
    private version = 0;
    private taken = 0;

    start() {
        return Promise.resolve(true);
    }

    frame(image: NativeImage) {
        this.image = image;
        this.version++;
    }

    stop() {
        this.image = null;
    }

    /** The frame scaled down to `width`, or null when nothing changed since the last one. */
    take(width: number) {
        if (!this.image || this.version === this.taken) return null;
        this.taken = this.version;

        const full = this.image.getSize();
        const scaled = this.image.resize({ width: Math.min(Math.max(1, Math.round(width)), full.width), quality: "good" });
        const { width: w, height: h } = scaled.getSize();
        return { bitmap: scaled.toBitmap(), width: w, height: h };
    }
}
