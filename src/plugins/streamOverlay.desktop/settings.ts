/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType, PluginNative } from "@utils/types";

import { OverlayPicker } from "./components/OverlayPicker";
import { migrateLegacy } from "./migrate";
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
    /** The font of every overlay that has no font of its own ("default" keeps the old look). */
    globalFont: {
        type: OptionType.CUSTOM,
        default: "default"
    },
    overlayPicker: {
        type: OptionType.COMPONENT,
        component: OverlayPicker
    },
    streamOnly: {
        type: OptionType.BOOLEAN,
        description: "Only draw the overlays on the stream and its preview, not on your own screen. Works with NVIDIA's encoder and Windows' software encoder; otherwise the overlays stay on your screen. The overlays cannot be dragged on screen while it is on (use the Layout tab)",
        default: true
    },
    alwaysShow: {
        type: OptionType.BOOLEAN,
        description: "Show the overlays even when not screensharing (for testing)",
        default: false
    }
});

export function migrateOverlays() {
    const { store } = settings;
    const moved = migrateLegacy({
        enabled: [...store.enabledOverlays],
        values: plain(store.overlayValues),
        presets: plain(store.overlayPresets),
        globals: plain(store.globalPresets)
    });
    if (!moved) return;

    store.enabledOverlays = moved.enabled;
    store.overlayValues = moved.values;
    store.overlayPresets = moved.presets;
    store.globalPresets = moved.globals;
}

// settings.store hands out proxies: work on plain copies and assign them back
export const plain = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));

// `edit` changes the copy in place, or returns what should replace it
export function updateStored<K extends "overlayValues" | "overlayPresets" | "globalPresets" | "appBindings">(
    key: K,
    edit: (value: (typeof settings.store)[K]) => (typeof settings.store)[K] | void
) {
    const value = plain(settings.store[key]);
    settings.store[key] = edit(value) ?? value;
}

export const updateValues = (edit: (values: OverlayValues) => void) => updateStored("overlayValues", edit);

/**
 * Values as the overlay window receives them: an explicit global font fills in where an overlay has none of its
 * own. A global "default" fills nothing, so the theme's default still applies (gothic draws blackletter).
 * An overlay without a `font` setting keeps the extra key, which it ignores (only declared settings are applied).
 */
export function withGlobalFont(values: OverlayValues, names: string[]): OverlayValues {
    const globalFont = typeof settings.store.globalFont === "string" ? settings.store.globalFont : "default";
    if (globalFont === "default") return { ...values };
    const merged: OverlayValues = { ...values };
    for (const name of names) merged[name] = { font: globalFont, ...merged[name] };
    return merged;
}

export function setOverlayEnabled(name: string, on: boolean) {
    const others = settings.store.enabledOverlays.filter(n => n !== name);
    settings.store.enabledOverlays = on ? [...others, name] : others;
}

export const snapshotState = () => ({ enabled: [...settings.store.enabledOverlays], values: plain(settings.store.overlayValues) });

export function restoreState(state: ReturnType<typeof snapshotState>) {
    settings.store.enabledOverlays = [...state.enabled];
    settings.store.overlayValues = plain(state.values);
}

/** Returns what puts everything back. */
export function applyGlobalPreset(preset: GlobalPreset) {
    const before = snapshotState();
    const next = applyGlobal(preset, before.enabled, plain(before.values));
    settings.store.enabledOverlays = next.enabled;
    settings.store.overlayValues = next.values;

    return () => restoreState(before);
}
