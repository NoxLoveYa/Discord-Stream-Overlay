/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow, type IpcMainInvokeEvent, shell } from "electron";

import { FocusWatcher } from "./main/focus";
import { listOverlays as listOverlayFolder, pickFolder as pickOverlayFolder, resolveRoot } from "./main/folder";
import { LayoutSink, screenshot } from "./main/layout";
import { cleanMedia } from "./main/media";
import { Nvenc } from "./main/nvenc";
import { OverlayWindow } from "./main/window";
import type { OverlayValues } from "./types";

// What the renderer can call: every export is an IPC method. The logic lives in ./main.

const nvenc = new Nvenc();
const overlay = new OverlayWindow(nvenc);
const layoutSink = new LayoutSink();
const layout = new OverlayWindow(layoutSink, true);
const focus = new FocusWatcher();

export function listOverlays(_: IpcMainInvokeEvent, root: string) {
    return listOverlayFolder(root);
}

export function pickFolder(event: IpcMainInvokeEvent, current: string) {
    return pickOverlayFolder(BrowserWindow.fromWebContents(event.sender), current);
}

export function openRoot(_: IpcMainInvokeEvent, root: string) {
    return shell.openPath(resolveRoot(root));
}

export function show(event: IpcMainInvokeEvent, sourceId: string | null, sourceName: string | null, root: string, names: string[], values: OverlayValues, streamOnly = false) {
    nvenc.register(event.sender.session);
    return overlay.show(sourceId, sourceName, root, names, values, streamOnly);
}

export function hide(_: IpcMainInvokeEvent, animate = true) {
    return overlay.hide(animate);
}

export function reload() {
    overlay.reload();
}

export function takeChanges() {
    return overlay.takeChanges();
}

/** The track playing in Spotify (null when none), for the overlays that ask for it. */
export function setMedia(_: IpcMainInvokeEvent, state: unknown) {
    const media = cleanMedia(state);
    return Promise.all([overlay.setMedia(media), layout.setMedia(media)]).then(() => { });
}

// The Layout tab: the overlays rendered offscreen and shown on the settings page, where the draggable ones can be moved.

export function layoutShow(_: IpcMainInvokeEvent, sourceId: string | null, root: string, names: string[], values: OverlayValues) {
    // or it would be in the screenshot behind the layout too
    overlay.suspend();
    return layout.show(sourceId, null, root, names, values, true);
}

/** A JPEG of the screen being drawn on. */
export function layoutBackground() {
    const display = layout.currentDisplay();
    return display ? screenshot(display) : null;
}

/** The newest picture, or null when it has not changed. */
export function layoutFrame() {
    return layoutSink.take();
}

/** What the overlays saved since the last call. */
export function layoutChanges() {
    return layout.takeChanges();
}

export function layoutPointer(_: IpcMainInvokeEvent, kind: "move" | "down" | "up", x: number, y: number) {
    layout.pointer(kind, x, y);
}

export function layoutHide() {
    overlay.resume();
    return layout.hide(false);
}

/** Starts or stops following which program is in focus. Nothing runs while nobody asked for it. */
export function watchFocus(_: IpcMainInvokeEvent, on: boolean) {
    focus.set(on);
}

export function getFocus() {
    return focus.read();
}

/** Whether the overlay really reaches the stream: what the hook has done since drawing went on, or null. */
export function streamHealth() {
    return nvenc.health();
}

/**
 * Hooks the encoder ahead of the stream: it only knows which texture an encoded frame is by watching Discord register
 * them, so a stream that started before the hook cannot be drawn on. True once the hook is in.
 */
export function prepareStream(event: IpcMainInvokeEvent) {
    nvenc.register(event.sender.session);
    return nvenc.start();
}
