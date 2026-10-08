/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Shared by the main process and the settings UI: types only, so the UI never pulls in node code.

export type OverlayValue = string | number | boolean;

/** { overlayName: { settingId: value } } */
export type OverlayValues = Record<string, Record<string, OverlayValue>>;

export interface OverlaySetting {
    id: string;
    type: "color" | "number" | "boolean" | "select" | "font";
    label: string;
    default: OverlayValue;
    /** not shown in the settings window, the overlay sets it itself (a dragged position) */
    hidden?: boolean;
    /** the tab of the overlay's settings page it is on; the overlay's settings are all on one tab when none has a group */
    group?: string;
    /** only shown while the setting `id` has this value, like the colors of one theme */
    when?: { id: string; value: OverlayValue; };
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    options?: { label: string; value: string; }[];
}

export interface Manifest {
    /** shown on the overlay's card in the settings, instead of the folder name */
    title: string;
    description: string;
    /** the heading its card is listed under ("Input", "Media"...) */
    category: string;
    keys: string[];
    /** the overlay receives how far the mouse moved and the wheel turned (not where the cursor is) */
    mouse: boolean;
    /** the overlay receives the track that is playing in Spotify */
    media: boolean;
    /** the overlay receives the local League of Legends player's champion and summoner spells while in game */
    lol: boolean;
    /** while all of these are held, the overlay window takes the mouse */
    interactive: string[];
    /** can be moved and resized with the `interactive` keys, so the Layout tab lets you drag it */
    draggable: boolean;
    settings: OverlaySetting[];
}

export interface OverlayInfo {
    /** the folder name */
    name: string;
    title: string;
    description: string;
    category: string;
    draggable: boolean;
    settings: OverlaySetting[];
}

/** The track playing in Spotify; `position` was true at `at` (Date.now()), and moves on from there while `playing` */
export interface MediaState {
    id: string;
    title: string;
    artists: string[];
    album: string;
    /** an https address on Spotify's image servers, or "" */
    cover: string;
    duration: number;
    position: number;
    playing: boolean;
    at: number;
}

/**
 * The local League of Legends player while a game is live, or null outside one. `champion` is the Data Dragon
 * champion id ("Fiora"), `spells` its QWER ability icon addresses ("" when unknown), `summonerD/F` are
 * "summoner-flash" ids ("" when unknown). Everything comes from the game client on this machine.
 */
export interface LolState {
    champion: string;
    spells: string[];
    summonerD: string;
    summonerF: string;
}

/** A font the user added: a file imported into the fonts folder, or a system font by name (`file` is null). */
export interface FontEntry {
    /** shown in the font picker */
    name: string;
    /** the CSS family, like "ObnoxiousGothic" or "Consolas" */
    family: string;
    /** the file in the fonts folder, or null for a system font */
    file: string | null;
}

/** One overlay's settings under a name; only the values that differ from the defaults are kept */
export interface OverlayPreset {
    name: string;
    values: Record<string, OverlayValue>;
}

/** Presets of each overlay, by overlay name */
export type OverlayPresets = Record<string, OverlayPreset[]>;

/** While this program is in focus, the global preset is applied */
export interface AppBinding {
    /** the file name of the program, like "game.exe", in lower case */
    app: string;
    /** the name of a global preset */
    preset: string;
    enabled: boolean;
}

/** Which overlays are on, and the settings of every overlay, under a name */
export interface GlobalPreset {
    name: string;
    enabled: string[];
    values: OverlayValues;
}
