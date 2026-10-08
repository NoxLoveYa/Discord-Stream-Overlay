/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { OverlaySetting, OverlayValue } from "@plugins/streamOverlay.desktop/types";

export const COLOR = /^#[0-9a-f]{6}$/i;

/** A font family is a plain name: no quotes, commas or semicolons, so a value can never break out of a `font-family`. */
export const FONT_FAMILY = /^[A-Za-z0-9][A-Za-z0-9 -]{0,59}$/;

export const MAX_FONT_FILE_MB = 5;

/** What "Default" draws with: the look the overlays had before the font setting existed. */
export const DEFAULT_FONT_STACK = "'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif";

/** The choices every bundled overlay offers besides its customs ("ObnoxiousGothic" ships in their font.css). */
export const BUILTIN_FONTS = [
    { label: "Default", value: "default" },
    { label: "Gothic blackletter", value: "ObnoxiousGothic" },
    { label: "Consolas", value: "Consolas" },
    { label: "Georgia", value: "Georgia" },
    { label: "Palatino Linotype", value: "Palatino Linotype" }
];

/** A resolved font value as CSS: the default stack, or the family with a readable fallback. */
export const fontCssValue = (family: string) =>
    family === "default" ? DEFAULT_FONT_STACK : `'${family}', 'Segoe UI', system-ui, sans-serif`;

/** The font a theme draws with when nothing else is picked (blackletter for gothic, mono for terminal). */
const THEME_FONTS: Record<string, string> = { gothic: "ObnoxiousGothic", terminal: "Consolas" };

export function themeFontDefault(settings: OverlaySetting[], stored: Record<string, unknown>) {
    const theme = settings.find(s => s.id === "theme" && s.type === "select");
    if (!theme) return "default";
    const value = resolveValue(theme, stored[theme.id]);
    return typeof value === "string" && THEME_FONTS[value] ? THEME_FONTS[value] : "default";
}

/** The theme behind a theme font, for the picker's hint ("gothic", "terminal", null when none). */
export function themeFontName(settings: OverlaySetting[], stored: Record<string, unknown>): string | null {
    const theme = settings.find(s => s.id === "theme" && s.type === "select");
    if (!theme) return null;
    const value = resolveValue(theme, stored[theme.id]);
    return typeof value === "string" && THEME_FONTS[value] ? value : null;
}

/** Where an unset font follows, for the picker's hint: null when it is just the default stack. */
export function fontFollows(settings: OverlaySetting[], stored: Record<string, unknown>, globalFont: unknown = "default"): string | null {
    if (typeof globalFont === "string" && globalFont !== "default" && FONT_FAMILY.test(globalFont))
        return `the default font (${globalFont})`;
    const themeDefault = themeFontDefault(settings, stored);
    const theme = themeFontName(settings, stored);
    return theme && themeDefault !== "default" ? `the ${theme} theme (${themeDefault})` : null;
}

/**
 * What a font setting draws with: the stored family ("default" stored is an explicit choice of the Segoe stack),
 * or the global font when it names another family, or the theme's default. Only nothing stored follows the theme,
 * so a gothic preset applies its blackletter without storing a font, and picking one overrides it.
 */
export function effectiveFontValue(setting: OverlaySetting, settings: OverlaySetting[], stored: Record<string, unknown>, globalFont: unknown = "default") {
    const raw = stored[setting.id];
    if (typeof raw === "string" && FONT_FAMILY.test(raw)) return raw;
    if (typeof globalFont === "string" && globalFont !== "default" && FONT_FAMILY.test(globalFont)) return globalFont;
    return themeFontDefault(settings, stored);
}

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
        case "font":
            // the dropdown only offers known families, but a custom one deleted afterwards stays valid: the CSS falls back
            return typeof stored === "string" && FONT_FAMILY.test(stored) ? stored : setting.default;
    }
}

// Applies the settings inside an overlay's frame: a CSS variable and a data attribute per setting on <html> (colors also
// get `--id-rgb`, "r g b"), and a `streamoverlay:settings` event with every value.
export function settingsScript(settings: OverlaySetting[], stored: Record<string, unknown> = {}) {
    const vars: Record<string, string> = {};
    const attrs: Record<string, string> = {};
    const detail: Record<string, OverlayValue> = {};

    for (const setting of settings) {
        // a font draws with its effective family (stored, global or theme default), so the page and the
        // dropdown agree even when nothing is stored; the event still carries the stored value
        const value = setting.type === "font"
            ? effectiveFontValue(setting, settings, stored)
            : resolveValue(setting, stored[setting.id]);
        detail[setting.id] = setting.type === "font" ? resolveValue(setting, stored[setting.id]) : value;
        attrs[`data-${setting.id}`] = String(value);

        if (setting.type === "color") {
            const hex = value as string;
            vars[`--${setting.id}`] = hex;
            vars[`--${setting.id}-rgb`] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(" ");
        } else if (setting.type === "number") {
            vars[`--${setting.id}`] = `${value}${setting.unit ?? ""}`;
        } else if (setting.type === "font") {
            vars[`--${setting.id}`] = fontCssValue(value as string);
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
