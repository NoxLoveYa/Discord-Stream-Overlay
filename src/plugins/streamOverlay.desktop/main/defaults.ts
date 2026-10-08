/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import keyboardHtml from "file://../defaultOverlays/keyboard/index.html";
import keyboardKeysCss from "file://../defaultOverlays/keyboard/keys.css";
import keyboardMoveCss from "file://../defaultOverlays/keyboard/move.css";
import keyboardManifest from "file://../defaultOverlays/keyboard/overlay.json";
import keyboardScript from "file://../defaultOverlays/keyboard/script.js";
import keyboardCss from "file://../defaultOverlays/keyboard/style.css";
import redBorderHtml from "file://../defaultOverlays/red-border/index.html";
import redBorderManifest from "file://../defaultOverlays/red-border/overlay.json";
import redBorderCss from "file://../defaultOverlays/red-border/style.css";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

/** Overlays shipped with the plugin: folder name -> files. To add one, import its files above and list it here. */
const defaultOverlays: Record<string, Record<string, string>> = {
    "red-border": {
        "index.html": redBorderHtml,
        "style.css": redBorderCss,
        "overlay.json": redBorderManifest
    },
    "keyboard": {
        "index.html": keyboardHtml,
        "script.js": keyboardScript,
        "style.css": keyboardCss,
        "keys.css": keyboardKeysCss,
        "move.css": keyboardMoveCss,
        "overlay.json": keyboardManifest
    }
};

/**
 * Copies every default overlay into `dir` once. A marker file remembers which ones were handled, so defaults added by
 * a later version show up while deleted or edited ones are left alone.
 */
export function seedDefaults(dir: string) {
    const marker = join(dir, ".seeded");
    mkdirSync(dir, { recursive: true });

    const seeded = existsSync(marker) ? readFileSync(marker, "utf-8").split("\n") : [];
    const pending = Object.keys(defaultOverlays).filter(name => !seeded.includes(name));
    if (!pending.length) return;

    for (const name of pending) {
        const target = join(dir, name);
        if (existsSync(target)) continue;

        mkdirSync(target);
        for (const [file, content] of Object.entries(defaultOverlays[name]))
            writeFileSync(join(target, file), content);
    }
    writeFileSync(marker, [...seeded, ...pending].filter(Boolean).join("\n"));
}
