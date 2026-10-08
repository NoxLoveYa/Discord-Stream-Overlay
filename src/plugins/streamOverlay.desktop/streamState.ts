/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What sync.ts knows about "stream only" for the running stream. Apart from it so that the settings page does not import
// the loop (which imports the settings, which import the page).
export const streamState = {
    /** since when the overlay has been off the screen (stream only in use), 0 when it is not */
    offscreenSince: 0,
    /** why "stream only" was given up for this stream, "" when it was not */
    failed: "",
    hooked: false
};
