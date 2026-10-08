/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Which encoder Discord is using for the stream, from what its own voice log says about it ("Outbound video stats ...
// codec: AV1 (nvidia: direct3d)"). "Stream only" can only draw into NVENC fed with Direct3D 11 textures, so this says
// at once whether it can work on a machine, and what is in the way when it cannot. No React and no store, so it can be
// tested alone.

export type EncoderKind =
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
    /** H264, H265, AV1, VP8... */
    codec: string;
    /** what Discord calls the way it is encoded, as written ("nvidia: direct3d"); empty before one is chosen */
    backend: string;
    kind: EncoderKind;
    /** whether the overlay can be drawn into this encoder's frames */
    supported: boolean;
    /** "AV1 (nvidia: direct3d)" */
    label: string;
}

/** The names Discord gives are not documented: they are told apart by what they mention, and the raw text is always kept. */
export function classifyBackend(backend: string): { kind: EncoderKind; supported: boolean; } {
    const text = backend.toLowerCase();
    if (!text.trim()) return { kind: "unknown", supported: false };

    if (text.includes("nvidia") || text.includes("nvenc")) {
        if (/direct3d|d3d|dx11|directx/.test(text)) return { kind: "nvenc-d3d11", supported: true };
        if (text.includes("cuda")) return { kind: "nvenc-cuda", supported: false };
        return { kind: "nvidia-other", supported: false };
    }
    if (/\bamd\b|amf|radeon/.test(text)) return { kind: "amd", supported: false };
    if (/intel|quicksync|qsv|vpl|mfx/.test(text)) return { kind: "intel", supported: false };
    if (/mediafoundation|media foundation|\bmft?\b/.test(text)) {
        // Windows' own encoder in software gets its frames in memory, which the overlay is blended into; a hardware one does not
        return /\b(sw|software)\b/.test(text) ? { kind: "media-foundation-sw", supported: true } : { kind: "media-foundation", supported: false };
    }
    if (/software|openh264|x264|x265|vpx|aom|svt|ffmpeg|cpu|libav/.test(text)) return { kind: "software", supported: false };
    return { kind: "unknown", supported: false };
}

const OUTBOUND = /Outbound video stats[^\n]*?codec: ([^\s,(]+) \(([^)]*)\)/;

export function makeInfo(codec: string, backend: string): EncoderInfo {
    const { kind, supported } = classifyBackend(backend);
    return { codec, backend, kind, supported, label: backend ? `${codec} (${backend})` : codec };
}

/** The encoder named by a line of the voice log, or null when the line is not about the outgoing video. */
export function parseOutbound(line: string): EncoderInfo | null {
    const match = OUTBOUND.exec(line);
    return match ? makeInfo(match[1], match[2].trim()) : null;
}

/** What Discord says about the outgoing video of a stream: "frames encoded: 9514, encoded frame rate: 60 [fps]". */
export interface OutboundActivity {
    /** when the line was written (ms since the epoch) */
    at: number;
    framesEncoded: number;
    encodedFps: number;
}

const ACTIVITY = /^\[([^\]]+)\][^\n]*?\[stream\] Outbound video stats[^\n]*?frames encoded: (\d+), encoded frame rate: (\d+)/;

/** The outgoing video stats of a stream (not of a camera) in a line of the voice log, or null when the line is not one. */
export function parseActivity(line: string): OutboundActivity | null {
    const match = ACTIVITY.exec(line);
    if (!match) return null;

    // the log is written in local time, as "2026-10-08 17:01:57.935"
    const at = new Date(match[1].replace(" ", "T")).getTime();
    return Number.isFinite(at) ? { at, framesEncoded: Number(match[2]), encodedFps: Number(match[3]) } : null;
}

/** The latest stats of the outgoing stream in these lines (they come every 10 s). */
export function latestActivity(lines: string[]): OutboundActivity | null {
    let latest: OutboundActivity | null = null;
    for (const line of lines) latest = parseActivity(line) ?? latest;
    return latest;
}

/**
 * Discord only encodes a stream while somebody watches it: with nobody the rate is 0. The rate, not the count: the count
 * of a stream that went idle stays what it was, and the hook's own count starts again whenever drawing is switched on.
 */
export const isEncoding = (activity: OutboundActivity) => activity.encodedFps > 0;

// Discord's MultiEncoder tells at once (about a second after the stream starts) which codec it initialised and which of the
// encoders it could use it ended up creating; the outgoing stats only come every 10 s
const INITIALIZED = /Initialize MultiEncoder for codec: (\w+) available encoders: ([^\n]*)/;
const CREATED = /Encoder created! (.+?) \(#\d+\)/;

/**
 * The encoder of the latest stream in these lines (the log in the order it was written): the one Discord created for it, or
 * what the outgoing stats name (a backend named wins over the lines from before one was chosen).
 */
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

/** What the encoder means for "stream only", in a sentence. */
export function explainEncoder(info: EncoderInfo | null) {
    if (!info) return "Discord's log does not say yet which encoder this stream uses";
    // the codec is known from the stream's setup, the encoder is only made when the first frame is to be encoded
    if (!info.backend) return `Discord has not made an encoder for this ${info.codec} stream yet: it only encodes while somebody is watching`;
    return `Discord encodes this stream with ${info.label}: ${REASONS[info.kind]}`;
}
