/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationStreamingStore } from "@webpack/common";

import { settings } from "./settings";

// Discord's Game Mode caps its own window at 10 fps while a game runs and Discord is in the background, which makes the preview of
// a stream (and the overlay drawn on it) crawl. index.tsx patches its `isThrottling` getter to ask this first.
export function allowGameModeThrottle() {
    try {
        return !settings.store.keepFullFramerate || ApplicationStreamingStore.getAllActiveStreams().length === 0;
    } catch {
        // this runs inside Discord's own store: when it cannot be answered, Game Mode does what it always did
        return true;
    }
}
