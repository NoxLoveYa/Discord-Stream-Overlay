/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { MediaState } from "@plugins/streamOverlay.desktop/types";

import type { Channel } from "./channels";
import { clamp, finite, record, text } from "./values";

const COVER = /^https:\/\/[\w-]+\.scdn\.co\/[\w./-]{1,200}$/i;
const HOUR_MS = 3_600_000;

const sample = (): MediaState => ({
    id: "sample",
    title: "Song title",
    artists: ["Artist"],
    album: "",
    cover: "",
    duration: 215_000,
    position: 64_000,
    playing: false,
    at: Date.now()
});

// the state comes from the renderer, and the names in it from Spotify: it is only ever shown as text
function clean(input: unknown): MediaState | null {
    const raw = record(input);
    const title = text(raw.title, 200);
    if (!title) return null;

    const duration = finite(raw.duration) ? clamp(raw.duration, 0, 10 * HOUR_MS) : 0;
    return {
        id: text(raw.id, 64),
        title,
        artists: (Array.isArray(raw.artists) ? raw.artists : []).map((a: unknown) => text(a, 100)).filter(Boolean).slice(0, 8),
        album: text(raw.album, 200),
        cover: typeof raw.cover === "string" && COVER.test(raw.cover) ? raw.cover : "",
        duration,
        position: finite(raw.position) ? clamp(raw.position, 0, duration) : 0,
        playing: raw.playing === true,
        at: finite(raw.at) ? raw.at : Date.now()
    };
}

/** The track that is playing in Spotify, fed by spotify.ts. */
export const mediaChannel: Channel<MediaState> = { name: "media", clean, sample };
