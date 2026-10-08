/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./layout.css";

import { Paragraph } from "@components/Paragraph";
import { Native, plain, settings, updateValues } from "@plugins/streamOverlay.desktop/settings";
import type { OverlayInfo } from "@plugins/streamOverlay.desktop/types";
import { MediaEngineStore, useEffect, useRef } from "@webpack/common";

const PICTURE_WIDTH = 1280;
const BACKGROUND_MS = 750;

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** The overlay arrives as premultiplied BGRA; a canvas wants RGBA that is not premultiplied. */
function paint(canvas: HTMLCanvasElement, bitmap: Uint8Array, width: number, height: number) {
    const bytes = bitmap.byteOffset & 3 ? bitmap.slice() : bitmap;
    const src = new Uint32Array(bytes.buffer, bytes.byteOffset, width * height);
    const out = new Uint32Array(width * height);

    for (let i = 0; i < out.length; i++) {
        const v = src[i];
        const a = v >>> 24;
        if (a === 255) {
            out[i] = (v & 0xff00ff00) | ((v & 0xff) << 16) | ((v >>> 16) & 0xff);
        } else if (a) {
            const r = Math.min(255, (((v >>> 16) & 0xff) * 255 / a) | 0);
            const g = Math.min(255, (((v >>> 8) & 0xff) * 255 / a) | 0);
            const b = Math.min(255, ((v & 0xff) * 255 / a) | 0);
            out[i] = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
        }
    }

    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(out.buffer), width, height), 0, 0);
}

/**
 * The enabled overlays as they are drawn over the screen being shared (or the main screen), rendered by an offscreen
 * window in the main process. The mouse over the picture is handed to that window, which lets the draggable overlays be
 * moved and resized the way Alt + Caps does on screen; where they end up is saved in the settings.
 */
export function Layout({ overlays }: { overlays: OverlayInfo[]; }) {
    const { overlayRoot, enabledOverlays, overlayValues } = settings.use(["overlayRoot", "enabledOverlays", "overlayValues"]);
    const canvas = useRef<HTMLCanvasElement>(null);
    const background = useRef<HTMLImageElement>(null);
    const pending = useRef<{ x: number; y: number; } | null>(null);
    const raf = useRef(0);

    const enabled = [...enabledOverlays];
    const draggable = overlays.filter(o => o.draggable && enabled.includes(o.name));

    // render what is on, again whenever it changes (also when a drag has just been saved)
    const state = JSON.stringify([overlayRoot, enabled, plain(overlayValues)]);
    useEffect(() => {
        const sourceId = MediaEngineStore.getGoLiveSource()?.desktopSource?.id ?? null;
        Native.layoutShow(sourceId, overlayRoot, enabled, plain(overlayValues));
    }, [state]);

    useEffect(() => {
        let alive = true;
        let frameRequest = 0;
        let backgroundTimer: ReturnType<typeof setTimeout> | undefined;
        let backgroundUrl = "";

        // one request per frame of this window, and the window renders at the refresh rate of the monitor it draws on
        const tick = async () => {
            try {
                const { frame, changes } = await Native.layoutFrame(PICTURE_WIDTH);
                if (!alive) return;

                if (Object.keys(changes).length) {
                    updateValues(values => {
                        for (const [name, saved] of Object.entries(changes)) Object.assign(values[name] ??= {}, saved);
                    });
                }
                if (frame && canvas.current) paint(canvas.current, frame.bitmap, frame.width, frame.height);
            } finally {
                if (alive) frameRequest = requestAnimationFrame(tick);
            }
        };

        // what the stream shows behind the overlays: a screenshot of the monitor, refreshed a few times a second
        const refreshBackground = async () => {
            try {
                const jpeg = await Native.layoutBackground(PICTURE_WIDTH);
                if (!alive) return;
                if (jpeg && background.current) {
                    const url = URL.createObjectURL(new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }));
                    background.current.src = url;
                    if (backgroundUrl) URL.revokeObjectURL(backgroundUrl);
                    backgroundUrl = url;
                }
            } finally {
                if (alive) backgroundTimer = setTimeout(refreshBackground, BACKGROUND_MS);
            }
        };

        tick();
        refreshBackground();
        return () => {
            alive = false;
            cancelAnimationFrame(frameRequest);
            clearTimeout(backgroundTimer);
            if (backgroundUrl) URL.revokeObjectURL(backgroundUrl);
            cancelAnimationFrame(raf.current);
            Native.layoutHide();
        };
    }, []);

    const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
    };

    // moves are sent at most once per frame
    const flushMove = () => {
        raf.current = 0;
        if (pending.current) Native.layoutPointer("move", pending.current.x, pending.current.y);
        pending.current = null;
    };

    return (
        <div>
            <Paragraph size="sm" defaultColor={false} className="vc-so-muted vc-so-hint">
                {draggable.length
                    ? `Drag ${draggable.map(o => o.title).join(" or ")} to move it, or drag its corner to resize it. Behind the overlays is the screen being shared (or your main screen), a few times a second.`
                    : "No overlay that can be moved is on. Turn on one that is draggable (the keyboard or the mouse, for example) to place it here."}
            </Paragraph>

            <div className="vc-so-stage">
                <img ref={background} className="vc-so-stage-background" alt="" draggable={false} />
                <canvas
                    ref={canvas}
                    width={16}
                    height={9}
                    className="vc-so-stage-canvas"
                    onPointerDown={e => {
                        if (e.button !== 0) return;
                        e.currentTarget.setPointerCapture(e.pointerId);
                        cancelAnimationFrame(raf.current);
                        flushMove();
                        Native.layoutPointer("down", at(e).x, at(e).y);
                    }}
                    onPointerMove={e => {
                        pending.current = at(e);
                        raf.current ||= requestAnimationFrame(flushMove);
                    }}
                    onPointerUp={e => {
                        cancelAnimationFrame(raf.current);
                        flushMove();
                        Native.layoutPointer("up", at(e).x, at(e).y);
                    }}
                    onPointerCancel={e => Native.layoutPointer("up", at(e).x, at(e).y)}
                />
            </div>
        </div>
    );
}
