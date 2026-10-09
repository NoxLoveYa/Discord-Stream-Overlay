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
import { GRACE_MS, judgeHook, UNSUPPORTED_ENCODER } from "./health";
import { Native, plain, saveOverlayChanges, settings, withGlobalFont } from "./settings";
import { softwareWanted, useSoftwareEncoder } from "./softwareStream";
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
// stream only takes the overlay off the screen: when this stream is not encoded by NVENC it would be in neither place
let lastHealth = 0;
let lastStreamOnly = false;
// one sync at a time, so quick successive changes (dragging a color picker) cannot be applied out of order
let queue: Promise<unknown> = Promise.resolve();

const onStreamStart = (e: { sourceName?: string; }) => {
    sourceName = e.sourceName ?? null;
};

function publishSelf() {
    const id = UserStore.getCurrentUser()?.id;
    if (id) document.documentElement.setAttribute(SELF_ATTRIBUTE, id);
}

async function checkHook() {
    if (!streamState.offscreenSince || streamState.failed || Date.now() - lastHealth < HEALTH_INTERVAL_MS) return;
    lastHealth = Date.now();

    const waited = Date.now() - streamState.offscreenSince;
    const status = await Native.streamHealth();

    // with nobody watching, Discord encodes nothing and the hook has nothing to see: no reason to give up
    const encoding = status?.encodes === 0 && waited >= GRACE_MS ? await Native.streamEncoding().catch(() => null) : null;
    const reason = judgeHook(status, waited, encoding);
    if (!reason) return;

    const encoder = await Native.streamEncoder().catch(() => null);

    // the card's own encoder (AMD, Intel...) cannot be drawn into but Windows' software one can: the stream goes there before giving up,
    // and the new encoder gets its own grace period
    if (reason === UNSUPPORTED_ENCODER && encoder?.kind !== "media-foundation-sw" && !softwareWanted()) {
        useSoftwareEncoder();
        streamState.offscreenSince = Date.now();
        logger.info("stream only switches this stream to Windows' software encoder", encoder?.label);
        showNotification({
            title: "StreamOverlay",
            body: `${explainEncoder(encoder)}. Stream only now sends this stream through Windows' software encoder, which uses more of your processor. If the overlay does not show up in a few seconds, stop and start the share again.`,
            noPersist: true
        });
        return;
    }

    streamState.failed = reason;
    lastKey = "";
    logger.warn("stream only does not work with this stream, the overlays go back on the screen", reason, encoder?.label);
    showNotification({
        title: "StreamOverlay",
        body: `"Stream only" does not work with this stream (${reason}), so the overlays are on your screen instead. ${explainEncoder(encoder)}.`,
        noPersist: true
    });
}

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
    const values = withGlobalFont(plain(settings.store.overlayValues), overlays);

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
        return Native.hide();
    }

    const result = await Native.show(sourceId, sourceName, overlayRoot, overlays, values, streamOnly);
    visible = result != null;
    streamState.offscreenSince = streamOnly && result?.streamOnly ? streamState.offscreenSince || Date.now() : 0;
    // the encoder hook is not reachable yet (Discord was not reloaded since the plugin registered its script): try again
    if (streamOnly && result && !result.streamOnly) lastKey = "";
    if (state !== lastState) {
        logger.info("showing overlay", { sourceId, sourceName, ...result });
    }
    lastState = state;
}

const sync = () => queue = queue.then(doSync).catch(e => logger.error("sync failed", e));

async function collect() {
    if (!running || !visible) return;

    const changes = await Native.takeChanges();
    if (Object.keys(changes).length) saveOverlayChanges(changes);
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
