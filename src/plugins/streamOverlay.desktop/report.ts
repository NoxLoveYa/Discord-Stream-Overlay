/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The diagnostics report: what the native hook says about the machine and the streams (diagnose() in nvenc/hook.cc), put in
// words, and what that suggests. No React, no store and no Electron, so it can be tested alone.

import { type EncoderInfo, explainEncoder } from "./encoders";

export interface Adapter {
    name: string;
    vendor: string;
    vendorId: number;
    deviceId: number;
    luid: string;
    vramMB: number;
    /** screens attached to it */
    outputs: number;
    software: boolean;
}

export interface SessionInfo {
    encoder: string;
    /** directx, cuda or opengl: what NVENC was opened on */
    device: string;
    api: number;
    codec: string;
    width: number;
    height: number;
    fpsNum: number;
    fpsDen: number;
    encodes: number;
    drawn: number;
    unknown: number;
    adapter: string;
}

export interface HookReport {
    pid: number;
    hooks: { installed: boolean; on: boolean; draw: boolean; };
    counters: { encodes: number; drawn: number; unknown: number; };
    lastError: string;
    adapters: Adapter[];
    modules: string[];
    sessions: SessionInfo[];
}

const list = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0;
const text = (value: unknown) => typeof value === "string" ? value : "";

/** What diagnose() returned, checked field by field (it comes from a page of the app, so nothing about it is assumed). */
export function parseHook(raw: string): HookReport | null {
    try {
        const o = JSON.parse(raw);
        if (!o || typeof o !== "object") return null;

        return {
            pid: num(o.pid),
            hooks: { installed: o.hooks?.installed === true, on: o.hooks?.on === true, draw: o.hooks?.draw === true },
            counters: { encodes: num(o.counters?.encodes), drawn: num(o.counters?.drawn), unknown: num(o.counters?.unknown) },
            lastError: text(o.lastError),
            adapters: list<any>(o.adapters).map(a => ({
                name: text(a?.name), vendor: text(a?.vendor), vendorId: num(a?.vendorId), deviceId: num(a?.deviceId), luid: text(a?.luid),
                vramMB: num(a?.vramMB), outputs: num(a?.outputs), software: a?.software === true
            })),
            modules: list<unknown>(o.modules).map(text).filter(Boolean),
            sessions: list<any>(o.sessions).map(s => ({
                encoder: text(s?.encoder), device: text(s?.device), api: num(s?.api), codec: text(s?.codec), width: num(s?.width), height: num(s?.height),
                fpsNum: num(s?.fpsNum), fpsDen: num(s?.fpsDen), encodes: num(s?.encodes), drawn: num(s?.drawn), unknown: num(s?.unknown), adapter: text(s?.adapter)
            }))
        };
    } catch {
        return null;
    }
}

export function formatHook(h: HookReport): string[] {
    const lines = [
        `process ${h.pid}: hook installed=${h.hooks.installed} on=${h.hooks.on} drawing=${h.hooks.draw}; frames encoded ${h.counters.encodes}, drawn on ${h.counters.drawn}, of an unknown texture ${h.counters.unknown}`
    ];
    if (h.lastError) lines.push(`  drawing was last switched off because: ${h.lastError}`);

    lines.push("  graphics cards:");
    for (const a of h.adapters)
        lines.push(`    ${a.name} | ${a.vendor} (0x${a.vendorId.toString(16)}:0x${a.deviceId.toString(16)}) | ${a.vramMB} MB | screens attached: ${a.outputs}${a.software ? " | software" : ""} | luid ${a.luid}`);
    if (!h.adapters.length) lines.push("    (none could be listed)");

    lines.push(`  video modules loaded: ${h.modules.join(", ") || "(none of the ones looked for)"}`);

    lines.push("  encoder sessions seen since the hook was installed:");
    for (const s of h.sessions)
        lines.push(`    ${s.encoder} | opened on ${s.device}${s.adapter ? ` (${s.adapter})` : ""} | ${s.codec} ${s.width}x${s.height} at ${s.fpsNum}/${s.fpsDen} | encodes ${s.encodes}, drawn ${s.drawn}, unknown ${s.unknown}`);
    if (!h.sessions.length) lines.push("    (none)");
    return lines;
}

const has = (modules: string[], part: string) => modules.some(m => m.toLowerCase().includes(part));

