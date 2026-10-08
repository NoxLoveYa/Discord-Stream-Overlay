/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { SettingsStore } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { ApplicationStreamingStore, FluxDispatcher, MediaEngineStore } from "@webpack/common";

import { startAppPresets, stopAppPresets } from "./appPresets";
import { Native, settings, updateValues } from "./settings";

const logger = new Logger("StreamOverlay");

const SETTINGS_PATH = "plugins.StreamOverlay";
const SYNC_INTERVAL_MS = 1000;
const COLLECT_INTERVAL_MS = 400;

let running = false;
let visible = false;
let syncTimer: ReturnType<typeof setInterval> | undefined;
let collectTimer: ReturnType<typeof setInterval> | undefined;
let lastKey = "";
let lastState = "";
let sourceName: string | null = null;
// one sync at a time, so quick successive changes (dragging a color picker) cannot be applied out of order
let queue: Promise<unknown> = Promise.resolve();

const onStreamStart = (e: { sourceName?: string; }) => {
    sourceName = e.sourceName ?? null;
};

/** Shows, updates or hides the overlay window to match the stream and the settings. */
async function doSync() {
    if (!running) return;

    const sourceId = MediaEngineStore.getGoLiveSource()?.desktopSource?.id ?? null;
    const active = ApplicationStreamingStore.getCurrentUserActiveStream();
    const { overlayRoot, alwaysShow } = settings.store;
    // the store hands out proxies, which cannot cross IPC
    const overlays = [...settings.store.enabledOverlays];
    const values = JSON.parse(JSON.stringify(settings.store.overlayValues));

    const shouldShow = overlays.length > 0 && (alwaysShow || (active != null && sourceId?.startsWith("screen") === true));
    const state = JSON.stringify([shouldShow, sourceId, sourceName, overlayRoot, overlays]);
    const key = state + JSON.stringify(values);
    if (key === lastKey) return;
    lastKey = key;

    if (!shouldShow) {
        logger.info("hiding overlay", { sourceId });
        visible = false;
        return Native.hide();
    }

    const result = await Native.show(sourceId, sourceName, overlayRoot, overlays, values);
    visible = result != null;
    if (state !== lastState) logger.info("showing overlay", { sourceId, sourceName, ...result });
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
    sync();
}

export function stopSync() {
    running = false;
    visible = false;
    clearInterval(syncTimer);
    clearInterval(collectTimer);
    stopAppPresets();
    FluxDispatcher.unsubscribe("STREAM_START", onStreamStart);
    SettingsStore.removePrefixChangeListener(SETTINGS_PATH, sync);
    lastKey = "";
    lastState = "";
    Native.hide(false);
}
