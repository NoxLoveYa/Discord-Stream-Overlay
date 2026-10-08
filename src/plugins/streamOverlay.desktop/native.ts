/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow, type IpcMainInvokeEvent, shell } from "electron";

import { listOverlays as listOverlayFolder, pickFolder as pickOverlayFolder, resolveRoot } from "./main/folder";
import { OverlayWindow } from "./main/window";
import type { OverlayValues } from "./types";

// What the renderer can call: every export is an IPC method. The logic lives in ./main.

const overlay = new OverlayWindow();

export function listOverlays(_: IpcMainInvokeEvent, root: string) {
    return listOverlayFolder(root);
}

export function pickFolder(event: IpcMainInvokeEvent, current: string) {
    return pickOverlayFolder(BrowserWindow.fromWebContents(event.sender), current);
}

export function openRoot(_: IpcMainInvokeEvent, root: string) {
    return shell.openPath(resolveRoot(root));
}

export function show(_: IpcMainInvokeEvent, sourceId: string | null, sourceName: string | null, root: string, names: string[], values: OverlayValues) {
    return overlay.show(sourceId, sourceName, root, names, values);
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
