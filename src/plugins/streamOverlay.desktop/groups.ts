/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// How an overlay's settings are laid out on its page: no React and no store, so it can be tested alone.

import type { OverlaySetting, OverlayValue } from "./types";

interface SettingsTab {
    id: string;
    label: string;
    settings: OverlaySetting[];
}

const FIRST_TAB = "Settings";

const valueOf = (settings: OverlaySetting[], stored: Record<string, OverlayValue> | undefined, id: string) =>
    stored?.[id] ?? settings.find(s => s.id === id)?.default;

/** Not the hidden settings, nor the ones that belong to another value of a setting (`when`). */
export const isShown = (setting: OverlaySetting, settings: OverlaySetting[], stored: Record<string, OverlayValue> | undefined) =>
    !setting.hidden && (!setting.when || valueOf(settings, stored, setting.when.id) === setting.when.value);

/** Tabs in the order the groups first appear; a setting without a group goes on the first tab. Tabs with nothing to show are left out. */
export function settingsTabs(settings: OverlaySetting[], stored: Record<string, OverlayValue> | undefined): SettingsTab[] {
    const shown = settings.filter(s => isShown(s, settings, stored));
    const firstGroup = settings.find(s => s.group)?.group ?? FIRST_TAB;

    const tabs = new Map<string, SettingsTab>();
    for (const setting of shown) {
        const label = setting.group ?? firstGroup;
        const tab = tabs.get(label) ?? { id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"), label, settings: [] };
        tab.settings.push(setting);
        tabs.set(label, tab);
    }
    return [...tabs.values()];
}

/** Headings in alphabetical order, the empty category last. */
export function byCategory<T extends { category: string; }>(items: T[]): { category: string; items: T[]; }[] {
    const sections = new Map<string, T[]>();
    for (const item of items) sections.set(item.category, [...(sections.get(item.category) ?? []), item]);

    return [...sections.entries()]
        .sort(([a], [b]) => (a === "") === (b === "") ? a.localeCompare(b) : a === "" ? 1 : -1)
        .map(([category, list]) => ({ category, items: list }));
}
