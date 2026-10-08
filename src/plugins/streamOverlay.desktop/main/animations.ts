/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { BrowserWindow } from "electron";

const EXIT_TIMEOUT_MS = 5000;

// Only finite animations can be played in and out: infinite ones (spinners) never end, so they keep running.
const FINITE_ANIMATIONS = "document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime))";
const ENTER_SCRIPT = `${FINITE_ANIMATIONS}.forEach(a => { a.cancel(); a.play(); })`;
const EXIT_SCRIPT = `(() => {
    const anims = ${FINITE_ANIMATIONS};
    anims.forEach(a => a.reverse());
    return Promise.all(anims.map(a => a.finished.catch(() => {})));
})()`;

// executeJavaScript works per frame whatever the origin, unlike reaching into the file:// iframes from the host page
export function runInFrames(win: BrowserWindow, script: string) {
    return Promise.all(win.webContents.mainFrame.framesInSubtree.map(f => f.executeJavaScript(script).catch(() => { })));
}

/** Restarts the intro: the page may have played it while the window was still hidden. */
export function playEnter(win: BrowserWindow) {
    return runInFrames(win, ENTER_SCRIPT);
}

export function playExit(win: BrowserWindow) {
    return Promise.race([
        runInFrames(win, EXIT_SCRIPT),
        new Promise(resolve => setTimeout(resolve, EXIT_TIMEOUT_MS))
    ]);
}
