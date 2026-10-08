/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType, PluginNative } from "@utils/types";

import { OverlayPicker } from "./components/OverlayPicker";
import { applyGlobal } from "./presets";
import type { AppBinding, GlobalPreset, OverlayPresets, OverlayValues } from "./types";

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
    appBindings: {
        type: OptionType.CUSTOM,
        default: [] as AppBinding[]
    },
    appRevert: {
        type: OptionType.CUSTOM,
        default: true
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
export const plain = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));

/** Edits a copy of a stored object in place, or returns what should replace it. */
export function updateStored<K extends "overlayValues" | "overlayPresets" | "globalPresets" | "appBindings">(
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

/** Which overlays are on and the settings of all of them, as they are now. */
export const snapshotState = () => ({ enabled: [...settings.store.enabledOverlays], values: plain(settings.store.overlayValues) });

export function restoreState(state: ReturnType<typeof snapshotState>) {
    settings.store.enabledOverlays = [...state.enabled];
    settings.store.overlayValues = plain(state.values);
}

/** Sets the toggles and the settings of every overlay the preset knows. Returns what puts everything back. */
export function applyGlobalPreset(preset: GlobalPreset) {
    const before = snapshotState();
    const next = applyGlobal(preset, before.enabled, plain(before.values));
    settings.store.enabledOverlays = next.enabled;
    settings.store.overlayValues = next.values;

    return () => restoreState(before);
}
