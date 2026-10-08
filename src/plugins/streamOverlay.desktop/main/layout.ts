/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { desktopCapturer, type Display, type NativeImage } from "electron";

import type { StreamSink } from "./nvenc";

const WAIT_MS = 100;

let shooting = false;

/** A JPEG of the display as it is now, at its own resolution. Null while another is being taken; throws when there is none. */
export async function screenshot(display: Display) {
    if (shooting) return null;
    shooting = true;
    try {
        const w = Math.max(1, Math.round(display.size.width * display.scaleFactor));
        const h = Math.max(1, Math.round(display.size.height * display.scaleFactor));
        const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: w, height: h } });

        const source = sources.find(s => s.display_id === String(display.id)) ?? (sources.length === 1 ? sources[0] : undefined);
        if (!source) throw new Error(`no screen source for display ${display.id} (sources: ${sources.map(s => `${s.id} / ${s.display_id}`).join(", ") || "none"})`);
        if (source.thumbnail.isEmpty()) throw new Error(`the screenshot of ${source.id} is empty`);
        return source.thumbnail.toJPEG(80);
    } finally {
        shooting = false;
    }
}

/** Keeps the latest frame of the Layout tab's window until the settings page asks for it. */
export class LayoutSink implements StreamSink {
    private image: NativeImage | null = null;
    private version = 0;
    private taken = 0;
    private wake: (() => void) | null = null;

    start() {
        return Promise.resolve(true);
    }

    frame(image: NativeImage) {
        this.image = image;
        this.version++;
        this.wake?.();
    }

    stop() {
        this.image = null;
    }

    /**
     * The frame at the size it was drawn. When there is nothing new it waits for the next frame, so the page gets each one
     * as it is drawn instead of looking for it on a timer; null when nothing came in time.
     */
    async take() {
        if (this.stale()) {
            await new Promise<void>(resolve => {
                const timer = setTimeout(resolve, WAIT_MS);
                this.wake = () => {
                    clearTimeout(timer);
                    resolve();
                };
            });
            this.wake = null;
            if (this.stale()) return null;
        }
        this.taken = this.version;

        const { width, height } = this.image!.getSize();
        return { bitmap: this.image!.toBitmap(), width, height };
    }

    private stale() {
        return !this.image || this.version === this.taken;
    }
}
