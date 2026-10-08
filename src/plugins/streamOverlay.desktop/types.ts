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
    /** the tab of the overlay's settings page it is on */
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

/** `position` was true at `at` (Date.now()), and moves on from there while `playing` */
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


/** The local League of Legends player while a game is live, or null outside one. */
export interface LolState {
    /** Data Dragon champion id ("Fiora") */
    champion: string;
    /** the QWER ability icon addresses, "" when unknown */
    spells: string[];
    /** "summoner-flash" style ids, "" when unknown */
    summonerD: string;
    summonerF: string;
}

/** A font the user added: a file imported into the fonts folder, or a system font by name (`file` is null). */
export interface FontEntry {
    /** shown in the font picker */
    name: string;
    /** the CSS family, like "ObnoxiousGothic" or "Consolas" */
    family: string;
    file: string | null;
}

/** Only the values that differ from the defaults are kept */
export interface OverlayPreset {
    name: string;
    values: Record<string, OverlayValue>;
}

/** By overlay name */
export type OverlayPresets = Record<string, OverlayPreset[]>;

export interface AppBinding {
    /** the file name of the program, like "game.exe", in lower case */
    app: string;
    /** the name of a global preset */
    preset: string;
    enabled: boolean;
}

export interface GlobalPreset {
    name: string;
    enabled: string[];
    values: OverlayValues;
}