/** What the facts point to, to read first. */
export function hints(hooks: HookReport[], encoder: EncoderInfo | null): string[] {
    const out: string[] = [];
    if (!hooks.length) out.push("No page of the app answered for the native hook: restart Discord (and press Ctrl + R once) so that the plugin's script is loaded.");

    const first = hooks.find(h => h.adapters.length) ?? hooks[0];
    if (first) {
        const real = first.adapters.filter(a => !a.software);
        const nvidia = real.filter(a => a.vendor === "NVIDIA");
        const withScreens = real.filter(a => a.outputs > 0);

        if (!nvidia.length) {
            out.push("There is no NVIDIA card: NVENC is not available, so \"stream only\" cannot work here.");
        } else if (nvidia.every(a => a.outputs === 0) && withScreens.length) {
            out.push(`Hybrid graphics: the screens are on ${withScreens.map(a => a.name).join(" and ")}, and the NVIDIA card (${nvidia.map(a => a.name).join(", ")}) has none. ` +
                "Windows captures the screen on the card the screen is on, so Discord cannot hand those frames to NVENC and encodes with the other card (or the processor) instead.");
        } else if (nvidia.some(a => a.outputs > 0) && real.length > 1) {
            out.push("There are several graphics cards, and the NVIDIA one has a screen: the shared screen is probably on it, which is the setup that works.");
        }

        const { modules } = first;
        if (has(modules, "amfrt")) out.push("amfrt64.dll (AMD's encoder library) is loaded in Discord: it can encode with an AMD card.");
        if (has(modules, "nvcuda")) out.push("nvcuda.dll (CUDA) is loaded in Discord: NVENC may be fed through CUDA.");
        if (has(modules, "libmfx") || has(modules, "libvpl") || has(modules, "igfx")) out.push("Intel's media libraries are loaded in Discord: it can encode with an Intel card.");
        if (["openh264", "x264", "x265", "vpx", "aom", "dav1d", "avcodec", "ffmpeg"].some(m => has(modules, m))) out.push("A software codec library is loaded in Discord (OpenH264, x264, libvpx, libaom or FFmpeg): the stream may be encoded by the processor.");
    }

    for (const h of hooks) {
        if (!h.hooks.installed) {
            out.push(`Process ${h.pid}: the encoder hook is not installed ("stream only" is off, or it has not attached yet).`);
            continue;
        }
        if (!h.sessions.length) out.push(`Process ${h.pid}: no NVENC session has been opened since the hook was installed: the stream does not use NVENC, or it started before the hook (restart the stream).`);

        for (const s of h.sessions) {
            if (s.device === "cuda") out.push(`NVENC session ${s.encoder} is opened on CUDA (${s.codec} ${s.width}x${s.height}): its frames are CUDA memory, which "stream only" cannot draw into yet.`);
            else if (s.device === "opengl") out.push(`NVENC session ${s.encoder} is opened on OpenGL: not supported by "stream only".`);
            else if (s.device === "directx" && s.encodes > 0 && s.drawn > 0) out.push(`NVENC session ${s.encoder} (${s.codec}, Direct3D 11${s.adapter ? `, ${s.adapter}` : ""}): the overlay is being drawn into ${s.drawn} of its ${s.encodes} frames.`);
            else if (s.device === "directx" && s.encodes > 0) out.push(`NVENC session ${s.encoder} (${s.codec}, Direct3D 11) got ${s.encodes} frames and nothing could be drawn on them${h.lastError ? `: ${h.lastError}` : " (see the log lines about the textures)"}.`);
        }
    }

    out.push(explainEncoder(encoder) + ".");
    return out;
}

const cut = (line: string, max = 420) => line.length > max ? `${line.slice(0, max)}...` : line;
const stamp = (line: string) => /^\[([^\]]+)\]/.exec(line)?.[1] ?? "";

// lines that are about encoders going wrong, and are not any of the summaries above
const PROBLEM = /video-encode|No encoder|falling back|fall back to|fallback to|encoder.{0,40}(?:fail|error|not available|unavailable)|(?:nvenc|\bamf\b|d3d11|dxgi).{0,80}(?:fail|error)|Failed to (?:create|init)/i;
const NOISE = /Outbound video stats|encoder_prober|Encrypted|Decrypted|ConfigureStream|Audio|Opus|EchoProbe|echo_canceller|NVENC config, codec|\(multi_encoder\.cpp:|\(encoder\.rs:|\(encoder_factory\.cpp:|Created video encoder/;

// how Discord builds the encoder of a stream: its MultiEncoder lists the encoders it can use for the codec, in order, and
// tries them ("Initialize MultiEncoder for codec: H264 available encoders: nvidia: direct3d, nvidia: cuda"); then the
// factory and the encoder itself say what was made
const BUILT = /\(multi_encoder\.cpp:|\(encoder\.rs:|\(encoder_factory\.cpp:|\(video_coding\.cpp:\d+\): Created video encoder/;

/**
 * What Discord's voice log says about encoding, short enough to read: which encoders it found on the machine at startup,
 * the codecs the stream tried in order, what the stream was encoded with last, and the lines that look like trouble.
 */
export function digestVoiceLog(all: string[]): string[] {
    if (!all.length) return ["(the voice log was not found or is empty)"];

    const out: string[] = [];

    out.push("encoders found at startup:");
    const probe = all.filter(l => l.includes("encoder_prober") && /helper process for \w+.*\{|probing results|Error in probing|Failed to probe/.test(l));
    out.push(...(probe.length ? probe.slice(-12).map(l => cut(l)) : ["  (no probe lines)"]));

    const survey = all.find(l => l.includes("obtained codec survey"));
    if (survey) out.push("codec survey:", cut(survey.slice(survey.indexOf("obtained")), 900));

    out.push("codecs the streams asked for, in order:");
    const seen = new Set<string>();
    for (const line of all) {
        const codec = /Encoder config: \{codec_type: (\w+)/.exec(line)?.[1];
        if (!codec) continue;
        const key = `${stamp(line).slice(0, 16)} ${codec}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(`  ${stamp(line)}  ${codec}`);
    }
    if (!seen.size) out.push("  (no stream was started in this log)");

    out.push("how Discord built the encoder (latest lines):");
    const built = all.filter(l => BUILT.test(l));
    out.push(...(built.length ? built.slice(-24).map(l => cut(l, 300)) : ["  (no encoder was built in this log)"]));

    out.push("what the stream was encoded with (latest lines):");
    const outbound = all.filter(l => l.includes("Outbound video stats"));
    out.push(...(outbound.length ? outbound.slice(-3).map(l => cut(l)) : ["  (no outgoing video yet)"]));

    // Discord's NVENC wrapper writes this every second: the latest says what it was set up with
    const config = all.filter(l => l.includes("NVENC config, codec")).pop();
    if (config) out.push("NVENC setup (latest line):", cut(config, 300));

    const problems = all.filter(l => PROBLEM.test(l) && !NOISE.test(l));
    out.push("lines about encoder trouble:");
    out.push(...(problems.length ? problems.slice(-25).map(l => cut(l)) : ["  (none)"]));
    return out;
}
