/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { FontEntry } from "@plugins/streamOverlay.desktop/types";
import { app, BrowserWindow, dialog, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { basename, extname, join } from "path";
import { pathToFileURL } from "url";

import { FONT_FAMILY, MAX_FONT_FILE_MB } from "./values";

const MAX_NAME = 40;
const BYTES_PER_MB = 1024 * 1024;
const EXTENSIONS = ["woff2", "woff", "ttf", "otf"] as const;
const FORMATS: Record<string, string> = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };
// the first bytes a font file has to start with: wOFF / wOF2 / 00 01 00 00 / OTTO / "true"
const MAGIC = ["774f4646", "774f4632", "00010000", "4f54544f", "74727565"];
// what importFont writes: the registry is a file on disk, so a name read back from it is never trusted as a path
const STORED_FILE = /^[\w.\- ]+\.(woff2|woff|ttf|otf)$/i;

const fontsDir = () => join(app.getPath("userData"), "StreamOverlay", "fonts");
const registryFile = () => join(fontsDir(), "fonts.json");
const extensionOf = (file: string) => extname(file).slice(1).toLowerCase();

type Stored = { family: string; file: string | null; };

function readRegistry(): Record<string, Stored> {
    try {
        const parsed: unknown = JSON.parse(readFileSync(registryFile(), "utf-8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const registry: Record<string, Stored> = {};
        for (const [name, v] of Object.entries(parsed as Record<string, unknown>)) {
            const stored = v as Partial<Stored>;
            if (v && typeof v === "object" && typeof stored.family === "string" && FONT_FAMILY.test(stored.family))
                registry[name] = { family: stored.family, file: typeof stored.file === "string" && STORED_FILE.test(stored.file) ? stored.file : null };
        }
        return registry;
    } catch {
        return {}; // no registry yet, or an unreadable one
    }
}

function writeRegistry(registry: Record<string, Stored>) {
    mkdirSync(fontsDir(), { recursive: true });
    writeFileSync(registryFile(), JSON.stringify(registry, null, 4));
}

function freeName(registry: Record<string, Stored>, raw: string) {
    const base = raw.replace(/\s+/g, " ").trim().replace(/[<>:"/|?*\u0000-\u001f]/g, "").slice(0, MAX_NAME) || "Font";
    if (!registry[base]) return base;
    for (let n = 2; ; n++) {
        const candidate = `${base.slice(0, MAX_NAME - String(n).length - 1)} ${n}`;
        if (!registry[candidate]) return candidate;
    }
}

const head = (file: string) => readFileSync(file).subarray(0, 4).toString("hex");

export function listFonts(): FontEntry[] {
    return Object.entries(readRegistry())
        .map(([name, { family, file }]) => ({ name, family, file }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

// null when cancelled or invalid
export async function importFont(event: IpcMainInvokeEvent): Promise<FontEntry | null> {
    const options: OpenDialogOptions = {
        title: "Select a font file",
        properties: ["openFile"],
        filters: [{ name: "Fonts", extensions: [...EXTENSIONS] }]
    };
    const parent = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await (parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options));
    const picked = !canceled ? filePaths[0] : null;
    if (!picked) return null;

    const ext = extensionOf(picked);
    try {
        if (!EXTENSIONS.includes(ext as (typeof EXTENSIONS)[number])) return null;
        if (statSync(picked).size > MAX_FONT_FILE_MB * BYTES_PER_MB) return null;
        if (!MAGIC.includes(head(picked))) return null;
    } catch {
        return null;
    }

    const family = basename(picked, extname(picked)).replace(/[\s_]+/g, " ").trim().slice(0, MAX_NAME);
    if (!FONT_FAMILY.test(family)) return null;

    mkdirSync(fontsDir(), { recursive: true });
    const registry = readRegistry();
    const name = freeName(registry, family);
    // the file on disk follows the unique name, so two imports never overwrite each other
    const target = `${name.replace(/[^\w.\- ]/g, "")}.${ext}`;
    try {
        copyFileSync(picked, join(fontsDir(), target));
    } catch {
        return null;
    }

    registry[name] = { family, file: target };
    writeRegistry(registry);
    return { name, family, file: target };
}

// a system font by name, with no file: registered so the picker offers it everywhere
export async function addFontFamily(name: string): Promise<FontEntry | null> {
    const family = name.replace(/\s+/g, " ").trim();
    if (!FONT_FAMILY.test(family)) return null;

    const registry = readRegistry();
    const entry = freeName(registry, family);
    registry[entry] = { family, file: null };
    writeRegistry(registry);
    return { name: entry, family, file: null };
}

// built-ins are not in the registry, so they cannot be removed
export function removeFont(name: string) {
    const registry = readRegistry();
    const stored = registry[name];
    if (!stored) return false;

    delete registry[name];
    writeRegistry(registry);
    if (stored.file) rmSync(join(fontsDir(), stored.file), { force: true });
    return true;
}

// null when the family has no imported file (a system or unknown font)
export function fontFaceCssFor(family: string) {
    const files = Object.values(readRegistry())
        .flatMap(s => s.file && s.family.toLowerCase() === family.toLowerCase() ? [s.file] : [])
        .filter(file => existsSync(join(fontsDir(), file)));
    if (!files.length) return null;

    return files.map(file => {
        const url = JSON.stringify(pathToFileURL(join(fontsDir(), file)).href);
        const format = JSON.stringify(FORMATS[extensionOf(file)] ?? "woff2");
        return `@font-face{font-family:"${family}";font-style:normal;font-weight:400 900;font-display:swap;src:url(${url}) format(${format});}`;
    }).join("\n");
}

// empty when the family needs no style: the --font variable already falls back to a readable stack
export function fontStyleScript(css: string | null) {
    if (!css) return "";
    return `(() => { let el = document.querySelector('style[data-so-fonts]'); if (!el) { el = document.createElement('style'); el.setAttribute('data-so-fonts', ''); document.head.appendChild(el); } el.textContent = ${JSON.stringify(css)}; })()`;
}
