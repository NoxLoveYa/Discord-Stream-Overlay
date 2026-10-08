/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";

import { VIRTUAL_KEYS } from "./keys";

export type OverlayValue = string | number | boolean;

export interface OverlaySetting {
    id: string;
    type: "color" | "number" | "boolean" | "select";
    label: string;
    default: OverlayValue;
    // not shown in the settings window: the overlay sets it itself (e.g. a dragged position)
    hidden?: boolean;
    // number
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    // select
    options?: { label: string; value: string; }[];
}

export interface Manifest {
    keys: string[];
    // while all of these keys are held, the overlay receives the mouse (instead of it passing through to what is below)
    interactive: string[];
    settings: OverlaySetting[];
}

const MAX_KEYS = 32;
const MAX_SETTINGS = 24;
const ID = /^[a-z][a-z0-9-]{0,31}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const OPTION_VALUE = /^[\w .-]{1,40}$/;
const UNIT = /^(px|%|em|rem|vw|vh|deg|s|ms)?$/;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// Manifest content is untrusted: anything that does not validate is dropped or replaced by a safe default.
function parseSetting(raw: any): OverlaySetting | null {
    if (!raw || typeof raw.id !== "string" || !ID.test(raw.id)) return null;

    const base = {
        id: raw.id,
        label: typeof raw.label === "string" ? raw.label.slice(0, 60) : raw.id,
        ...(raw.hidden === true && { hidden: true })
    };

    switch (raw.type) {
        case "color":
            return { ...base, type: "color", default: COLOR.test(raw.default) ? raw.default.toLowerCase() : "#ffffff" };

        case "number": {
            const min = finite(raw.min) ? raw.min : 0;
            const max = finite(raw.max) && raw.max > min ? raw.max : min + 100;
            const step = finite(raw.step) && raw.step > 0 ? raw.step : (max - min) / 100;
            const unit = typeof raw.unit === "string" && UNIT.test(raw.unit) ? raw.unit : "";
            return { ...base, type: "number", min, max, step, unit, default: clamp(finite(raw.default) ? raw.default : min, min, max) };
        }

        case "boolean":
            return { ...base, type: "boolean", default: raw.default === true };

        case "select": {
            const options = (Array.isArray(raw.options) ? raw.options : [])
                .map((o: any) => typeof o === "string" ? { label: o, value: o } : { label: String(o?.label ?? o?.value), value: String(o?.value) })
                .filter((o: { value: string; }) => OPTION_VALUE.test(o.value))
                .slice(0, 20);
            if (!options.length) return null;
            return { ...base, type: "select", options, default: options.find((o: { value: string; }) => o.value === raw.default)?.value ?? options[0].value };
        }

        default:
            return null;
    }
}

export function readManifest(indexFile: string): Manifest {
    let raw: any = {};
    try {
        raw = JSON.parse(readFileSync(join(dirname(indexFile), "overlay.json"), "utf-8"));
    } catch { /* no (valid) manifest: the overlay asks for nothing */ }

    const keyNames = (list: unknown) => [...new Set<string>((Array.isArray(list) ? list : []).map(k => String(k).toUpperCase()))]
        .filter(k => VIRTUAL_KEYS.has(k));

    const interactive = keyNames(raw?.interactive).slice(0, 4);
    // the interactive combo has to be polled too
    const keys = keyNames([...(Array.isArray(raw?.keys) ? raw.keys : []), ...interactive]);

    const seen = new Set<string>();
    const settings: OverlaySetting[] = [];
    for (const r of Array.isArray(raw?.settings) ? raw.settings : []) {
        const setting = parseSetting(r);
        if (!setting || seen.has(setting.id)) continue;
        seen.add(setting.id);
        settings.push(setting);
    }

    return { keys, interactive, settings: settings.slice(0, MAX_SETTINGS) };
}

// Union of the keys requested by the given overlays, in first-seen order.
export function unionKeys(manifests: Manifest[]) {
    return [...new Set(manifests.flatMap(m => m.keys))].slice(0, MAX_KEYS);
}

// A stored value is only used if it is still valid for the setting, otherwise the default applies.
export function resolveValue(setting: OverlaySetting, stored: unknown): OverlayValue {
    switch (setting.type) {
        case "color":
            return typeof stored === "string" && COLOR.test(stored) ? stored.toLowerCase() : setting.default;
        case "number":
            return finite(stored) ? clamp(stored, setting.min!, setting.max!) : setting.default;
        case "boolean":
            return typeof stored === "boolean" ? stored : setting.default;
        case "select":
            return setting.options!.some(o => o.value === stored) ? stored as string : setting.default;
    }
}

// Script run inside an overlay's frame. Every setting becomes:
//   a CSS variable on <html>  (--id; colors also get --id-rgb as "r g b" for rgb(var(--id-rgb) / 50%))
//   a data attribute on <html> (data-id="value", for selectors like html[data-id="value"])
// and the whole set is also sent to scripts as a "streamoverlay:settings" window event (detail = { id: value }).
export function settingsScript(settings: OverlaySetting[], stored: Record<string, unknown> = {}) {
    const vars: Record<string, string> = {};
    const attrs: Record<string, string> = {};
    const detail: Record<string, OverlayValue> = {};

    for (const s of settings) {
        const value = resolveValue(s, stored[s.id]);
        detail[s.id] = value;
        attrs[`data-${s.id}`] = String(value);

        if (s.type === "color") {
            const hex = value as string;
            vars[`--${s.id}`] = hex;
            vars[`--${s.id}-rgb`] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(" ");
        } else if (s.type === "number") {
            vars[`--${s.id}`] = `${value}${s.unit ?? ""}`;
        } else {
            vars[`--${s.id}`] = s.type === "boolean" ? (value ? "1" : "0") : String(value);
        }
    }

    return `(() => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(${JSON.stringify(vars)})) root.style.setProperty(k, v);
    for (const [k, v] of Object.entries(${JSON.stringify(attrs)})) root.setAttribute(k, v);
    window.dispatchEvent(new CustomEvent("streamoverlay:settings", { detail: ${JSON.stringify(detail)} }));
})()`;
}
