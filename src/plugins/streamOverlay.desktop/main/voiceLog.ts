/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type EncoderInfo, isEncoding, latestActivity, latestEncoder } from "@plugins/streamOverlay.desktop/encoders";
import { app } from "electron";
import { closeSync, openSync, readSync, statSync } from "fs";
import { join } from "path";

const VOICE_LOG = "discord-webrtc_0";
const WHOLE_BELOW = 6 * 1024 * 1024;
const HEAD_BYTES = 300 * 1024;
const TAIL_BYTES = 5 * 1024 * 1024;
// the stats line comes every 10 s and the log grows about 5 KB/s while streaming
const ACTIVITY_BYTES = 256 * 1024;
const ACTIVITY_STALE_MS = 30_000;

const voiceLogFile = () => join(app.getPath("userData"), "logs", VOICE_LOG);

function safeSize(file: string) {
    try {
        return statSync(file).size;
    } catch {
        return 0; // no log yet
    }
}

function readRange(file: string, start: number, length: number) {
    try {
        const count = Math.max(0, Math.min(length, safeSize(file) - start));
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

const readTail = (file: string, maxBytes: number) => readRange(file, Math.max(0, safeSize(file) - maxBytes), maxBytes);

// a long log is read from its start (the encoder probe) and its end (the stream)
function voiceLogLines() {
    const file = voiceLogFile();
    const size = safeSize(file);
    if (!size) return [];

    const text = size <= WHOLE_BELOW ? readRange(file, 0, size) : `${readRange(file, 0, HEAD_BYTES)}\n${readTail(file, TAIL_BYTES)}`;
    return text.split(/\r?\n/);
}

export const currentEncoder = (): EncoderInfo | null => latestEncoder(voiceLogLines());

// from the stats line Discord writes every 10 s; null when there is none or it is old
// (nothing is encoded while nobody watches the stream)
export function streamEncoding(): boolean | null {
    const activity = latestActivity(readTail(voiceLogFile(), ACTIVITY_BYTES).split(/\r?\n/));
    if (!activity || Date.now() - activity.at > ACTIVITY_STALE_MS) return null;
    return isEncoding(activity);
}
