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
    type: "color" | "number" | "boolean" | "select";
    label: string;
    default: OverlayValue;
    /** not shown in the settings window, the overlay sets it itself (a dragged position) */
    hidden?: boolean;
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
    keys: string[];
    /** the overlay receives how far the mouse moved and the wheel turned (not where the cursor is) */
    mouse: boolean;
    /** while all of these are held, the overlay window takes the mouse */
    interactive: string[];
    settings: OverlaySetting[];
}

export interface OverlayInfo {
    /** the folder name */
    name: string;
    title: string;
    description: string;
    settings: OverlaySetting[];
}

/** One overlay's settings under a name; only the values that differ from the defaults are kept */
export interface OverlayPreset {
    name: string;
    values: Record<string, OverlayValue>;
}

/** Presets of each overlay, by overlay name */
export type OverlayPresets = Record<string, OverlayPreset[]>;

/** Which overlays are on, and the settings of every overlay, under a name */
export interface GlobalPreset {
    name: string;
    enabled: string[];
    values: OverlayValues;
}
