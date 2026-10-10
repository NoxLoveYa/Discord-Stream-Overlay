/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FluxDispatcher } from "@webpack/common";

import type { MediaState, Source } from "./types";

// what Discord dispatches whenever Spotify (linked to the account) starts, pauses, seeks or changes track
interface PlayerState {
    track: {
        id: string;
        name: string;
        duration: number;
        album?: { name?: string; image?: { url?: string; }; };
        artists?: { name: string; }[];
    } | null;
    isPlaying?: boolean;
    position?: number;
}

let listener: ((state: PlayerState) => void) | null = null;

/** The track that is playing, for the "media" channel. */
export const spotifySource: Source<MediaState> = {
    channel: "media",

    start(push) {
        listener = ({ track, isPlaying, position }) => push(track && {
            id: track.id,
            title: track.name,
            artists: (track.artists ?? []).map(a => a.name),
            album: track.album?.name ?? "",
            cover: track.album?.image?.url ?? "",
            duration: track.duration,
            position: position ?? 0,
            playing: isPlaying ?? false,
            at: Date.now()
        });
        FluxDispatcher.subscribe("SPOTIFY_PLAYER_STATE", listener);
    },

    stop() {
        if (listener) FluxDispatcher.unsubscribe("SPOTIFY_PLAYER_STATE", listener);
        listener = null;
    }
};
