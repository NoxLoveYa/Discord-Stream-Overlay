/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { plugins } from "@api/PluginManager";
import { SettingsStore } from "@api/Settings";
import { MainSettingsIcon } from "@components/Icons";
import { openPluginModal } from "@components/settings";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { ApplicationStreamingStore, FluxDispatcher, MediaEngineStore, Menu } from "@webpack/common";

import { Native, settings, updateValues } from "./settings";

const logger = new Logger("StreamOverlay");

const SETTINGS_PATH = "plugins.StreamOverlay";

let running = false;
let poll: ReturnType<typeof setInterval> | undefined;
let collectPoll: ReturnType<typeof setInterval> | undefined;
let lastKey = "";
let lastState = "";
let sourceName: string | null = null;
// syncs run one after the other so quick successive changes (dragging a color picker) cannot be applied out of order
let queue: Promise<unknown> = Promise.resolve();

const onStreamStart = (e: { sourceName?: string; }) => {
    sourceName = e.sourceName ?? null;
};

async function doSync() {
    if (!running) return;

    const sourceId = MediaEngineStore.getGoLiveSource()?.desktopSource?.id ?? null;
    const active = ApplicationStreamingStore.getCurrentUserActiveStream();
    const { overlayRoot, alwaysShow } = settings.store;
    // settings.store values are proxies, which cannot cross IPC
    const overlays = [...settings.store.enabledOverlays];
    const values = JSON.parse(JSON.stringify(settings.store.overlayValues));

    const shouldShow = overlays.length > 0 && (alwaysShow || (active != null && sourceId?.startsWith("screen") === true));
    const state = JSON.stringify([shouldShow, sourceId, sourceName, overlayRoot, overlays]);
    const key = state + JSON.stringify(values);
    if (key === lastKey) return;
    lastKey = key;

    if (!shouldShow) {
        logger.info("hiding overlay", { sourceId });
        return Native.hide();
    }

    const result = await Native.show(sourceId, sourceName, overlayRoot, overlays, values);
    if (state !== lastState) logger.info("showing overlay", { sourceId, sourceName, ...result });
    lastState = state;
}

const sync = () => queue = queue.then(doSync).catch(e => logger.error("sync failed", e));

// Overlays can save values themselves (the keyboard saves where it was dragged to): they end up in the settings,
// which are stored on disk.
async function collect() {
    if (!running) return;

    const changes = await Native.takeChanges();
    if (!Object.keys(changes).length) return;

    updateValues(values => {
        for (const [name, saved] of Object.entries(changes)) Object.assign(values[name] ??= {}, saved);
    });
}

// "manage-streams" is the menu of the streaming button in the voice panel (Stop Streaming, Change Stream...)
const manageStreamsPatch: NavContextMenuPatchCallback = children => {
    const item = (
        <Menu.MenuItem
            id="vc-stream-overlay-settings"
            label="Overlay Settings"
            icon={MainSettingsIcon}
            leadingAccessory={{ type: "icon", icon: MainSettingsIcon }}
            action={() => openPluginModal(plugins.StreamOverlay)}
        />
    );

    // join the stream options, whichever of them this menu shows
    const group = findGroupChildrenByChildId(
        ["stream-settings-audio-enable", "stream-settings", "change-windows", "stop-streaming"],
        children
    );
    if (group) group.push(item);
    else children.push(<Menu.MenuGroup>{item}</Menu.MenuGroup>);
};

export default definePlugin({
    name: "StreamOverlay",
    description: "Draws HTML/CSS overlays over the screen you are sharing, so they are captured into your stream",
    authors: [Devs.NoxLoveYa],
    tags: ["Voice", "Appearance"],
    settings,

    contextMenus: {
        "manage-streams": manageStreamsPatch
    },

    start() {
        running = true;
        FluxDispatcher.subscribe("STREAM_START", onStreamStart);
        // any change of this plugin's settings (colors, overlay selection...) applies immediately
        SettingsStore.addPrefixChangeListener(SETTINGS_PATH, sync);
        poll = setInterval(sync, 1000);
        collectPoll = setInterval(() => collect().catch(e => logger.error("collect failed", e)), 400);
        sync();
    },

    stop() {
        running = false;
        clearInterval(poll);
        clearInterval(collectPoll);
        FluxDispatcher.unsubscribe("STREAM_START", onStreamStart);
        SettingsStore.removePrefixChangeListener(SETTINGS_PATH, sync);
        lastKey = "";
        lastState = "";
        Native.hide(false);
    }
});
