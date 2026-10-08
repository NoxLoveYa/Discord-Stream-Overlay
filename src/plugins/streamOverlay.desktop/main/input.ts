/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type BrowserWindow, screen } from "electron";

import { type KeyPoll, startKeyPoll } from "./keys";

const POINTER_INTERVAL_MS = 50;

/**
 * Feeds the overlay page with what it cannot see itself because the window never has focus and ignores the mouse:
 * the state of the keys it asked for, and where the cursor is. It also lets the window take the mouse while an
 * interactive overlay's key combo is held.
 */
export class OverlayInput {
    private keyPoll: KeyPoll | null = null;
    private pointerTimer: ReturnType<typeof setInterval> | null = null;
    private lastPointer = "";
    private mouseCaptured = false;

    constructor(
        private readonly getWindow: () => BrowserWindow | null,
        private readonly getCombos: () => string[][]
    ) { }

    sync(keys: string[], relayPointer: boolean, freshPage: boolean) {
        if (this.keyPoll?.names.join() !== keys.join()) {
            this.stopKeys();
            this.keyPoll = startKeyPoll(keys, this.onKeys);
        }

        if (freshPage) this.lastPointer = "";
        this.setPointerRelay(relayPointer);
    }

    /** A reloaded page has lost the key and cursor state: start over so both are sent again. */
    restart() {
        this.lastPointer = "";
        const names = this.keyPoll?.names;
        this.stopKeys();
        if (names) this.keyPoll = startKeyPoll(names, this.onKeys);
    }

    stop() {
        this.stopKeys();
        this.setPointerRelay(false);
    }

    private stopKeys() {
        this.keyPoll?.stop();
        this.keyPoll = null;
        // without key state nothing could say the combo is released, so never leave the screen blocked
        this.setMouseCaptured(false);
    }

    private onKeys = (down: string[]) => {
        this.setMouseCaptured(this.getCombos().some(combo => combo.length > 0 && combo.every(k => down.includes(k))));
        this.getWindow()?.webContents.executeJavaScript(`window.__streamOverlayKeys?.(${JSON.stringify(down)})`).catch(() => { });
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
        win.webContents.executeJavaScript(`window.__streamOverlayPointer?.(${x}, ${y})`).catch(() => { });
    };
}
