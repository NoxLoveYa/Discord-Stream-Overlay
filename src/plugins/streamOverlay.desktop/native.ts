/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow, type IpcMainInvokeEvent, shell } from "electron";

import { FocusWatcher } from "./main/focus";
import { listOverlays as listOverlayFolder, pickFolder as pickOverlayFolder, resolveRoot } from "./main/folder";
import { LayoutSink } from "./main/layout";
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

// The Layout tab: the enabled overlays rendered offscreen, shown on the settings page where the draggable ones can be moved.

export function layoutShow(_: IpcMainInvokeEvent, sourceId: string | null, root: string, names: string[], values: OverlayValues) {
    return layout.show(sourceId, null, root, names, values, true);
}

/** The newest picture (null when unchanged) at the given width, and what the overlays saved since the last call. */
export async function layoutFrame(_: IpcMainInvokeEvent, width: number) {
    return { frame: layoutSink.take(width), changes: await layout.takeChanges() };
}

export function layoutPointer(_: IpcMainInvokeEvent, kind: "move" | "down" | "up", x: number, y: number) {
    layout.pointer(kind, x, y);
}

export function layoutHide() {
    return layout.hide(false);
}

/** Starts or stops following which program is in focus. Nothing runs while nobody asked for it. */
export function watchFocus(_: IpcMainInvokeEvent, on: boolean) {
    focus.set(on);
}

export function getFocus() {
    return focus.read();
}

/**
 * Hooks the encoder ahead of the stream: it only knows which texture an encoded frame is by watching Discord register
 * them, so a stream that started before the hook cannot be drawn on. True once the hook is in.
 */
export function prepareStream(event: IpcMainInvokeEvent) {
    nvenc.register(event.sender.session);
    return nvenc.start();
}
