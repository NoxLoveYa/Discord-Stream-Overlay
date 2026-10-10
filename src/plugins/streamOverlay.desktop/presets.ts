/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isShown } from "./groups";
import { effectiveFontValue } from "./main/values";
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

// `except` lets a preset be renamed to another case of its own name
export const isTaken = (list: Named[], name: string, except = "") => {
    const other = findPreset(list, name);
    return !!other && !sameName(other.name, except);
};

// "Stream" gives "Stream copy", then "Stream copy 2"...
export function copyName(list: Named[], name: string) {
    const base = name.replace(/ copy( \d+)?$/i, "");
    for (let n = 1; ; n++) {
        const suffix = n === 1 ? " copy" : ` copy ${n}`;
        const candidate = base.slice(0, MAX_NAME - suffix.length) + suffix;
        if (!findPreset(list, candidate)) return candidate;
    }
}

export function newName(list: Named[]) {
    for (let n = 1; ; n++) if (!findPreset(list, `Preset ${n}`)) return `Preset ${n}`;
}

export function renamePreset<T extends Named>(list: T[], from: string, to: string): T[] {
    if (isTaken(list, to, from)) return list;
    return list.map(p => sameName(p.name, from) ? { ...p, name: to } : p);
}

export function withPreset<T extends Named>(list: T[], preset: T): T[] {
    return findPreset(list, preset.name) ? list.map(p => sameName(p.name, preset.name) ? preset : p) : [...list, preset];
}

export const withoutPreset = <T extends Named>(list: T[], name: string) => list.filter(p => !sameName(p.name, name));

// a value that is not saved is its default; a font follows the chosen option when nothing is saved, so fonts compare as effective
export const sameSettings = (settings: OverlaySetting[], a: Stored, b: Stored, globalFont: unknown = "default") =>
    settings.every(s => s.type === "font"
        ? effectiveFontValue(s, settings, a ?? {}, globalFont) === effectiveFontValue(s, settings, b ?? {}, globalFont)
        : (a?.[s.id] ?? s.default) === (b?.[s.id] ?? s.default));

export const colorsOf = (settings: OverlaySetting[], stored: Stored) =>
    settings.filter(s => s.type === "color" && isShown(s, settings, stored)).map(s => String(stored?.[s.id] ?? s.default));

export const changedCount = (settings: OverlaySetting[], stored: Stored, globalFont: unknown = "default") =>
    settings.filter(s => s.type === "font"
        ? effectiveFontValue(s, settings, stored ?? {}, globalFont) !== effectiveFontValue(s, settings, {}, globalFont)
        : stored?.[s.id] !== undefined && stored[s.id] !== s.default).length;

export function captureGlobal(name: string, overlays: OverlayInfo[], enabled: string[], values: OverlayValues): GlobalPreset {
    return {
        name,
        enabled: overlays.map(o => o.name).filter(n => enabled.includes(n)),
        values: Object.fromEntries(overlays.map(o => [o.name, { ...values[o.name] }]))
    };
}

// overlays added since the preset was saved keep their state
export function applyGlobal(preset: GlobalPreset, enabled: string[], values: OverlayValues) {
    const known = Object.keys(preset.values);
    return {
        enabled: [...preset.enabled, ...enabled.filter(n => !known.includes(n))],
        values: { ...values, ...Object.fromEntries(known.map(n => [n, { ...preset.values[n] }])) }
    };
}

export function isGlobalActive(preset: GlobalPreset, overlays: OverlayInfo[], enabled: string[], values: OverlayValues, globalFont: unknown = "default") {
    const known = overlays.filter(o => has(preset.values, o.name));
    return known.length > 0 && known.every(o =>
        preset.enabled.includes(o.name) === enabled.includes(o.name)
        && sameSettings(o.settings, preset.values[o.name], values[o.name], globalFont)
    );
}
