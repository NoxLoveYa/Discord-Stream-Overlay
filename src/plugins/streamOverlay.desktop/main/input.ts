/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type BrowserWindow, screen } from "electron";

import { type InputHandlers, type InputPoll, startInputPoll } from "./keys";
import { runInPage } from "./page";

const POINTER_INTERVAL_MS = 50;

// Feeds the overlay page what it cannot see itself (the window never has focus and ignores the mouse): the keys it asked
// for, mouse movement and the cursor. The window takes the mouse while an interactive overlay's key combo is held.
export class OverlayInput {
    private poll: InputPoll | null = null;
    private pointerTimer: ReturnType<typeof setInterval> | null = null;
    private lastPointer = "";
    private mouseCaptured = false;

    constructor(
        private readonly getWindow: () => BrowserWindow | null,
        private readonly getCombos: () => string[][],
        private readonly heldAlways: () => string[]
    ) { }

    sync(keys: string[], mouse: boolean, relayPointer: boolean, freshPage: boolean) {
        const unchanged = this.poll
            ? this.poll.names.join() === keys.join() && this.poll.mouse === mouse
            : !keys.length && !mouse;
        if (!unchanged) {
            this.stopPoll();
            this.poll = startInputPoll(keys, mouse, this.handlers);
        }

        if (freshPage) this.lastPointer = "";
        this.setPointerRelay(relayPointer);
    }

    // a reloaded page has lost the key and cursor state
    restart() {
        this.lastPointer = "";
        const { poll } = this;
        this.stopPoll();
        if (poll) this.poll = startInputPoll(poll.names, poll.mouse, this.handlers);
    }

    stop() {
        this.stopPoll();
        this.setPointerRelay(false);
    }

    private stopPoll() {
        this.poll?.stop();
        this.poll = null;
        // without key state nothing could say the combo is released, so never leave the screen blocked
        this.setMouseCaptured(false);
    }

    private readonly handlers: InputHandlers = {
        keys: pressed => {
            const down = [...new Set([...pressed, ...this.heldAlways()])];
            this.setMouseCaptured(this.getCombos().some(combo => combo.length > 0 && combo.every(k => down.includes(k))));
            const win = this.getWindow();
            if (win) void runInPage(win.webContents, `window.__streamOverlayKeys?.(${JSON.stringify(down)})`);
        },
        mouse: (dx, dy, wheel) => {
            const win = this.getWindow();
            if (win) void runInPage(win.webContents, `window.__streamOverlayMouse?.(${dx}, ${dy}, ${wheel})`);
        }
    };

    private setMouseCaptured(capture: boolean) {
        if (capture === this.mouseCaptured) return;
        this.mouseCaptured = capture;
        this.getWindow()?.setIgnoreMouseEvents(!capture);
    }

    // Electron 42 delivers no mouse moves to a window that ignores the mouse, so hovering is relayed from here
    private setPointerRelay(on: boolean) {
        if (on && !this.pointerTimer) {
            this.pointerTimer = setInterval(this.sendPointer, POINTER_INTERVAL_MS);
        } else if (!on) {
            if (this.pointerTimer) clearInterval(this.pointerTimer);
            this.pointerTimer = null;
            this.lastPointer = "";
        }
    }

    private sendPointer = () => {
        const win = this.getWindow();
        if (!win?.isVisible()) return;

        const cursor = screen.getCursorScreenPoint();
        const bounds = win.getBounds();
        const x = cursor.x - bounds.x;
        const y = cursor.y - bounds.y;

        const key = `${x},${y}`;
        if (key === this.lastPointer) return;
        this.lastPointer = key;
        void runInPage(win.webContents, `window.__streamOverlayPointer?.(${x}, ${y})`);
    };
}
