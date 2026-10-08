/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type EncoderInfo, latestEncoder } from "@plugins/streamOverlay.desktop/encoders";
import { digestVoiceLog, formatHook, hints, type HookReport, parseHook } from "@plugins/streamOverlay.desktop/report";
import { app, screen } from "electron";
import { arch, release, version } from "os";
import { join } from "path";

import { logFile, readRange, readTail, safeSize, tailLines } from "./log";

const VOICE_LOG = "discord-webrtc_0";
const WHOLE_BELOW = 6 * 1024 * 1024;
const HEAD_BYTES = 300 * 1024;
const TAIL_BYTES = 5 * 1024 * 1024;

/**
 * The lines of Discord's voice log of this run, which say which encoders it found, which it tried and what it encodes the
 * stream with. A long log is read from its start (the probe) and its end (the stream).
 */
function voiceLogLines() {
    const file = join(app.getPath("userData"), "logs", VOICE_LOG);
    const size = safeSize(file);
    if (!size) return [];

    const text = size <= WHOLE_BELOW ? readRange(file, 0, size) : `${readRange(file, 0, HEAD_BYTES)}\n${readTail(file, TAIL_BYTES)}`;
    return text.split(/\r?\n/);
}

/** The encoder Discord uses for the stream right now, from its voice log; null when it does not say. */
export const currentEncoder = (): EncoderInfo | null => latestEncoder(voiceLogLines());

async function graphicsLines() {
    try {
        const info: any = await Promise.race([
            app.getGPUInfo("complete"),
            new Promise((_, reject) => setTimeout(() => reject(new Error("took more than 4 s")), 4000))
        ]);
        const devices: string[] = (info?.gpuDevice ?? []).map((d: any) =>
            `vendor 0x${Number(d.vendorId).toString(16)} device 0x${Number(d.deviceId).toString(16)} ${d.active ? "(active)" : "(not the one Chromium renders with)"} driver ${d.driverVersion ?? "?"} ${d.vendorString ?? ""} ${d.deviceString ?? ""}`.trim());
        const aux = info?.auxAttributes ?? {};
        return [...devices, `optimus=${aux.optimus} amdSwitchable=${aux.amdSwitchable} initialization time ${aux.initializationTime}`];
    } catch (error) {
        return [`(Electron could not say: ${error instanceof Error ? error.message : error})`];
    }
}

export interface ReportInput {
    /** what the settings page adds: the settings and the state of "stream only" there */
    extra: string;
    /** what each page that has the native hook answered to "diagnose" */
    hook: string[];
    nvenc: unknown;
    overlay: unknown;
}

/** Everything that helps to see why "stream only" does or does not work on this machine, as text to copy. */
export async function buildReport({ extra, hook, nvenc, overlay }: ReportInput) {
    const voice = voiceLogLines();
    const encoder = latestEncoder(voice);
    const hooks = hook.map(parseHook).filter((h): h is HookReport => h != null);
    const primary = screen.getPrimaryDisplay().id;

    const out: string[] = ["StreamOverlay diagnostics", `made ${new Date().toISOString()}`];
    const section = (title: string, lines: string[]) => out.push("", `=== ${title} ===`, ...lines);

    section("What this points to", hints(hooks, encoder));
    section("Plugin", [extra || "(nothing from the settings page)", `main process: ${JSON.stringify(nvenc)}`, `overlay window: ${JSON.stringify(overlay)}`]);
    section("Discord and the system", [
        `Discord ${app.getVersion()}, Electron ${process.versions.electron}, Chrome ${process.versions.chrome}, data in ${app.getPath("userData")}`,
        `${version()} ${release()} ${arch()}`
    ]);
    section("Graphics (Electron)", await graphicsLines());
    section("Displays (Electron)", screen.getAllDisplays().map(d =>
        `${d.id}: ${d.size.width}x${d.size.height} at ${d.bounds.x},${d.bounds.y}, scale ${d.scaleFactor}, ${d.displayFrequency} Hz${d.internal ? ", built in" : ""}${d.id === primary ? ", primary" : ""}`));
    section("Native hook (one block per page that has it)", hooks.length ? hooks.flatMap(formatHook) : ["(no page answered)"]);
    section("Discord's voice log", digestVoiceLog(voice));
    section(`Plugin log (last 120 lines of ${logFile()})`, tailLines(logFile(), 120));
    section("Hook log (last 120 lines of %TEMP%\\streamoverlay-nvenc.log)", tailLines(join(app.getPath("temp"), "streamoverlay-nvenc.log"), 120));
    return out.join("\n");
}
