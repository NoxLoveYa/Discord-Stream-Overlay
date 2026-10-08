/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { desktopCapturer, type Display, type NativeImage } from "electron";

import type { StreamSink } from "./nvenc";

let shooting = false;

/** A JPEG of the display as it is now, or null. */
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

/** Keeps the latest frame of the Layout tab's window until the settings page asks for it. */
export class LayoutSink implements StreamSink {
    private image: NativeImage | null = null;
    private version = 0;
    private taken = 0;
    private takenWidth = 0;

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

    /** The frame scaled to `width`, or null when neither it nor the width changed since the last call. */
    take(width: number) {
        if (!this.image || (this.version === this.taken && width === this.takenWidth)) return null;
        this.taken = this.version;
        this.takenWidth = width;

        // the window is already rendered at about this size; resizing is only for when it came out a lot bigger
        const full = this.image.getSize();
        const picture = full.width > width * 1.25 ? this.image.resize({ width: Math.round(width), quality: "good" }) : this.image;
        const { width: w, height: h } = picture.getSize();
        return { bitmap: picture.toBitmap(), width: w, height: h };
    }
}
