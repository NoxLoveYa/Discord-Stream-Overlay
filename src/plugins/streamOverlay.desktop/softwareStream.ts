/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { findByCode } from "@webpack";
import { MediaEngineStore } from "@webpack/common";

import { needsSoftware } from "./encoders";
import { settings } from "./settings";

// Stream only can draw into NVENC and into Windows' software H.264 encoder, not into the encoder of an AMD or Intel card. For those
// the stream is sent to the software one: Discord is told, through its own denylist of video encoders and codecs, not to use
// the others. The approach (and the AMD ids) come from a patch tested on a Radeon RX 5700 XT.

type Overrides = { overrideDeniedVideoCodecs?: string; overrideDeniedVideoEncoders?: string; [key: string]: unknown; };
type Connection = {
    context: string;
    lastOverrideCodecDenylist?: string;
    lastOverrideEncoderDenylist?: string;
    setAudioVideoOverridesTransport(options: Overrides): unknown;
};
type Engine = { connections?: Iterable<Connection>; getCodecSurvey?(): Promise<string>; };

const logger = new Logger("StreamOverlay");

const TICK_MS = 500;
const FIND_MS = 5000;
const SURVEY_RETRY_MS = 30_000;

// What the log prints ("amd: direct3d") is not what the denylist matches ("amd-dx11"): denying the label alone did not stop an
// AMD card. The ids of the other vendors follow the same pattern; names that do not exist are ignored.
const HARDWARE_ENCODERS = [
    "amd-dx11", "intel-dx11", "nvidia-dx11", "nvidia-cuda", "nvidia-vulkan", "amd-vaapi", "intel-vaapi",
    "amd", "AMD", "Amd", "AMF", "amf", "nvidia", "Nvidia", "NVIDIA", "NVENC", "intel", "Intel", "INTEL",
    "amd: direct3d", "amd: vaapi", "intel: direct3d", "intel: vaapi", "intel: swsurf",
    "nvidia: direct3d", "nvidia: cuda", "nvidia: vulkan",
    "MediaFoundation HW", "MediaFoundation direct3d", "MediaFoundation direct3d amd", "MediaFoundation direct3d intel",
    "MediaFoundation direct3d nvidia", "MediaFoundation HEVC"
];
// "MediaFoundation SW" stays allowed; Discord never denies VP8 and VP9
const DENIED_CODECS = ["H265", "AV1"];

// the stream's encoder was found to be undrawable (sync.ts), for as long as Discord runs
let learned = false;
// what the engine's own list of encoders says about this machine, null while unknown
let surveyed: boolean | null = null;
let surveying = false;
let surveyRetryAt = 0;

const originals = new Map<Connection, Connection["setAudioVideoOverridesTransport"]>();
let seen = new WeakMap<Connection, { options: Overrides; active: boolean; }>();
let timer: ReturnType<typeof setInterval> | undefined;
let findAt = 0;

export const softwareWanted = () => settings.store.streamOnly && (settings.store.softwareStreamOnly || learned || surveyed === true);
export const useSoftwareEncoder = () => void (learned = true);

const union = (value: string | undefined, extra: string[]) =>
    [...new Set([...(value ?? "").split(",").map(x => x.trim()).filter(Boolean), ...extra])].join(",");

const software = (options: Overrides): Overrides => ({
    ...options,
    overrideDeniedVideoCodecs: union(options.overrideDeniedVideoCodecs, DENIED_CODECS),
    overrideDeniedVideoEncoders: union(options.overrideDeniedVideoEncoders, HARDWARE_ENCODERS)
});

const engine = () => MediaEngineStore?.getMediaEngine?.() as unknown as Engine | undefined;
const connections = (): Iterable<Connection> => engine()?.connections ?? [];

// Only the connection of the screen share (context "stream") is routed: a camera or a call keeps its encoder.
function patch(proto: Connection | undefined) {
    if (!proto || originals.has(proto) || typeof proto.setAudioVideoOverridesTransport !== "function") return;

    const original = proto.setAudioVideoOverridesTransport;
    originals.set(proto, original);
    proto.setAudioVideoOverridesTransport = function (options) {
        const enabled = this.context === "stream" && softwareWanted();
        seen.set(this, { options: { ...options }, active: enabled });
        return original.call(this, enabled ? software(options) : options);
    };
}

async function survey() {
    if (surveying || surveyed !== null || Date.now() < surveyRetryAt) return;

    surveying = true;
    try {
        const raw = await engine()?.getCodecSurvey?.();
        surveyed = typeof raw === "string" ? needsSoftware(JSON.parse(raw)) : null;
        if (surveyed) logger.info("no encoder of this machine can carry the overlay, Stream only uses Windows' software encoder");
    } catch (error) {
        logger.warn("codec survey failed", error);
    } finally {
        surveying = false;
        if (surveyed === null) surveyRetryAt = Date.now() + SURVEY_RETRY_MS;
    }
}

function sync() {
    try {
        if (!settings.store.streamOnly && !originals.size) return;
        void survey();

        // the class may not be loaded yet: the live connections are the fallback, and patching their prototype covers the next ones
        if (!originals.size && Date.now() >= findAt) {
            findAt = Date.now() + FIND_MS;
            patch(findByCode("setAudioVideoOverridesTransport")?.prototype);
        }

        for (const connection of connections()) {
            patch(Object.getPrototypeOf(connection));
            if (connection.context !== "stream") continue;

            const record = seen.get(connection);
            const wanted = softwareWanted();
            if (record?.active === wanted || (!record && !wanted)) continue;

            // goes through the patched method again, which applies or drops the denylists
            connection.setAudioVideoOverridesTransport(record?.options ?? {
                overrideDeniedVideoCodecs: connection.lastOverrideCodecDenylist ?? "",
                overrideDeniedVideoEncoders: connection.lastOverrideEncoderDenylist ?? ""
            });
            logger.info("software encoder for the stream", wanted ? "on" : "off");
        }
    } catch (error) {
        logger.error("software encoder routing failed", error);
        stopSoftwareStream();
    }
}

export function startSoftwareStream() {
    if (!timer) timer = setInterval(sync, TICK_MS);
}

export function stopSoftwareStream() {
    clearInterval(timer);
    timer = undefined;

    // the methods first, then what the caller had asked for
    for (const [proto, original] of originals) proto.setAudioVideoOverridesTransport = original;
    originals.clear();
    for (const connection of connections()) {
        const record = seen.get(connection);
        if (!record?.active) continue;
        try {
            connection.setAudioVideoOverridesTransport(record.options);
        } catch (error) {
            logger.warn("could not restore the encoders of a connection", error);
        }
    }
    seen = new WeakMap();
    learned = false;
    surveyed = null;
    surveyRetryAt = 0;
}
