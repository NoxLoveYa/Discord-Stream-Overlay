/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { ApplicationStreamingStore, FluxDispatcher, MediaEngineStore } from "@webpack/common";

const Native = VencordNative.pluginHelpers.StreamOverlay as PluginNative<typeof import("./native")>;
const logger = new Logger("StreamOverlay");

const settings = definePluginSettings({
    color: {
        type: OptionType.STRING,
        description: "Border colour (hex, e.g. #ff0000)",
        default: "#ff0000",
        onChange: () => sync()
    },
    width: {
        type: OptionType.NUMBER,
        description: "Border width in pixels",
        default: 4,
        onChange: () => sync()
    },
    alwaysShow: {
        type: OptionType.BOOLEAN,
        description: "Show the overlay even when not screensharing (for testing)",
        default: false,
        onChange: () => sync()
    }
});

let poll: ReturnType<typeof setInterval> | undefined;
let lastKey = "";
let sourceName: string | null = null;

const onStreamStart = (e: { sourceName?: string; }) => {
    sourceName = e.sourceName ?? null;
};

async function sync() {
    const sourceId = MediaEngineStore.getGoLiveSource()?.desktopSource?.id ?? null;
    const active = ApplicationStreamingStore.getCurrentUserActiveStream();

    const shouldShow = settings.store.alwaysShow || (active != null && sourceId?.startsWith("screen") === true);
    const key = JSON.stringify([shouldShow, sourceId, sourceName, settings.store.color, settings.store.width]);
    if (key === lastKey) return;
    lastKey = key;

    if (!shouldShow) {
        logger.info("hiding overlay", { sourceId });
        return Native.hide();
    }

    const result = await Native.show(sourceId, sourceName, { color: settings.store.color, width: settings.store.width });
    logger.info("showing overlay", { sourceId, sourceName, ...result });
}

export default definePlugin({
    name: "StreamOverlay",
    description: "Draws a click-through overlay over the screen you are sharing, so it is captured into your stream",
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
        Native.hide();
    }
});
