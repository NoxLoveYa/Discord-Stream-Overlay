/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findPreset } from "./presets";
import type { AppBinding, GlobalPreset } from "./types";

export const MAX_APP = 100;

// "C:\Games\Game.exe", "game" and " GAME.EXE " all give "game.exe"; empty when it cannot be the name of a program
export function cleanApp(raw: string) {
    const name = (raw.trim().replace(/^["']+|["']+$/g, "").split(/[\\/]/).pop() ?? "").trim().toLowerCase();
    if (!name || name.length > MAX_APP || /[<>:"|?*\u0000-\u001f]/.test(name)) return "";
    return name.includes(".") ? name : `${name}.exe`;
}

// a program has one binding: a new one replaces the old
export const withBinding = (list: AppBinding[], binding: AppBinding) =>
    list.some(b => b.app === binding.app) ? list.map(b => b.app === binding.app ? binding : b) : [...list, binding];

export const withoutBinding = (list: AppBinding[], app: string) => list.filter(b => b.app !== app);

// a binding whose preset is gone does not apply
export function matchBinding(app: string, bindings: AppBinding[], presets: GlobalPreset[]) {
    for (const binding of bindings) {
        if (!binding.enabled || cleanApp(binding.app) !== app) continue;

        const preset = findPreset(presets, binding.preset);
        if (preset) return { binding, preset };
    }
    return null;
}
