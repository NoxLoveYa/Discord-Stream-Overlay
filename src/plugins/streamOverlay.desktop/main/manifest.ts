/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Manifest, OverlaySetting } from "@plugins/streamOverlay.desktop/types";
import { readFileSync } from "fs";
import { dirname, join } from "path";

import { CHANNELS } from "./channels";
import { VIRTUAL_KEYS } from "./keys";
import { clamp, COLOR, finite, FONT_FAMILY, record, text } from "./values";

const MAX_KEYS = 32;
const MAX_INTERACTIVE = 4;
const MAX_SETTINGS = 24;
const MAX_OPTIONS = 20;
const MAX_FONT_LABEL = 40;
const ID = /^[a-z][a-z0-9-]{0,31}$/;
const OPTION_VALUE = /^[\w .-]{1,40}$/;
const UNIT = /^(px|%|em|rem|vw|vh|deg|s|ms)?$/;

function parseOptions(raw: Record<string, unknown>, valid: RegExp, labelMax = Infinity) {
    const options = (Array.isArray(raw.options) ? raw.options : [])
        .map((o: unknown) => {
            if (typeof o === "string") return { label: o, value: o };
            const { label, value, font } = record(o);
            return {
                label: String(label ?? value).slice(0, labelMax),
                value: String(value),
                // a family that the font setting follows while this option is chosen
                ...(typeof font === "string" && FONT_FAMILY.test(font) && { font })
            };
        })
        .filter(o => valid.test(o.value))
        .slice(0, MAX_OPTIONS);
    if (!options.length) return null;
    return { options, default: options.find(o => o.value === raw.default)?.value ?? options[0].value };
}

// { "theme": "gothic" }: one setting and the value it has to have
function parseCondition(raw: unknown) {
    const [[id, value] = []] = Object.entries(record(raw));
    return typeof id === "string" && ID.test(id) && (typeof value === "string" || typeof value === "boolean") ? { id, value } : undefined;
}

// overlay.json belongs to a folder the user picked: nothing in it is trusted
function parseSetting(input: unknown): OverlaySetting | null {
    const raw = record(input);
    if (typeof raw.id !== "string" || !ID.test(raw.id)) return null;

    const group = text(raw.group, 24);
    const when = parseCondition(raw.when);
    const unless = parseCondition(raw.unless);

    const base = {
        id: raw.id,
        label: typeof raw.label === "string" ? raw.label.slice(0, 60) : raw.id,
        ...(raw.hidden === true && { hidden: true }),
        ...(group && { group }),
        ...(when && { when }),
        ...(unless && { unless })
    };

    switch (raw.type) {
        case "color":
            return { ...base, type: "color", default: typeof raw.default === "string" && COLOR.test(raw.default) ? raw.default.toLowerCase() : "#ffffff" };

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
            const choices = parseOptions(raw, OPTION_VALUE);
            return choices && { ...base, type: "select", ...choices };
        }

        // the family's own names: customs a user added are merged in by the settings page, not the manifest
        case "font": {
            const choices = parseOptions(raw, FONT_FAMILY, MAX_FONT_LABEL);
            return choices && { ...base, type: "font", ...choices };
        }

        default:
            return null;
    }
}

const keyNames = (list: unknown) =>
    [...new Set<string>((Array.isArray(list) ? list : []).map(k => String(k).toUpperCase()))].filter(k => VIRTUAL_KEYS.has(k));

export function readManifest(indexFile: string): Manifest {
    let raw: Record<string, unknown> = {};
    try {
        raw = record(JSON.parse(readFileSync(join(dirname(indexFile), "overlay.json"), "utf-8")));
    } catch { /* no manifest, or an invalid one: the overlay asks for nothing */ }

    const interactive = keyNames(raw.interactive).slice(0, MAX_INTERACTIVE);
    const keys = keyNames([...(Array.isArray(raw.keys) ? raw.keys : []), ...interactive]);

    const seen = new Set<string>();
    const settings: OverlaySetting[] = [];
    for (const entry of Array.isArray(raw.settings) ? raw.settings : []) {
        const setting = parseSetting(entry);
        if (!setting || seen.has(setting.id)) continue;
        seen.add(setting.id);
        settings.push(setting);
    }

    return {
        title: text(raw.title, 40),
        description: text(raw.description, 160),
        category: text(raw.category, 24),
        keys,
        mouse: raw.mouse === true,
        channels: CHANNELS.filter(channel => raw[channel.name] === true).map(channel => channel.name),
        interactive,
        // it has to have a move combo to be armed; overlays written before the tag existed count as draggable too
        draggable: interactive.length > 0 && raw.draggable !== false,
        settings: settings.slice(0, MAX_SETTINGS)
    };
}

export function unionKeys(manifests: Manifest[]) {
    return [...new Set(manifests.flatMap(m => m.keys))].slice(0, MAX_KEYS);
}
