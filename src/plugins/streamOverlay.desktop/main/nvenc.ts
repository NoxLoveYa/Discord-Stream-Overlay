/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, BrowserWindow, ipcMain, type Session, type WebContents } from "electron";
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
    frame(bitmap: Buffer, width: number, height: number): void;
    stop(): void;
}

// Discord's voice module (and with it NVENC) lives in the renderer process, not in the main one. The addon has to be
// loaded there, and the only code that runs there with Node is a preload script. The same script draws the overlay over
// the preview of the stream: that is a <video> fed by the native module, which the encoder hook never touches.
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

    // the latest overlay, converted to a small RGBA canvas; one canvas per preview sits over its <video>
    const source = document.createElement("canvas");
    const shown = new Map();
    let ratio = 0;
    let raf = 0;
    let active = false;

    const convert = (bitmap, width, height) => {
        if (bitmap.byteOffset & 3) bitmap = Uint8Array.from(bitmap);
        const step = Math.max(1, Math.floor(width / 1280));
        const w = Math.floor(width / step);
        const h = Math.floor(height / step);
        const src = new Uint32Array(bitmap.buffer, bitmap.byteOffset, width * height);
        const out = new Uint32Array(w * h);
        let i = 0;
        for (let y = 0; y < h; y++) {
            const row = y * step * width;
            for (let x = 0; x < w; x++, i++) {
                const v = src[row + x * step];
                const a = v >>> 24;
                if (a === 255) {
                    out[i] = (v & 0xff00ff00) | ((v & 0xff) << 16) | ((v >>> 16) & 0xff);
                } else if (a) {
                    const r = Math.min(255, ((v >>> 16) & 0xff) * 255 / a | 0);
                    const g = Math.min(255, ((v >>> 8) & 0xff) * 255 / a | 0);
                    const b = Math.min(255, (v & 0xff) * 255 / a | 0);
                    out[i] = (a << 24 | b << 16 | g << 8 | r) >>> 0;
                }
            }
        }
        source.width = w;
        source.height = h;
        source.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(out.buffer), w, h), 0, 0);
    };

    // the previews: videos that show something shaped like the shared screen. The stream is fed natively, while every
    // media in a message, embed or lightbox is a file loaded over http(s)
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

            // the picture inside the element is letterboxed
            const r = video.getBoundingClientRect();
            let w = r.width, h = r.height;
            if (w / h > ratio) w = h * ratio; else h = w / ratio;
            const s = canvas.style;
            s.left = r.left + (r.width - w) / 2 + "px";
            s.top = r.top + (r.height - h) / 2 + "px";
            s.width = w + "px";
            s.height = h + "px";

            if (canvas.dirty) {
                canvas.dirty = false;
                canvas.width = source.width;
                canvas.height = source.height;
                canvas.getContext("2d").drawImage(source, 0, 0);
            }
        }
        raf = requestAnimationFrame(place);
    };

    const clear = () => {
        ratio = 0;
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
        try {
            convert(bitmap, width, height);
            ratio = width / height;
            for (const canvas of shown.values()) canvas.dirty = true;
            if (!raf) raf = requestAnimationFrame(place);
        } catch { }
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
    private latest: { bitmap: Buffer; width: number; height: number; } | null = null;
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

        // the preload only applies to pages loaded after it is registered: a page open at the time needs a reload (Ctrl+R)
        app.on("session-created", session => this.register(session));
        for (const win of BrowserWindow.getAllWindows()) this.register(win.webContents.session);
    }

    /** The session of the window asking is Discord's own. */
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

    frame(bitmap: Buffer, width: number, height: number) {
        if (!this.started) return;

        this.latest = { bitmap, width, height };
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

        this.lastSent = Date.now();
        for (const target of this.targets) target.send(FRAME, frame.bitmap, frame.width, frame.height);
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
