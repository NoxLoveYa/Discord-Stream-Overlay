/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type EncoderInfo, isEncoding, latestActivity, latestEncoder } from "@plugins/streamOverlay.desktop/encoders";
import { app } from "electron";
import { closeSync, openSync, readSync, statSync } from "fs";
import { join } from "path";

const VOICE_LOGS = ["discord-webrtc_0", "discord-webrtc_1"];
// Discord rotates the log at about 5 MB
const MAX_BYTES = 6 * 1024 * 1024;
// the stats line comes every 10 s and the log grows about 5 KB/s while streaming
const ACTIVITY_BYTES = 256 * 1024;
const ACTIVITY_STALE_MS = 30_000;

function stat(file: string) {
    try {
        return statSync(file);
    } catch {
        return null; // no log yet
    }
}

function readRange(file: string, start: number, length: number) {
    try {
        const count = Math.max(0, Math.min(length, (stat(file)?.size ?? 0) - start));
        const fd = openSync(file, "r");
        try {
            const buffer = Buffer.alloc(count);
            readSync(fd, buffer, 0, count, start);
            return buffer.toString("utf-8");
        } finally {
            closeSync(fd);
        }
    } catch {
        // the log is Discord's: it may be missing or locked
        return "";
    }
}

const readTail = (file: string, maxBytes: number) => readRange(file, Math.max(0, (stat(file)?.size ?? 0) - maxBytes), maxBytes);

// When the log is full the file becomes _1 and a new _0 starts, so what happened a moment ago can be in either: oldest first.
// (The files of the previous session are called discord-last-webrtc_*.)
function voiceLogs() {
    const dir = join(app.getPath("userData"), "logs");
    return VOICE_LOGS.map(name => join(dir, name))
        .flatMap(file => { const info = stat(file); return info?.size ? [{ file, modified: info.mtimeMs }] : []; })
        .sort((a, b) => a.modified - b.modified)
        .map(log => log.file);
}

const voiceLogLines = (maxBytes: number) => voiceLogs().flatMap(file => readTail(file, maxBytes).split(/\r?\n/));

export const currentEncoder = (): EncoderInfo | null => latestEncoder(voiceLogLines(MAX_BYTES));

// from the stats line Discord writes every 10 s; null when there is none or it is old
// (nothing is encoded while nobody watches the stream)
export function streamEncoding(): boolean | null {
    const activity = latestActivity(voiceLogLines(ACTIVITY_BYTES));
    if (!activity || Date.now() - activity.at > ACTIVITY_STALE_MS) return null;
    return isEncoding(activity);
}
