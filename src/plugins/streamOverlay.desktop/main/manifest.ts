/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Manifest, OverlaySetting } from "@plugins/streamOverlay.desktop/types";
import { readFileSync } from "fs";
import { dirname, join } from "path";

import { VIRTUAL_KEYS } from "./keys";
import { clamp, COLOR, finite, FONT_FAMILY } from "./values";

const MAX_KEYS = 32;
const MAX_SETTINGS = 24;
const ID = /^[a-z][a-z0-9-]{0,31}$/;
const OPTION_VALUE = /^[\w .-]{1,40}$/;
const UNIT = /^(px|%|em|rem|vw|vh|deg|s|ms)?$/;

const text = (value: unknown, max: number) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

// overlay.json belongs to a folder the user picked: nothing in it is trusted
function parseSetting(raw: any): OverlaySetting | null {
    if (!raw || typeof raw.id !== "string" || !ID.test(raw.id)) return null;

    const group = text(raw.group, 24);
    // { "theme": "gothic" }: one setting and the value it has to have
    const [[when, wanted] = []] = Object.entries(raw.when && typeof raw.when === "object" ? raw.when : {});

    const base = {
        id: raw.id,
        label: typeof raw.label === "string" ? raw.label.slice(0, 60) : raw.id,
        ...(raw.hidden === true && { hidden: true }),
        ...(group && { group }),
        ...(typeof when === "string" && ID.test(when) && (typeof wanted === "string" || typeof wanted === "boolean") && { when: { id: when, value: wanted } })
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

        case "font": {
            // the family's own names: customs a user added are merged in by the settings page, not the manifest
            const options = (Array.isArray(raw.options) ? raw.options : [])
                .map((o: any) => typeof o === "string" ? { label: o, value: o } : { label: String(o?.label ?? o?.value).slice(0, 40), value: String(o?.value) })
                .filter((o: { value: string; }) => FONT_FAMILY.test(o.value))
                .slice(0, 20);
            if (!options.length) return null;
            return { ...base, type: "font", options, default: options.find((o: { value: string; }) => o.value === raw.default)?.value ?? options[0].value };
        }

        default:
            return null;
    }
}

const keyNames = (list: unknown) =>
    [...new Set<string>((Array.isArray(list) ? list : []).map(k => String(k).toUpperCase()))].filter(k => VIRTUAL_KEYS.has(k));

export function readManifest(indexFile: string): Manifest {
    let raw: any = {};
    try {
        raw = JSON.parse(readFileSync(join(dirname(indexFile), "overlay.json"), "utf-8"));
    } catch { /* no manifest, or an invalid one: the overlay asks for nothing */ }

    const interactive = keyNames(raw?.interactive).slice(0, 4);
    const keys = keyNames([...(Array.isArray(raw?.keys) ? raw.keys : []), ...interactive]);

    const seen = new Set<string>();
    const settings: OverlaySetting[] = [];
    for (const entry of Array.isArray(raw?.settings) ? raw.settings : []) {
        const setting = parseSetting(entry);
        if (!setting || seen.has(setting.id)) continue;
        seen.add(setting.id);
        settings.push(setting);
    }

    return {
        title: text(raw?.title, 40),
        description: text(raw?.description, 160),
        category: text(raw?.category, 24),
        keys,
        mouse: raw?.mouse === true,
        media: raw?.media === true,
        lol: raw?.lol === true,
        interactive,
        // it has to have a move combo to be armed; overlays written before the tag existed count as draggable too
        draggable: interactive.length > 0 && raw?.draggable !== false,
        settings: settings.slice(0, MAX_SETTINGS)
    };
}

export function unionKeys(manifests: Manifest[]) {
    return [...new Set(manifests.flatMap(m => m.keys))].slice(0, MAX_KEYS);
}
