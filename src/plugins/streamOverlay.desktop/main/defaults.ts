/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createHash } from "crypto";
import keyboardGothic from "file://../defaultOverlays/keyboard/gothic.css";
import keyboardHtml from "file://../defaultOverlays/keyboard/index.html";
import keyboardManifest from "file://../defaultOverlays/keyboard/overlay.json";
import keyboardCss from "file://../defaultOverlays/keyboard/style.css";
import mouseGothic from "file://../defaultOverlays/mouse/gothic.css";
import mouseHtml from "file://../defaultOverlays/mouse/index.html";
import mouseManifest from "file://../defaultOverlays/mouse/overlay.json";
import mouseScript from "file://../defaultOverlays/mouse/script.js";
import mouseCss from "file://../defaultOverlays/mouse/style.css";
import obnoxiousFont from "file://../defaultOverlays/obnoxious-frame/font.css";
import obnoxiousFontLicense from "file://../defaultOverlays/obnoxious-frame/FONT-LICENSE.txt";
import obnoxiousFrameHtml from "file://../defaultOverlays/obnoxious-frame/index.html";
import obnoxiousFrameManifest from "file://../defaultOverlays/obnoxious-frame/overlay.json";
import obnoxiousFrameScript from "file://../defaultOverlays/obnoxious-frame/script.js";
import obnoxiousFrameCss from "file://../defaultOverlays/obnoxious-frame/style.css";
import redBorderHtml from "file://../defaultOverlays/red-border/index.html";
import redBorderManifest from "file://../defaultOverlays/red-border/overlay.json";
import redBorderCss from "file://../defaultOverlays/red-border/style.css";
import boardCss from "file://../defaultOverlays/shared/board.css";
import gothicKeys from "file://../defaultOverlays/shared/gothic-keys.css";
import gothicPanel from "file://../defaultOverlays/shared/gothic-panel.css";
import keysCss from "file://../defaultOverlays/shared/keys.css";
import keysScript from "file://../defaultOverlays/shared/keys.js";
import moveCss from "file://../defaultOverlays/shared/move.css";
import moveScript from "file://../defaultOverlays/shared/move.js";
import spotifyGothic from "file://../defaultOverlays/spotify/gothic.css";
import spotifyHtml from "file://../defaultOverlays/spotify/index.html";
import spotifyManifest from "file://../defaultOverlays/spotify/overlay.json";
import spotifyScript from "file://../defaultOverlays/spotify/script.js";
import spotifyCss from "file://../defaultOverlays/spotify/style.css";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

// each overlay folder has to be complete on its own, so shared files are copied into every overlay that uses them
const board = {
    "board.css": boardCss,
    "keys.css": keysCss,
    "keys.js": keysScript,
    "move.css": moveCss,
    "move.js": moveScript
};

const gothic = {
    "font.css": obnoxiousFont,
    "FONT-LICENSE.txt": obnoxiousFontLicense,
    "gothic-panel.css": gothicPanel
};

// folder name -> files
const defaultOverlays: Record<string, Record<string, string>> = {
    "red-border": {
        "index.html": redBorderHtml,
        "style.css": redBorderCss,
        "overlay.json": redBorderManifest
    },
    "keyboard": {
        ...board,
        ...gothic,
        "gothic-keys.css": gothicKeys,
        "gothic.css": keyboardGothic,
        "index.html": keyboardHtml,
        "style.css": keyboardCss,
        "overlay.json": keyboardManifest
    },
    "mouse": {
        ...board,
        ...gothic,
        "gothic-keys.css": gothicKeys,
        "gothic.css": mouseGothic,
        "index.html": mouseHtml,
        "script.js": mouseScript,
        "style.css": mouseCss,
        "overlay.json": mouseManifest
    },
    "spotify": {
        "board.css": boardCss,
        "move.css": moveCss,
        "move.js": moveScript,
        ...gothic,
        "gothic.css": spotifyGothic,
        "index.html": spotifyHtml,
        "script.js": spotifyScript,
        "style.css": spotifyCss,
        "overlay.json": spotifyManifest
    },
    "obnoxious-frame": {
        "font.css": obnoxiousFont,
        "FONT-LICENSE.txt": obnoxiousFontLicense,
        "index.html": obnoxiousFrameHtml,
        "script.js": obnoxiousFrameScript,
        "style.css": obnoxiousFrameCss,
        "overlay.json": obnoxiousFrameManifest
    }
};

// marker value of an overlay that is not one of ours
const CUSTOM = "custom";

const hashOf = (files: string[], read: (file: string) => string | null) => {
    const hash = createHash("sha1");
    for (const file of [...files].sort()) hash.update(`${file}\0${read(file) ?? "\0missing"}\0`);
    return hash.digest("hex");
};

const shippedHash = (name: string) => hashOf(Object.keys(defaultOverlays[name]), file => defaultOverlays[name][file]);

const installedHash = (target: string, files: string[]) => hashOf(files, file => {
    try {
        return readFileSync(join(target, file), "utf-8");
    } catch {
        return null; // the user deleted it
    }
});

const filesIn = (target: string) => readdirSync(target, { withFileTypes: true }).filter(d => d.isFile()).map(d => d.name);

// overlay name -> the hash of the files written last, or "" when that is not known
function readMarker(marker: string): Record<string, string> {
    if (!existsSync(marker)) return {};

    const raw = readFileSync(marker, "utf-8");
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch { /* the first versions listed the names, one per line */ }
    return Object.fromEntries(raw.split("\n").filter(Boolean).map(name => [name, ""]));
}

// `prune` removes files of an older version that this one no longer has (only for a copy known to be ours)
function install(target: string, name: string, prune = false) {
    mkdirSync(target, { recursive: true });
    for (const [file, content] of Object.entries(defaultOverlays[name]))
        writeFileSync(join(target, file), content);

    if (prune)
        for (const file of filesIn(target))
            if (!(file in defaultOverlays[name])) rmSync(join(target, file), { force: true });
}

const checked = new Set<string>();

// Once per session. A marker file remembers what was written last, so a new default shows up and a deleted one stays
// deleted, an unedited copy follows newer versions, an edited one is left alone, and an unknown one (written before the
// marker existed) is updated after a copy is kept in `.<name>.backup`.
export function seedDefaults(dir: string) {
    if (checked.has(dir)) return;
    checked.add(dir);

    mkdirSync(dir, { recursive: true });
    const marker = join(dir, ".seeded");
    const seeded = readMarker(marker);

    for (const name of Object.keys(defaultOverlays)) {
        const target = join(dir, name);
        const shipped = shippedHash(name);
        const known = seeded[name];

        if (known === undefined) {
            if (existsSync(target)) {
                seeded[name] = CUSTOM;
            } else {
                install(target, name);
                seeded[name] = shipped;
            }
        } else if (known !== shipped && known !== CUSTOM && existsSync(target)) {
            if (installedHash(target, Object.keys(defaultOverlays[name])) === shipped) {
                seeded[name] = shipped;
            } else if (known === "" || installedHash(target, filesIn(target)) === known) {
                // a new version can add files, so compare against what is there, not against the shipped file list
                if (known === "") {
                    const backup = join(dir, `.${name}.backup`);
                    rmSync(backup, { recursive: true, force: true });
                    cpSync(target, backup, { recursive: true });
                }
                install(target, name, true);
                seeded[name] = shipped;
            }
        }
    }
    writeFileSync(marker, JSON.stringify(seeded, null, 4));
}
