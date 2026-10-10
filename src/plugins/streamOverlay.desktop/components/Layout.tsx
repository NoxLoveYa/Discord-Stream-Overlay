/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./layout.css";

import { Paragraph } from "@components/Paragraph";
import { clamp } from "@plugins/streamOverlay.desktop/main/values";
import { createGl } from "@plugins/streamOverlay.desktop/painter";
import { Native, plain, saveOverlayChanges, settings } from "@plugins/streamOverlay.desktop/settings";
import type { OverlayInfo } from "@plugins/streamOverlay.desktop/types";
import { Logger } from "@utils/Logger";
import { MediaEngineStore, useEffect, useRef, useState } from "@webpack/common";
import type { PointerEvent, SVGProps } from "react";

import { IconButton } from "./IconButton";

const logger = new Logger("StreamOverlay");

const CHANGES_MS = 150;
const RETRY_MS = 200;

const strokeIcon = (path: string) => (props: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
        <path d={path} />
    </svg>
);

const ExpandIcon = strokeIcon("M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7");
const CollapseIcon = strokeIcon("M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7");

const leaveFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { /* already out of it */ });
};

function createPainter(canvas: HTMLCanvasElement) {
    const gl = createGl(canvas);
    if (!gl) return null;

    return (bitmap: Uint8Array, width: number, height: number) => {
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
            canvas.style.setProperty("--ratio", String(width / height));
        }
        gl.viewport(0, 0, width, height);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
}

export function Layout({ overlays }: { overlays: OverlayInfo[]; }) {
    const { overlayRoot, enabledOverlays, overlayValues, globalFont } = settings.use(["overlayRoot", "enabledOverlays", "overlayValues", "globalFont"]);
    const canvas = useRef<HTMLCanvasElement>(null);
    const painter = useRef<ReturnType<typeof createPainter>>(null);
    const background = useRef<HTMLImageElement>(null);
    const stage = useRef<HTMLDivElement>(null);
    const [expanded, setExpanded] = useState(false);
    const nativeFullscreen = useRef(false);

    const enabled = [...enabledOverlays];
    const draggable = overlays.filter(o => o.draggable && enabled.includes(o.name));

    // the screen behind the overlays is a still, taken once the first show says which screen it is
    const backgroundUrl = useRef("");
    const backgroundTaken = useRef(false);
    const takeBackground = async () => {
        if (backgroundTaken.current) return;
        backgroundTaken.current = true;

        const jpeg = await Native.layoutBackground().catch(e => {
            logger.error("no screenshot for the layout", e);
            return null;
        });
        if (!jpeg || !background.current) {
            backgroundTaken.current = false;
            return;
        }
        backgroundUrl.current = URL.createObjectURL(new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }));
        background.current.src = backgroundUrl.current;
    };

    const state = JSON.stringify([overlayRoot, enabled, plain(overlayValues), globalFont]);
    useEffect(() => {
        const sourceId = MediaEngineStore.getGoLiveSource()?.desktopSource?.id ?? null;
        Native.layoutShow({ sourceId, root: overlayRoot, names: enabled, values: plain(overlayValues), globalFont }).then(takeBackground);
    }, [state]);

    useEffect(() => {
        let alive = true;

        // the main process answers once a frame is drawn, so each one shows as soon as it exists
        const receive = async () => {
            while (alive) {
                try {
                    const frame = await Native.layoutFrame();
                    if (!alive || !frame || !canvas.current) continue;

                    painter.current ??= createPainter(canvas.current);
                    painter.current?.(frame.bitmap, frame.width, frame.height);
                } catch {
                    await new Promise(resolve => setTimeout(resolve, RETRY_MS));
                }
            }
        };

        // not with every frame: it asks the overlay page, which is slower than the picture
        const collect = async () => {
            const changes = await Native.layoutChanges();
            if (alive && Object.keys(changes).length) saveOverlayChanges(changes);
        };
        const changesTimer = setInterval(collect, CHANGES_MS);

        receive();
        return () => {
            alive = false;
            clearInterval(changesTimer);
            if (backgroundUrl.current) URL.revokeObjectURL(backgroundUrl.current);
            leaveFullscreen();
            Native.layoutHide();
        };
    }, []);

    // as fractions of the picture, kept inside it: a captured pointer goes on outside the canvas, and the overlay stops at the edge
    const send = (kind: "move" | "down" | "up", e: PointerEvent<HTMLCanvasElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        Native.layoutPointer(kind, clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1));
    };

    // the real full screen when Discord allows it, the window covered by the picture otherwise
    const toggleExpanded = () => {
        if (expanded) {
            leaveFullscreen();
            setExpanded(false);
        } else {
            setExpanded(true);
            stage.current?.requestFullscreen().then(() => nativeFullscreen.current = true, () => { });
        }
    };

    useEffect(() => {
        if (!expanded) return;

        const onFullscreenChange = () => {
            if (document.fullscreenElement || !nativeFullscreen.current) return;
            nativeFullscreen.current = false;
            setExpanded(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            leaveFullscreen();
            setExpanded(false);
        };

        document.addEventListener("fullscreenchange", onFullscreenChange);
        addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("fullscreenchange", onFullscreenChange);
            removeEventListener("keydown", onKey);
        };
    }, [expanded]);

    return (
        <div>
            <Paragraph size="sm" defaultColor={false} className="vc-so-muted vc-so-hint">
                {draggable.length
                    ? `Drag ${draggable.map(o => o.title).join(" or ")} to move it, or drag its corner to resize it. Behind the overlays is a still of the screen being shared (or your main screen).`
                    : "No overlay that can be moved is on. Turn on one that is draggable (the keyboard or the mouse, for example) to place it here."}
            </Paragraph>

            <div ref={stage} className={`vc-so-stage${expanded ? " vc-so-expanded" : ""}`}>
                <div className="vc-so-view">
                    <img ref={background} className="vc-so-stage-background" alt="" draggable={false} />
                    <canvas
                        ref={canvas}
                        width={16}
                        height={9}
                        className="vc-so-stage-canvas"
                        onPointerDown={e => {
                            if (e.button !== 0) return;
                            e.currentTarget.setPointerCapture(e.pointerId);
                            send("down", e);
                        }}
                        onPointerMove={e => send("move", e)}
                        onPointerUp={e => send("up", e)}
                        onPointerCancel={e => send("up", e)}
                    />
                </div>

                <div className="vc-so-expand">
                    <IconButton label={expanded ? "Exit full screen" : "Full screen"} icon={expanded ? CollapseIcon : ExpandIcon} onClick={toggleExpanded} />
                </div>
            </div>
        </div>
    );
}
