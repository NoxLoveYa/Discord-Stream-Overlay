/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { combineStatus, parseStatus } from "@plugins/streamOverlay.desktop/health";
import { app, BrowserWindow, ipcMain, type NativeImage, type Rectangle, type Session, type WebContents } from "electron";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const HELLO = "StreamOverlay:nvenc:hello";
const COMMAND = "StreamOverlay:nvenc:command";
const RESULT = "StreamOverlay:nvenc:result";
const FRAME = "StreamOverlay:nvenc:frame";
const RESYNC = "StreamOverlay:nvenc:resync";

const FRAME_GAP_MS = 16;
const ASK_TIMEOUT_MS = 5000;

const dir = () => join(app.getPath("userData"), "StreamOverlay", "nvenc");

/** Where the overlay's pixels go once they are rendered: into the encoder and onto the in-app preview. */
export interface StreamSink {
    /** Hooks the encoder and starts drawing into it. False when that is not possible (the overlay then stays on screen). */
    start(): Promise<boolean>;
    /** `dirty`: what changed since the previous frame, in pixels of `image`; left out when that is not known. */
    frame(image: NativeImage, dirty?: Rectangle): void;
    stop(): void;
}

const union = (a: Rectangle, b: Rectangle): Rectangle => {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};

/** `rect` inside a picture of width x height, whole pixels; null when nothing of it is left. */
function clip(rect: Rectangle, width: number, height: number): Rectangle | null {
    const x = Math.max(0, Math.floor(rect.x));
    const y = Math.max(0, Math.floor(rect.y));
    const right = Math.min(width, Math.ceil(rect.x + rect.width));
    const bottom = Math.min(height, Math.ceil(rect.y + rect.height));
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

// NVENC lives in Discord's renderer process, where only a preload script has Node: it loads the addon there. It also
// draws the overlay over the stream preview, a <video> fed natively that the encoder hook never touches.
const preload = (addon: string) => `
const { ipcRenderer } = require("electron");

if (process.type === "renderer" && location.hostname.endsWith("discord.com")) {
    let addon;
    const load = () => {
        if (addon) return addon;
        const module = { exports: {} };
        process.dlopen(module, ${JSON.stringify(addon)});
        return addon = module.exports;
    };

    // one canvas per preview sits over its <video>. The overlay (premultiplied BGRA) is uploaded to the GPU as it is and
    // the channels are swapped in a shader: the preview gets the full size picture with no per-pixel work here.
    // Frames arrive as a rectangle of the picture (or the whole of it): shadow is the whole picture, box what changed in
    // it since the previews were last drawn, and a preview that has not been drawn yet takes all of it
    const shown = new Map();
    let ratio = 0;
    let raf = 0;
    let active = false;
    let shadow = null;
    let fullW = 0;
    let fullH = 0;
    let box = null;
    let whole = false;
    let stale = false;
    let scratch = new Uint8Array(0);

    const VERTEX = "attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}";
    const FRAGMENT = "precision mediump float;varying vec2 uv;uniform sampler2D t;void main(){gl_FragColor=texture2D(t,uv).bgra;}";

    const painterFor = canvas => {
        const gl = canvas.getContext("webgl", { premultipliedAlpha: true, antialias: false });
        if (!gl) return null;

        const program = gl.createProgram();
        for (const [type, code] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]]) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, code);
            gl.compileShader(shader);
            gl.attachShader(program, shader);
        }
        gl.linkProgram(program);
        gl.useProgram(program);

        // one triangle that covers the canvas
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, "p");
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        for (const [name, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])
            gl.texParameteri(gl.TEXTURE_2D, name, value);

        let texW = 0;
        let texH = 0;

        // rect: { l, t, r, b } of what changed, or null for the whole picture
        return (picture, width, height, rect) => {
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }
            gl.viewport(0, 0, width, height);

            if (!rect || texW !== width || texH !== height) {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, picture);
                texW = width;
                texH = height;
            } else {
                const w = rect.r - rect.l;
                const h = rect.b - rect.t;
                if (scratch.length < w * h * 4) scratch = new Uint8Array(w * h * 4);
                for (let row = 0; row < h; row++) {
                    const from = ((rect.t + row) * width + rect.l) * 4;
                    scratch.set(picture.subarray(from, from + w * 4), row * w * 4);
                }
                gl.texSubImage2D(gl.TEXTURE_2D, 0, rect.l, rect.t, w, h, gl.RGBA, gl.UNSIGNED_BYTE, scratch.subarray(0, w * h * 4));
            }
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        };
    };

    // who the plugin says is using this Discord (it is in the page, which the preload shares with it)
    const self = () => document.documentElement.getAttribute("data-vc-stream-overlay-self") || "";

    // The call view puts every video in a tile that says whose it is (a user id; for a stream it may be the stream key,
    // which ends with the id of the one who streams). Somebody else's tile is somebody else's stream or camera. A video
    // outside a tile, or a tile without an id, says nothing: it stays, so the preview of your own stream is never lost.
    const ownedByOthers = v => {
        const me = self();
        const owner = v.closest("[data-selenium-video-tile]")?.getAttribute("data-selenium-video-tile");
        return !!me && !!owner && owner !== me && !owner.endsWith(":" + me);
    };

    // a console note when the videos that get the overlay change, to see what was picked and what was left alone
    let noted = "";
    const note = (kept, skipped) => {
        const text = kept + " / " + skipped;
        if (text === noted) return;
        noted = text;
        console.info("[StreamOverlay] the preview overlay is on " + kept + " video(s) and was left off " + skipped + " of somebody else's");
    };

    // videos shaped like the shared screen; the stream is fed natively, media in chats are files loaded over http(s)
    const previews = () => {
        let skipped = 0;
        const kept = [...document.querySelectorAll("video")].filter(v => {
            if (/^https?:/i.test(v.currentSrc || v.src) || v.closest('[data-list-id="chat-messages"]')) return false;
            if (!v.videoWidth || Math.abs(v.videoWidth / v.videoHeight - ratio) > 0.02) return false;
            if (ownedByOthers(v)) {
                skipped++;
                return false;
            }
            return true;
        }).filter(v => {
            const r = v.getBoundingClientRect();
            return r.width > 120 && r.height > 60 && getComputedStyle(v).visibility !== "hidden";
        });
        note(kept.length, skipped);
        return kept;
    };

    const place = () => {
        raf = 0;
        if (!ratio) return;

        const live = new Set(previews());
        let update = null;
        if (stale && live.size) {
            update = { whole, box };
            stale = false;
            whole = false;
            box = null;
        }

        for (const [video, canvas] of shown) {
            if (live.has(video)) continue;
            canvas.remove();
            shown.delete(video);
        }
        for (const video of live) {
            let canvas = shown.get(video);
            if (!canvas) {
                canvas = document.createElement("canvas");
                canvas.style.cssText = "position:fixed;pointer-events:none;z-index:999";
                document.body.append(canvas);
                shown.set(video, canvas);
                canvas.fresh = true;
            }

            // letterboxed inside the element
            const r = video.getBoundingClientRect();
            let w = r.width, h = r.height;
            if (w / h > ratio) w = h * ratio; else h = w / ratio;
            const s = canvas.style;
            s.left = r.left + (r.width - w) / 2 + "px";
            s.top = r.top + (r.height - h) / 2 + "px";
            s.width = w + "px";
            s.height = h + "px";

            if ((update || canvas.fresh) && shadow) {
                const rect = canvas.fresh || !update || update.whole ? null : update.box;
                canvas.fresh = false;
                try { (canvas.paint ??= painterFor(canvas))?.(shadow, fullW, fullH, rect); } catch { }
            }
        }
        raf = requestAnimationFrame(place);
    };

    const clear = () => {
        ratio = 0;
        shadow = null;
        box = null;
        whole = false;
        stale = false;
        for (const canvas of shown.values()) canvas.remove();
        shown.clear();
    };

    ipcRenderer.on(${JSON.stringify(COMMAND)}, (_, id, command) => {
        let text;
        try {
            text = String(load()[command]());
            if (command === "drawOn") active = true;
            if (command === "drawOff") {
                active = false;
                load().setOverlay();
                clear();
            }
        } catch (e) {
            text = "failed: " + (e && e.message || e);
        }
        ipcRenderer.send(${JSON.stringify(RESULT)}, id, text);
    });

    // the bitmap is the rectangle (x, y, width, height) of a picture of fw x fh; all of it when they are the same size
    ipcRenderer.on(${JSON.stringify(FRAME)}, (_, bitmap, width, height, x, y, fw, fh) => {
        if (!active) return;

        const part = width !== fw || height !== fh;
        // a rectangle can only go onto a picture that is already here: ask for the whole of it
        if (part && (!shadow || shadow.length !== fw * fh * 4)) {
            ipcRenderer.send(${JSON.stringify(RESYNC)});
            return;
        }

        let result = "ok";
        try {
            const native = load();
            result = part ? (native.updateOverlay ? native.updateOverlay(bitmap, x, y, width, height, fw, fh) : "resync") : native.setOverlay(bitmap, fw, fh);
        } catch { }
        if (result === "resync") ipcRenderer.send(${JSON.stringify(RESYNC)});

        // the previews are drawn from this copy, and only if one is on screen
        if (!part) {
            if (!shadow || shadow.length !== bitmap.length) shadow = new Uint8Array(bitmap.length);
            shadow.set(bitmap);
            box = null;
            whole = true;
        } else {
            for (let row = 0; row < height; row++)
                shadow.set(bitmap.subarray(row * width * 4, (row + 1) * width * 4), ((y + row) * fw + x) * 4);
            box = box
                ? { l: Math.min(box.l, x), t: Math.min(box.t, y), r: Math.max(box.r, x + width), b: Math.max(box.b, y + height) }
                : { l: x, t: y, r: x + width, b: y + height };
        }
        fullW = fw;
        fullH = fh;
        ratio = fw / fh;
        stale = true;
        if (!raf) raf = requestAnimationFrame(place);
    });

    ipcRenderer.send(${JSON.stringify(HELLO)});
}
`;

/** Drives the native addon (`nvenc/`) that hooks Discord's NVENC encoder, through a preload script in the renderer. */
export class Nvenc implements StreamSink {
    private readonly targets = new Set<WebContents>();
    private readonly pending = new Map<number, (text: string) => void>();
    private readonly registered = new WeakSet<Session>();
    private nextId = 1;
    private started = false;
    private image: NativeImage | null = null;
    // what changed in the image since the last frame was sent; whole says the next one has to carry all of it
    private dirty: Rectangle | null = null;
    private whole = true;
    private size = "";
    private timer: ReturnType<typeof setTimeout> | null = null;
    private lastSent = 0;

    constructor() {
        ipcMain.on(HELLO, event => {
            this.targets.add(event.sender);
            event.sender.once("destroyed", () => this.targets.delete(event.sender));
            this.resync();
        });
        // a renderer that got a rectangle without having the picture, or an addon that lost it
        ipcMain.on(RESYNC, () => this.resync());
        ipcMain.on(RESULT, (_, id: number, text: string) => {
            this.pending.get(id)?.(text);
            this.pending.delete(id);
        });

        // a page that is already open only gets the preload after a reload
        app.on("session-created", session => this.register(session));
        for (const win of BrowserWindow.getAllWindows()) this.register(win.webContents.session);
    }

    register(session: Session) {
        if (this.registered.has(session)) return;

        mkdirSync(dir(), { recursive: true });
        const filePath = join(dir(), "preload.js");
        writeFileSync(filePath, preload(join(dir(), "streamoverlay_nvenc.node")));
        session.registerPreloadScript({ type: "frame", filePath });
        this.registered.add(session);
    }

    async start() {
        if (this.started) return true;
        if (!this.targets.size) return false;

        const started = await this.askAll("start");
        if (!started.some(text => text.startsWith("on") || text.startsWith("already on"))) return false;

        this.started = (await this.askAll("drawOn")).some(text => text.startsWith("drawing on"));
        return this.started;
    }

    /**
     * `dirty`: the part of `image` that changed since the previous frame (pixels). Only that part is sent on, which is
     * most of the cost of an overlay: a whole screen of pixels is tens of MB, and a bar that moves is a few KB.
     */
    frame(image: NativeImage, dirty?: Rectangle) {
        if (!this.started) return;

        this.image = image;
        if (!dirty) this.whole = true;
        else this.dirty = this.dirty ? union(this.dirty, dirty) : dirty;
        this.schedule();
    }

    stop() {
        if (!this.started) return;

        this.started = false;
        this.image = null;
        this.dirty = null;
        this.whole = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        void this.askAll("drawOff");
    }

    private resync() {
        this.whole = true;
        if (this.started && this.image) this.schedule();
    }

    private schedule() {
        if (this.timer) return;
        this.timer = setTimeout(this.flush, Math.max(0, FRAME_GAP_MS - (Date.now() - this.lastSent)));
    }

    private readonly flush = () => {
        this.timer = null;
        const { image } = this;
        if (!image || !this.started) return;

        const { width, height } = image.getSize();
        const size = `${width}x${height}`;
        const dirty = this.dirty && clip(this.dirty, width, height);

        // a rectangle only goes onto a picture the other side already has, and past about half of it the crop is not worth it
        const part = !this.whole && dirty && size === this.size && dirty.width * dirty.height < width * height / 2 ? dirty : null;
        this.dirty = null;
        this.whole = false;
        this.size = size;
        this.lastSent = Date.now();

        if (part) {
            const bitmap = image.crop(part).toBitmap();
            for (const target of this.targets) target.send(FRAME, bitmap, part.width, part.height, part.x, part.y, width, height);
        } else {
            const bitmap = image.toBitmap();
            for (const target of this.targets) target.send(FRAME, bitmap, width, height, 0, 0, width, height);
        }
    };

    /** What the hook has done since drawing went on, from the pages that have it; null when none answered. */
    async health() {
        if (!this.started) return null;
        return combineStatus((await this.askAll("status")).map(parseStatus));
    }

    private askAll(command: string) {
        return Promise.all([...this.targets].map(target => this.ask(target, command)));
    }

    private ask(target: WebContents, command: string) {
        const id = this.nextId++;
        return new Promise<string>(resolve => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                resolve("no answer");
            }, ASK_TIMEOUT_MS);
            this.pending.set(id, text => {
                clearTimeout(timer);
                resolve(text);
            });
            target.send(COMMAND, id, command);
        });
    }
}
