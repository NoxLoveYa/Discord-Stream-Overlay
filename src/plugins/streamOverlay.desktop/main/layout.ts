/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { NativeImage } from "electron";

import type { StreamSink } from "./nvenc";

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
