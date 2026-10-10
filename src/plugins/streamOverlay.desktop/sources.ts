/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";

import { Native } from "./settings";
import { spotifySource } from "./spotify";
import type { Source } from "./types";

const logger = new Logger("StreamOverlay");

// Listeners on Discord that feed a channel of the overlays (main/channels.ts): each pushes its state under the name of its channel.
const SOURCES: Source[] = [spotifySource];

export function startSources() {
    for (const source of SOURCES) {
        source.start(state => Native.setChannel(source.channel, state).catch(e => logger.error(`could not pass on ${source.channel}`, e)));
    }
}

export function stopSources() {
    for (const source of SOURCES) {
        source.stop();
        Native.setChannel(source.channel, null).catch(() => { /* the plugin is stopping: the overlays are going away too */ });
    }
}
