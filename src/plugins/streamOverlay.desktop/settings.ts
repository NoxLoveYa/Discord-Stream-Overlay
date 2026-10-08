/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType, PluginNative } from "@utils/types";

import { OverlayPicker } from "./components/OverlayPicker";
import { applyGlobal } from "./presets";
import type { GlobalPreset, OverlayPresets, OverlayValues } from "./types";

export const Native = VencordNative.pluginHelpers.StreamOverlay as PluginNative<typeof import("./native")>;

export const settings = definePluginSettings({
    overlayRoot: {
        type: OptionType.CUSTOM,
        default: ""
    },
    enabledOverlays: {
        type: OptionType.CUSTOM,
        default: ["red-border", "keyboard"] as string[]
    },
    overlayValues: {
        type: OptionType.CUSTOM,
        default: {} as OverlayValues
    },
    overlayPresets: {
        type: OptionType.CUSTOM,
        default: {} as OverlayPresets
    },
    globalPresets: {
        type: OptionType.CUSTOM,
        default: [] as GlobalPreset[]
    },
    overlayPicker: {
        type: OptionType.COMPONENT,
        component: OverlayPicker
    },
    alwaysShow: {
        type: OptionType.BOOLEAN,
        description: "Show the overlays even when not screensharing (for testing)",
        default: false
    }
});

// settings.store hands out proxies: work on plain copies and assign them back
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Edits a copy of a stored object in place, or returns what should replace it. */
export function updateStored<K extends "overlayValues" | "overlayPresets" | "globalPresets">(
    key: K,
    edit: (value: (typeof settings.store)[K]) => (typeof settings.store)[K] | void
) {
    const value = plain(settings.store[key]);
    settings.store[key] = edit(value) ?? value;
}

export const updateValues = (edit: (values: OverlayValues) => void) => updateStored("overlayValues", edit);

export function setOverlayEnabled(name: string, on: boolean) {
    const others = settings.store.enabledOverlays.filter(n => n !== name);
    settings.store.enabledOverlays = on ? [...others, name] : others;
}

export function applyGlobalPreset(preset: GlobalPreset) {
    const next = applyGlobal(preset, [...settings.store.enabledOverlays], plain(settings.store.overlayValues));
    settings.store.enabledOverlays = next.enabled;
    settings.store.overlayValues = next.values;
}
