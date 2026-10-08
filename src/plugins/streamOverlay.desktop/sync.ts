/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { SettingsStore } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { ApplicationStreamingStore, FluxDispatcher, MediaEngineStore, UserStore } from "@webpack/common";

import { startAppPresets, stopAppPresets } from "./appPresets";
import { explainEncoder } from "./encoders";
import { GRACE_MS, judgeHook } from "./health";
import { Native, settings, updateValues } from "./settings";
import { startSpotify, stopSpotify } from "./spotify";
import { streamState } from "./streamState";

const logger = new Logger("StreamOverlay");

const SETTINGS_PATH = "plugins.StreamOverlay";
const SYNC_INTERVAL_MS = 1000;
const COLLECT_INTERVAL_MS = 400;
const HEALTH_INTERVAL_MS = 2000;
// the attribute the preload of main/nvenc.ts reads, to leave the overlay off the streams of other people
const SELF_ATTRIBUTE = "data-vc-stream-overlay-self";

let running = false;
let visible = false;
let syncTimer: ReturnType<typeof setInterval> | undefined;
let collectTimer: ReturnType<typeof setInterval> | undefined;
let lastKey = "";
let lastState = "";
let sourceName: string | null = null;
// Stream only takes the overlay off the screen, so it has to be seen reaching the stream: when this stream is not encoded
// by NVENC it would be in neither place. Then the overlays go back on the screen, for this stream.
let lastHealth = 0;
let lastStreamOnly = false;
// one sync at a time, so quick successive changes (dragging a color picker) cannot be applied out of order
let queue: Promise<unknown> = Promise.resolve();

const onStreamStart = (e: { sourceName?: string; }) => {
    sourceName = e.sourceName ?? null;
};

/** Tells the preview overlay whose Discord this is, so that it only goes on your own stream (not on the ones you watch). */
function publishSelf() {
    const id = UserStore.getCurrentUser()?.id;
    if (id) document.documentElement.setAttribute(SELF_ATTRIBUTE, id);
}

/** The encoder of this stream, written to the log once (it takes Discord a few seconds to have one). */
async function logEncoder() {
    if (streamState.encoderLogged) return;
    streamState.encoderLogged = true;

    const encoder = await Native.streamEncoder().catch(() => null);
    logger.info("the stream is encoded with", encoder?.label ?? "(Discord's log does not say)");
    Native.note(explainEncoder(encoder));
}

/** Looks at whether the overlay reaches the stream; if not, the next sync puts it on the screen. */
async function checkHook() {
    if (!streamState.offscreenSince || streamState.failed || Date.now() - lastHealth < HEALTH_INTERVAL_MS) return;
    lastHealth = Date.now();

    const waited = Date.now() - streamState.offscreenSince;
    const reason = judgeHook(await Native.streamHealth(), waited);
    if (!reason) {
        if (waited > GRACE_MS) await logEncoder();
        return;
    }

    // Discord's own log says which encoder it is, which is more useful to the user than "NVENC saw nothing"
    const encoder = await Native.streamEncoder().catch(() => null);
    streamState.failed = reason;
    lastKey = "";
    logger.warn("stream only does not work with this stream, the overlays go back on the screen", reason, encoder?.label);
    Native.note(`stream only given up: ${reason}. ${explainEncoder(encoder)}`);
    showNotification({
        title: "StreamOverlay",
        body: `"Stream only" does not work with this stream (${reason}), so the overlays are on your screen instead. ${explainEncoder(encoder)}. ` +
            "\"Copy diagnostics\" in the settings (Overlays tab) collects what is needed to look into it.",
        noPersist: true
    });
}

/** Shows, updates or hides the overlay window to match the stream and the settings. */
async function doSync() {
    if (!running) return;

    publishSelf();

    const sourceId = MediaEngineStore.getGoLiveSource()?.desktopSource?.id ?? null;
    const active = ApplicationStreamingStore.getCurrentUserActiveStream();
    const { overlayRoot, alwaysShow } = settings.store;

    // turning the setting off and on again tries again
    if (settings.store.streamOnly !== lastStreamOnly) {
        lastStreamOnly = settings.store.streamOnly;
        streamState.failed = "";
    }
    await checkHook();
    const streamOnly = settings.store.streamOnly && !streamState.failed;

    // before any stream: the hook has to see the encoder being set up
    if (streamOnly && !streamState.hooked) {
        streamState.hooked = await Native.prepareStream();
        if (streamState.hooked) logger.info("encoder hook installed, streams started from now on can carry the overlay");
    }

    // the store hands out proxies, which cannot cross IPC
    const overlays = [...settings.store.enabledOverlays];
    const values = JSON.parse(JSON.stringify(settings.store.overlayValues));

    const shouldShow = overlays.length > 0 && (alwaysShow || (active != null && sourceId?.startsWith("screen") === true));
    const state = JSON.stringify([shouldShow, sourceId, sourceName, overlayRoot, overlays, streamOnly]);
    const key = state + JSON.stringify(values);
    if (key === lastKey) return;
    lastKey = key;

    if (!shouldShow) {
        logger.info("hiding overlay", { sourceId });
        visible = false;
        // the next stream is tried again
        streamState.offscreenSince = 0;
        streamState.failed = "";
        streamState.encoderLogged = false;
        return Native.hide();
    }

    const result = await Native.show(sourceId, sourceName, overlayRoot, overlays, values, streamOnly);
    visible = result != null;
    streamState.offscreenSince = streamOnly && result?.streamOnly ? streamState.offscreenSince || Date.now() : 0;
    // the encoder hook is not reachable yet (Discord was not reloaded since the plugin registered its script): try again
    if (streamOnly && result && !result.streamOnly) lastKey = "";
    if (state !== lastState) {
        logger.info("showing overlay", { sourceId, sourceName, ...result });
        Native.note(`showing: source ${sourceId}, "stream only" ${streamOnly ? "on" : settings.store.streamOnly ? "on but given up for this stream" : "off"}, overlays ${overlays.join(", ")}`);
    }
    lastState = state;
}

const sync = () => queue = queue.then(doSync).catch(e => logger.error("sync failed", e));

/** Overlays can save values themselves (the keyboard saves where it was dragged to): they end up in the settings. */
async function collect() {
    if (!running || !visible) return;

    const changes = await Native.takeChanges();
    if (!Object.keys(changes).length) return;

    updateValues(values => {
        for (const [name, saved] of Object.entries(changes)) Object.assign(values[name] ??= {}, saved);
    });
}

export function startSync() {
    running = true;
    FluxDispatcher.subscribe("STREAM_START", onStreamStart);
    SettingsStore.addPrefixChangeListener(SETTINGS_PATH, sync);
    syncTimer = setInterval(sync, SYNC_INTERVAL_MS);
    collectTimer = setInterval(() => collect().catch(e => logger.error("collect failed", e)), COLLECT_INTERVAL_MS);
    startAppPresets();
    startSpotify();
    sync();
}

export function stopSync() {
    running = false;
    visible = false;
    streamState.hooked = false;
    clearInterval(syncTimer);
    clearInterval(collectTimer);
    stopAppPresets();
    stopSpotify();
    document.documentElement.removeAttribute(SELF_ATTRIBUTE);
    FluxDispatcher.unsubscribe("STREAM_START", onStreamStart);
    SettingsStore.removePrefixChangeListener(SETTINGS_PATH, sync);
    lastKey = "";
    lastState = "";
    Native.hide(false);
}
