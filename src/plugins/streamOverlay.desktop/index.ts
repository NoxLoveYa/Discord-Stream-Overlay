/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { ApplicationStreamingStore, FluxDispatcher, MediaEngineStore } from "@webpack/common";

import { Native, settings } from "./settings";

const logger = new Logger("StreamOverlay");

let poll: ReturnType<typeof setInterval> | undefined;
let lastKey = "";
let sourceName: string | null = null;

const onStreamStart = (e: { sourceName?: string; }) => {
    sourceName = e.sourceName ?? null;
};

async function sync() {
    const sourceId = MediaEngineStore.getGoLiveSource()?.desktopSource?.id ?? null;
    const active = ApplicationStreamingStore.getCurrentUserActiveStream();
    const { overlayRoot, alwaysShow } = settings.store;
    // settings.store values are proxies, which cannot cross IPC
    const overlays = [...settings.store.enabledOverlays];

    const shouldShow = overlays.length > 0 && (alwaysShow || (active != null && sourceId?.startsWith("screen") === true));
    const key = JSON.stringify([shouldShow, sourceId, sourceName, overlayRoot, overlays]);
    if (key === lastKey) return;
    lastKey = key;

    if (!shouldShow) {
        logger.info("hiding overlay", { sourceId });
        return Native.hide();
    }

    const result = await Native.show(sourceId, sourceName, overlayRoot, overlays);
    logger.info("showing overlay", { sourceId, sourceName, ...result });
}

export default definePlugin({
    name: "StreamOverlay",
    description: "Draws HTML/CSS overlays over the screen you are sharing, so they are captured into your stream",
    authors: [Devs.NoxLoveYa],
    tags: ["Voice", "Appearance"],
    settings,

    start() {
        FluxDispatcher.subscribe("STREAM_START", onStreamStart);
        poll = setInterval(sync, 1000);
        sync();
    },

    stop() {
        clearInterval(poll);
        FluxDispatcher.unsubscribe("STREAM_START", onStreamStart);
        lastKey = "";
        Native.hide(false);
    }
});
