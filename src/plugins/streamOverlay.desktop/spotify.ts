/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { FluxDispatcher } from "@webpack/common";

import { Native } from "./settings";
import type { MediaState } from "./types";

const logger = new Logger("StreamOverlay");

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

function onPlayerState({ track, isPlaying, position }: PlayerState) {
    const state: MediaState | null = track && {
        id: track.id,
        title: track.name,
        artists: (track.artists ?? []).map(a => a.name),
        album: track.album?.name ?? "",
        cover: track.album?.image?.url ?? "",
        duration: track.duration,
        position: position ?? 0,
        playing: isPlaying ?? false,
        at: Date.now()
    };
    Native.setMedia(state).catch(e => logger.error("could not pass on the track", e));
}

export function startSpotify() {
    FluxDispatcher.subscribe("SPOTIFY_PLAYER_STATE", onPlayerState);
}

export function stopSpotify() {
    FluxDispatcher.unsubscribe("SPOTIFY_PLAYER_STATE", onPlayerState);
    Native.setMedia(null).catch(() => { /* the plugin is stopping: the overlays are going away too */ });
}
