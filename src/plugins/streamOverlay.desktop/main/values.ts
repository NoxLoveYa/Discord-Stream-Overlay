/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { OverlaySetting, OverlayValue } from "@plugins/streamOverlay.desktop/types";

export const COLOR = /^#[0-9a-f]{6}$/i;

export const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const text = (value: unknown, max: number) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

// values come from the renderer or from an overlay page: anything no longer valid for the setting becomes its default
export function resolveValue(setting: OverlaySetting, stored: unknown): OverlayValue {
    switch (setting.type) {
        case "color":
            return typeof stored === "string" && COLOR.test(stored) ? stored.toLowerCase() : setting.default;
        case "number":
            return finite(stored) ? clamp(stored, setting.min ?? -Infinity, setting.max ?? Infinity) : setting.default;
        case "boolean":
            return typeof stored === "boolean" ? stored : setting.default;
        case "select":
            return setting.options?.some(o => o.value === stored) ? stored as string : setting.default;
    }
}

// Applies the settings inside an overlay's frame: a CSS variable and a data attribute per setting on <html> (colors also
// get `--id-rgb`, "r g b"), and a `streamoverlay:settings` event with every value.
export function settingsScript(settings: OverlaySetting[], stored: Record<string, unknown> = {}) {
    const vars: Record<string, string> = {};
    const attrs: Record<string, string> = {};
    const detail: Record<string, OverlayValue> = {};

    for (const setting of settings) {
        const value = resolveValue(setting, stored[setting.id]);
        detail[setting.id] = value;
        attrs[`data-${setting.id}`] = String(value);

        if (setting.type === "color") {
            const hex = value as string;
            vars[`--${setting.id}`] = hex;
            vars[`--${setting.id}-rgb`] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(" ");
        } else if (setting.type === "number") {
            vars[`--${setting.id}`] = `${value}${setting.unit ?? ""}`;
        } else {
            vars[`--${setting.id}`] = setting.type === "boolean" ? (value ? "1" : "0") : String(value);
        }
    }

    return `(() => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(${JSON.stringify(vars)})) root.style.setProperty(k, v);
    for (const [k, v] of Object.entries(${JSON.stringify(attrs)})) root.setAttribute(k, v);
    window.dispatchEvent(new CustomEvent("streamoverlay:settings", { detail: ${JSON.stringify(detail)} }));
})()`;
}
