/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { GlobalPreset, OverlayInfo, OverlayPresets, OverlaySetting, OverlayValue, OverlayValues } from "./types";

export const MAX_NAME = 40;

type Named = { name: string; };
type Stored = Record<string, OverlayValue> | undefined;

export const cleanName = (raw: string) => raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);

// names are typed by hand: "Stream" and "stream" are the same preset
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const has = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

export const findPreset = <T extends Named>(list: T[], name: string) => list.find(p => sameName(p.name, name));

export const presetsOf = (all: OverlayPresets, overlay: string) => has(all, overlay) ? all[overlay] : [];

/** Saving under a name that is taken replaces that preset where it is. */
export function withPreset<T extends Named>(list: T[], preset: T): T[] {
    return findPreset(list, preset.name) ? list.map(p => sameName(p.name, preset.name) ? preset : p) : [...list, preset];
}

export const withoutPreset = <T extends Named>(list: T[], name: string) => list.filter(p => !sameName(p.name, name));

/** Whether two sets of saved values make an overlay look the same: a value that is not saved is its default. */
export const sameSettings = (settings: OverlaySetting[], a: Stored, b: Stored) =>
    settings.every(s => (a?.[s.id] ?? s.default) === (b?.[s.id] ?? s.default));

export function captureGlobal(name: string, overlays: OverlayInfo[], enabled: string[], values: OverlayValues): GlobalPreset {
    return {
        name,
        enabled: overlays.map(o => o.name).filter(n => enabled.includes(n)),
        values: Object.fromEntries(overlays.map(o => [o.name, { ...values[o.name] }]))
    };
}

/** Overlays the preset has never seen (added since it was saved) keep their state. */
export function applyGlobal(preset: GlobalPreset, enabled: string[], values: OverlayValues) {
    const known = Object.keys(preset.values);
    return {
        enabled: [...preset.enabled, ...enabled.filter(n => !known.includes(n))],
        values: { ...values, ...Object.fromEntries(known.map(n => [n, { ...preset.values[n] }])) }
    };
}

export function isGlobalActive(preset: GlobalPreset, overlays: OverlayInfo[], enabled: string[], values: OverlayValues) {
    const known = overlays.filter(o => has(preset.values, o.name));
    return known.length > 0 && known.every(o =>
        preset.enabled.includes(o.name) === enabled.includes(o.name)
        && sameSettings(o.settings, preset.values[o.name], values[o.name])
    );
}
