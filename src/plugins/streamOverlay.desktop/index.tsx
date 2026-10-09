/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

import { manageStreamsPatch } from "./menu";
import { migrateOverlays, settings } from "./settings";
import { startSoftwareStream, stopSoftwareStream } from "./softwareStream";
import { startSync, stopSync } from "./sync";

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
        migrateOverlays();
        startSoftwareStream();
        startSync();
    },
    stop() {
        stopSoftwareStream();
        stopSync();
    }
});
