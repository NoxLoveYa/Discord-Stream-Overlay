/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The gothic keyboard, mouse and Spotify card used to be overlays of their own; they are now the "gothic" theme of the
// keyboard, mouse and Spotify overlays. No React and no store, so it can be tested alone.

import type { GlobalPreset, OverlayPreset, OverlayPresets, OverlayValue, OverlayValues } from "./types";

type Values = Record<string, OverlayValue>;

// old overlay -> the overlay it is a theme of, and what its settings are called there
const LEGACY: Record<string, { to: string; rename: Record<string, string>; }> = {
    "obnoxious-keyboard": { to: "keyboard", rename: { "letter-accent": "g-letter-accent", "modifier-accent": "g-modifier-accent" } },
    "obnoxious-mouse": { to: "mouse", rename: { "click-accent": "g-click-accent", "motion-accent": "g-motion-accent" } },
    "obnoxious-spotify": { to: "spotify", rename: { accent: "g-accent", accent2: "g-accent2" } }
};

interface MigratableState {
    enabled: string[];
    values: OverlayValues;
    presets: OverlayPresets;
    globals: GlobalPreset[];
}

const convert = (legacy: string, values: Values | undefined): Values => ({
    ...Object.fromEntries(Object.entries(values ?? {}).map(([id, value]) => [LEGACY[legacy].rename[id] ?? id, value])),
    theme: "gothic"
});

function uniqueName(taken: OverlayPreset[], name: string) {
    const used = new Set(taken.map(p => p.name.toLowerCase()));
    if (!used.has(name.toLowerCase())) return name;

    const base = `${name} (gothic)`;
    for (let i = 1; ; i++) {
        const next = i === 1 ? base : `${base} ${i}`;
        if (!used.has(next.toLowerCase())) return next;
    }
}

/** Null when there was nothing to move. */
export function migrateLegacy(state: MigratableState): MigratableState | null {
    const names = Object.keys(LEGACY);
    const used = (list: string[]) => list.some(n => names.includes(n));
    const present = used(state.enabled) || used(Object.keys(state.values)) || used(Object.keys(state.presets)) ||
        state.globals.some(g => used(g.enabled) || used(Object.keys(g.values ?? {})));
    if (!present) return null;

    let enabled = [...state.enabled];
    const values: OverlayValues = structuredClone(state.values);
    const presets: OverlayPresets = structuredClone(state.presets);
    const globals: GlobalPreset[] = structuredClone(state.globals);

    for (const legacy of names) {
        const { to } = LEGACY[legacy];

        if (enabled.includes(legacy)) {
            values[to] = { ...values[to], ...convert(legacy, values[legacy]) };
            if (!enabled.includes(to)) enabled.push(to);
        }
        enabled = enabled.filter(n => n !== legacy);
        delete values[legacy];

        if (presets[legacy]) {
            const target = presets[to] ??= [];
            for (const preset of presets[legacy]) target.push({ name: uniqueName(target, preset.name), values: convert(legacy, preset.values) });
            delete presets[legacy];
        }

        for (const global of globals) {
            global.values ??= {};
            if (global.enabled.includes(legacy)) {
                global.values[to] = { ...global.values[to], ...convert(legacy, global.values[legacy]) };
                if (!global.enabled.includes(to)) global.enabled.push(to);
            }
            global.enabled = global.enabled.filter(n => n !== legacy);
            delete global.values[legacy];
        }
    }

    return { enabled, values, presets, globals };
}
