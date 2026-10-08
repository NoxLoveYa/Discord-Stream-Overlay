/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, BrowserWindow, ipcMain, type NativeImage, type Session, type WebContents } from "electron";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const HELLO = "StreamOverlay:nvenc:hello";
const COMMAND = "StreamOverlay:nvenc:command";
const RESULT = "StreamOverlay:nvenc:result";
const FRAME = "StreamOverlay:nvenc:frame";

const FRAME_GAP_MS = 16;
const ASK_TIMEOUT_MS = 5000;

const dir = () => join(app.getPath("userData"), "StreamOverlay", "nvenc");

/** Where the overlay's pixels go once they are rendered: into the encoder and onto the in-app preview. */
export interface StreamSink {
    /** Hooks the encoder and starts drawing into it. False when that is not possible (the overlay then stays on screen). */
    start(): Promise<boolean>;
    frame(image: NativeImage): void;
    stop(): void;
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
    // the channels are swapped in a shader: the preview gets the full size picture with no per-pixel work here
    const shown = new Map();
    let ratio = 0;
    let raf = 0;
    let active = false;
    let latest = null;
    let stale = false;

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

        return (bitmap, width, height) => {
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }
            gl.viewport(0, 0, width, height);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        };
    };

    // videos shaped like the shared screen; the stream is fed natively, media in chats are files loaded over http(s)
    const previews = () => [...document.querySelectorAll("video")].filter(v => {
        if (/^https?:/i.test(v.currentSrc || v.src) || v.closest('[data-list-id="chat-messages"]')) return false;
        if (!v.videoWidth || Math.abs(v.videoWidth / v.videoHeight - ratio) > 0.02) return false;
        const r = v.getBoundingClientRect();
        return r.width > 120 && r.height > 60 && getComputedStyle(v).visibility !== "hidden";
    });

    const place = () => {
        raf = 0;
        if (!ratio) return;

        const live = new Set(previews());
        if (stale && live.size) {
            stale = false;
            for (const canvas of shown.values()) canvas.dirty = true;
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
                canvas.dirty = true;
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

            if (canvas.dirty && latest) {
                canvas.dirty = false;
                try { (canvas.paint ??= painterFor(canvas))?.(latest.bitmap, latest.width, latest.height); } catch { }
            }
        }
        raf = requestAnimationFrame(place);
    };

    const clear = () => {
        ratio = 0;
        latest = null;
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

    ipcRenderer.on(${JSON.stringify(FRAME)}, (_, bitmap, width, height) => {
        if (!active) return;
        try { load().setOverlay(bitmap, width, height); } catch { }

        // converted only if a preview is on screen
        latest = { bitmap, width, height };
        ratio = width / height;
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
    private latest: NativeImage | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private lastSent = 0;

    constructor() {
        ipcMain.on(HELLO, event => {
            this.targets.add(event.sender);
            event.sender.once("destroyed", () => this.targets.delete(event.sender));
        });
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

    frame(image: NativeImage) {
        if (!this.started) return;

        this.latest = image;
        if (this.timer) return;
        this.timer = setTimeout(this.flush, Math.max(0, FRAME_GAP_MS - (Date.now() - this.lastSent)));
    }

    stop() {
        if (!this.started) return;

        this.started = false;
        this.latest = null;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        void this.askAll("drawOff");
    }

    private readonly flush = () => {
        this.timer = null;
        const frame = this.latest;
        this.latest = null;
        if (!frame || !this.started) return;

        const { width, height } = frame.getSize();
        const bitmap = frame.toBitmap();
        this.lastSent = Date.now();
        for (const target of this.targets) target.send(FRAME, bitmap, width, height);
    };

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
