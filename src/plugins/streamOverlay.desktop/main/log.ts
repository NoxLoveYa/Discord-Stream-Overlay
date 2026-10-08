/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";
import { appendFileSync, closeSync, mkdirSync, openSync, readSync, renameSync, statSync } from "fs";
import { dirname, join } from "path";

const MAX_BYTES = 512 * 1024;

/** The plugin's own log, next to the overlays folder: what it decided and why (the native hook has its own, in %TEMP%). */
export const logFile = () => join(app.getPath("userData"), "StreamOverlay", "streamoverlay.log");

/** One line in the log: time and message. It can never get in the way: a log that cannot be written is skipped. */
export function note(message: string) {
    try {
        const file = logFile();
        mkdirSync(dirname(file), { recursive: true });
        try {
            if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.old`);
        } catch { /* no log yet */ }
        appendFileSync(file, `${new Date().toISOString()} ${message.replace(/\s+/g, " ").slice(0, 600)}\n`);
    } catch { /* see above */ }
}

/** The last `maxBytes` of a file as text, or "" when it cannot be read. */
export function readTail(file: string, maxBytes: number) {
    return readRange(file, Math.max(0, safeSize(file) - maxBytes), maxBytes);
}

/** `length` bytes of a file from `start`, as text, or "" when it cannot be read. */
export function readRange(file: string, start: number, length: number) {
    try {
        const size = safeSize(file);
        const count = Math.max(0, Math.min(length, size - start));
        const fd = openSync(file, "r");
        try {
            const buffer = Buffer.alloc(count);
            readSync(fd, buffer, 0, count, start);
            return buffer.toString("utf-8");
        } finally {
            closeSync(fd);
        }
    } catch {
        return "";
    }
}

export function safeSize(file: string) {
    try {
        return statSync(file).size;
    } catch {
        return 0;
    }
}

/** The last `count` lines of a log file. */
export const tailLines = (file: string, count: number) => readTail(file, 256 * 1024).split(/\r?\n/).filter(Boolean).slice(-count);
