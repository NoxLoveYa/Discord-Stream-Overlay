/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// How an overlay's settings are laid out on its page: no React and no store, so it can be tested alone.

import type { OverlaySetting, OverlayValue } from "./types";

export interface SettingsTab {
    id: string;
    label: string;
    settings: OverlaySetting[];
}

const FIRST_TAB = "Settings";

/** What a setting is now: what is stored for it, or its default. */
export const valueOf = (settings: OverlaySetting[], stored: Record<string, OverlayValue> | undefined, id: string) =>
    stored?.[id] ?? settings.find(s => s.id === id)?.default;

/** Settings the user can see: not the hidden ones, and not the ones that belong to another value of a setting (`when`). */
export const isShown = (setting: OverlaySetting, settings: OverlaySetting[], stored: Record<string, OverlayValue> | undefined) =>
    !setting.hidden && (!setting.when || valueOf(settings, stored, setting.when.id) === setting.when.value);

/**
 * The tabs of the overlay's page that hold its settings, in the order the groups first appear. A setting without a
 * group goes on the first tab; an overlay that uses no groups has the one tab, "Settings". Tabs with nothing to show
 * (all of it belongs to another value) are left out.
 */
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

/** Overlays under their heading, the headings in alphabetical order and the ones without a category last. */
export function byCategory<T extends { category: string; }>(items: T[]): { category: string; items: T[]; }[] {
    const sections = new Map<string, T[]>();
    for (const item of items) sections.set(item.category, [...(sections.get(item.category) ?? []), item]);

    return [...sections.entries()]
        .sort(([a], [b]) => (a === "") === (b === "") ? a.localeCompare(b) : a === "" ? 1 : -1)
        .map(([category, list]) => ({ category, items: list }));
}
