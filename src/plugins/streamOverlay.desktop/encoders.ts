/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Which encoder Discord uses for the stream, from its voice log ("Outbound video stats ... codec: AV1 (nvidia: direct3d)").
// No React and no store, so it can be tested alone.

type EncoderKind =
    | "nvenc-d3d11"
    | "nvenc-cuda"
    | "nvidia-other"
    | "amd"
    | "intel"
    | "media-foundation"
    | "media-foundation-sw"
    | "software"
    | "unknown";

export interface EncoderInfo {
    codec: string;
    /** as Discord writes it ("nvidia: direct3d"); empty before one is chosen */
    backend: string;
    kind: EncoderKind;
    label: string;
}

// the names Discord gives are not documented: they are told apart by what they mention
function classifyBackend(backend: string): EncoderKind {
    const text = backend.toLowerCase();
    if (!text.trim()) return "unknown";

    if (text.includes("nvidia") || text.includes("nvenc")) {
        if (/direct3d|d3d|dx11|directx/.test(text)) return "nvenc-d3d11";
        if (text.includes("cuda")) return "nvenc-cuda";
        return "nvidia-other";
    }
    if (/\bamd\b|amf|radeon/.test(text)) return "amd";
    if (/intel|quicksync|qsv|vpl|mfx/.test(text)) return "intel";
    if (/mediafoundation|media foundation|\bmft?\b/.test(text)) {
        return /\b(sw|software)\b/.test(text) ? "media-foundation-sw" : "media-foundation";
    }
    if (/software|openh264|x264|x265|vpx|aom|svt|ffmpeg|cpu|libav/.test(text)) return "software";
    return "unknown";
}

const OUTBOUND = /Outbound video stats[^\n]*?codec: ([^\s,(]+) \(([^)]*)\)/;

function makeInfo(codec: string, backend: string): EncoderInfo {
    return { codec, backend, kind: classifyBackend(backend), label: backend ? `${codec} (${backend})` : codec };
}

function parseOutbound(line: string): EncoderInfo | null {
    const match = OUTBOUND.exec(line);
    return match ? makeInfo(match[1], match[2].trim()) : null;
}

interface OutboundActivity {
    /** when the line was written (ms since the epoch) */
    at: number;
    encodedFps: number;
}

const ACTIVITY = /^\[([^\]]+)\][^\n]*?\[stream\] Outbound video stats[^\n]*?frames encoded: \d+, encoded frame rate: (\d+)/;

// stats of a stream, not of a camera
function parseActivity(line: string): OutboundActivity | null {
    const match = ACTIVITY.exec(line);
    if (!match) return null;

    // the log is written in local time, as "2026-10-08 17:01:57.935"
    const at = new Date(match[1].replace(" ", "T")).getTime();
    return Number.isFinite(at) ? { at, encodedFps: Number(match[2]) } : null;
}

export function latestActivity(lines: string[]): OutboundActivity | null {
    let latest: OutboundActivity | null = null;
    for (const line of lines) latest = parseActivity(line) ?? latest;
    return latest;
}

// the rate, not the count: the count of a stream that went idle stays what it was, and the hook's own count starts again
// whenever drawing is switched on
export const isEncoding = (activity: OutboundActivity) => activity.encodedFps > 0;

// the MultiEncoder lines come about a second after the stream starts, the outgoing stats only every 10 s
const INITIALIZED = /Initialize MultiEncoder for codec: (\w+) available encoders: ([^\n]*)/;
const CREATED = /Encoder created! (.+?) \(#\d+\)/;

// a backend named by the stats wins over the lines from before one was chosen
export function latestEncoder(lines: string[]): EncoderInfo | null {
    let latest: EncoderInfo | null = null;
    let codec = "";
    for (const line of lines) {
        const initialized = INITIALIZED.exec(line);
        if (initialized) {
            codec = initialized[1];
            continue;
        }

        const created = CREATED.exec(line);
        if (created) {
            latest = makeInfo(codec || "?", created[1].trim());
            continue;
        }

        const info = parseOutbound(line);
        if (info && (info.backend || !latest)) latest = info;
    }
    return latest;
}

const REASONS: Record<EncoderKind, string> = {
    "nvenc-d3d11": "this is the encoder \"stream only\" is built for",
    "nvenc-cuda": "NVENC is fed through CUDA, which \"stream only\" cannot draw into yet",
    "nvidia-other": "an NVIDIA encoder that is not fed with Direct3D 11 textures, which \"stream only\" cannot draw into",
    "amd": "AMD's encoder (AMF), which \"stream only\" cannot draw into yet",
    "intel": "Intel's encoder, which \"stream only\" cannot draw into yet",
    "media-foundation": "Windows' Media Foundation encoder on the graphics card, which \"stream only\" cannot draw into yet",
    "media-foundation-sw": "Windows' own H.264 encoder, in software: \"stream only\" draws into the frames it is given",
    "software": "a software encoder, which \"stream only\" cannot draw into",
    "unknown": "an encoder that could not be told from the log"
};

export function explainEncoder(info: EncoderInfo | null) {
    if (!info) return "Discord's log does not say yet which encoder this stream uses";
    // the encoder is only made when the first frame is to be encoded
    if (!info.backend) return `Discord has not made an encoder for this ${info.codec} stream yet: it only encodes while somebody is watching`;
    return `Discord encodes this stream with ${info.label}: ${REASONS[info.kind]}`;
}
