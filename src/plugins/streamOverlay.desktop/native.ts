/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow, type IpcMainInvokeEvent, shell } from "electron";

import { FocusWatcher } from "./main/focus";
import { listOverlays as listOverlayFolder, pickFolder as pickOverlayFolder, resolveRoot } from "./main/folder";
import { addFontFamily, importFont, listFonts, removeFont } from "./main/fonts";
import { LayoutSink, screenshot } from "./main/layout";
import { cleanMedia } from "./main/media";
import { Nvenc } from "./main/nvenc";
import { currentEncoder, streamEncoding as discordEncoding } from "./main/voiceLog";
import { OverlayWindow } from "./main/window";
import type { OverlayValues } from "./types";

// every export is an IPC method the renderer can call; the logic lives in ./main
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

/** The user's custom fonts: imported files and system names. */
export function listCustomFonts() {
    return listFonts();
}

export function importFontFile(event: IpcMainInvokeEvent) {
    return importFont(event);
}

export function addSystemFont(_: IpcMainInvokeEvent, name: string) {
    return addFontFamily(name);
}

export function removeCustomFont(_: IpcMainInvokeEvent, name: string) {
    return removeFont(name);
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

export function setMedia(_: IpcMainInvokeEvent, state: unknown) {
    const media = cleanMedia(state);
    return Promise.all([overlay.setMedia(media), layout.setMedia(media)]).then(() => { });
}

export function layoutShow(_: IpcMainInvokeEvent, sourceId: string | null, root: string, names: string[], values: OverlayValues) {
    // or it would be in the screenshot behind the layout too
    overlay.suspend();
    return layout.show(sourceId, null, root, names, values, true);
}

export function layoutBackground() {
    const display = layout.currentDisplay();
    return display ? screenshot(display) : null;
}

export function layoutFrame() {
    return layoutSink.take();
}

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

export function watchFocus(_: IpcMainInvokeEvent, on: boolean) {
    focus.set(on);
}

export function getFocus() {
    return focus.read();
}

export function streamEncoder() {
    return currentEncoder();
}

export function streamEncoding() {
    return discordEncoding();
}

export function streamHealth() {
    return nvenc.health();
}

// the hook tells encoded textures apart by watching Discord register them, so a stream that started before it cannot be drawn on
export function prepareStream(event: IpcMainInvokeEvent) {
    nvenc.register(event.sender.session);
    return nvenc.start();
}
