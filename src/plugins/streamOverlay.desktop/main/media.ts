/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { MediaState } from "@plugins/streamOverlay.desktop/types";

import { clamp, finite } from "./values";

const COVER = /^https:\/\/[\w-]+\.scdn\.co\/[\w./-]{1,200}$/i;
const HOUR_MS = 3_600_000;

const text = (value: unknown, max: number) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Shown in the Layout tab while nothing is playing, so that there is something to drag. */
export const SAMPLE_MEDIA = (): MediaState => ({
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

/** The state comes from the renderer, and the names in it from Spotify: it is only ever shown as text. */
export function cleanMedia(raw: any): MediaState | null {
    const title = text(raw?.title, 200);
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
