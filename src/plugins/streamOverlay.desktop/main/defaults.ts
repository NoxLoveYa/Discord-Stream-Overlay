/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createHash } from "crypto";
import keyboardHtml from "file://../defaultOverlays/keyboard/index.html";
import keyboardManifest from "file://../defaultOverlays/keyboard/overlay.json";
import keyboardCss from "file://../defaultOverlays/keyboard/style.css";
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
import obnoxiousKeyboardHtml from "file://../defaultOverlays/obnoxious-keyboard/index.html";
import obnoxiousKeyboardManifest from "file://../defaultOverlays/obnoxious-keyboard/overlay.json";
import obnoxiousKeyboardCss from "file://../defaultOverlays/obnoxious-keyboard/style.css";
import obnoxiousKeyboardTheme from "file://../defaultOverlays/obnoxious-keyboard/theme.css";
import obnoxiousMouseHtml from "file://../defaultOverlays/obnoxious-mouse/index.html";
import obnoxiousMouseTheme from "file://../defaultOverlays/obnoxious-mouse/mouse-theme.css";
import obnoxiousMouseManifest from "file://../defaultOverlays/obnoxious-mouse/overlay.json";
import obnoxiousMouseScript from "file://../defaultOverlays/obnoxious-mouse/script.js";
import obnoxiousMouseCss from "file://../defaultOverlays/obnoxious-mouse/style.css";
import obnoxiousMouseBoardTheme from "file://../defaultOverlays/obnoxious-mouse/theme.css";
import obnoxiousSpotifyHtml from "file://../defaultOverlays/obnoxious-spotify/index.html";
import obnoxiousSpotifyManifest from "file://../defaultOverlays/obnoxious-spotify/overlay.json";
import obnoxiousSpotifyCss from "file://../defaultOverlays/obnoxious-spotify/style.css";
import obnoxiousSpotifyTheme from "file://../defaultOverlays/obnoxious-spotify/theme.css";
import redBorderHtml from "file://../defaultOverlays/red-border/index.html";
import redBorderManifest from "file://../defaultOverlays/red-border/overlay.json";
import redBorderCss from "file://../defaultOverlays/red-border/style.css";
import boardCss from "file://../defaultOverlays/shared/board.css";
import keysCss from "file://../defaultOverlays/shared/keys.css";
import keysScript from "file://../defaultOverlays/shared/keys.js";
import moveCss from "file://../defaultOverlays/shared/move.css";
import moveScript from "file://../defaultOverlays/shared/move.js";
import spotifyHtml from "file://../defaultOverlays/spotify/index.html";
import spotifyManifest from "file://../defaultOverlays/spotify/overlay.json";
import spotifyScript from "file://../defaultOverlays/spotify/script.js";
import spotifyCss from "file://../defaultOverlays/spotify/style.css";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

/** Copied into every overlay that looks like the keyboard: each overlay folder has to be complete on its own. */
const board = {
    "board.css": boardCss,
    "keys.css": keysCss,
    "keys.js": keysScript,
    "move.css": moveCss,
    "move.js": moveScript
};

/** Overlays shipped with the plugin: folder name -> files. To add one, import its files above and list it here. */
const defaultOverlays: Record<string, Record<string, string>> = {
    "red-border": {
        "index.html": redBorderHtml,
        "style.css": redBorderCss,
        "overlay.json": redBorderManifest
    },
    "keyboard": {
        ...board,
        "index.html": keyboardHtml,
        "style.css": keyboardCss,
        "overlay.json": keyboardManifest
    },
    "mouse": {
        ...board,
        "index.html": mouseHtml,
        "script.js": mouseScript,
        "style.css": mouseCss,
        "overlay.json": mouseManifest
    },
    // the gothic set: a frame, and a keyboard and mouse to go with it
    "obnoxious-frame": {
        "font.css": obnoxiousFont,
        "FONT-LICENSE.txt": obnoxiousFontLicense,
        "index.html": obnoxiousFrameHtml,
        "script.js": obnoxiousFrameScript,
        "style.css": obnoxiousFrameCss,
        "overlay.json": obnoxiousFrameManifest
    },
    "obnoxious-keyboard": {
        ...board,
        "font.css": obnoxiousFont,
        "FONT-LICENSE.txt": obnoxiousFontLicense,
        "index.html": obnoxiousKeyboardHtml,
        "style.css": obnoxiousKeyboardCss,
        "theme.css": obnoxiousKeyboardTheme,
        "overlay.json": obnoxiousKeyboardManifest
    },
    "obnoxious-mouse": {
        ...board,
        "font.css": obnoxiousFont,
        "FONT-LICENSE.txt": obnoxiousFontLicense,
        "index.html": obnoxiousMouseHtml,
        "mouse-theme.css": obnoxiousMouseTheme,
        "script.js": obnoxiousMouseScript,
        "style.css": obnoxiousMouseCss,
        "theme.css": obnoxiousMouseBoardTheme,
        "overlay.json": obnoxiousMouseManifest
    },
    "obnoxious-spotify": {
        "board.css": boardCss,
        "move.css": moveCss,
        "move.js": moveScript,
        "font.css": obnoxiousFont,
        "FONT-LICENSE.txt": obnoxiousFontLicense,
        "index.html": obnoxiousSpotifyHtml,
        "script.js": spotifyScript,
        "style.css": obnoxiousSpotifyCss,
        "theme.css": obnoxiousSpotifyTheme,
        "overlay.json": obnoxiousSpotifyManifest
    },
    "spotify": {
        "board.css": boardCss,
        "move.css": moveCss,
        "move.js": moveScript,
        "index.html": spotifyHtml,
        "script.js": spotifyScript,
        "style.css": spotifyCss,
        "overlay.json": spotifyManifest
    }
};

// what the marker says about an overlay that is not one of ours
const CUSTOM = "custom";

const hashOf = (files: string[], read: (file: string) => string | null) => {
    const hash = createHash("sha1");
    for (const file of [...files].sort()) hash.update(`${file}\0${read(file) ?? "\0missing"}\0`);
    return hash.digest("hex");
};

const shippedHash = (name: string) => hashOf(Object.keys(defaultOverlays[name]), file => defaultOverlays[name][file]);

const installedHash = (target: string, name: string) => hashOf(Object.keys(defaultOverlays[name]), file => {
    try {
        return readFileSync(join(target, file), "utf-8");
    } catch {
        return null;
    }
});

/** Overlay name -> the hash of the files written last, or "" when that is not known. */
function readMarker(marker: string): Record<string, string> {
    if (!existsSync(marker)) return {};

    const raw = readFileSync(marker, "utf-8");
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch { /* the first versions listed the names, one per line */ }
    return Object.fromEntries(raw.split("\n").filter(Boolean).map(name => [name, ""]));
}

function install(target: string, name: string) {
    mkdirSync(target, { recursive: true });
    for (const [file, content] of Object.entries(defaultOverlays[name]))
        writeFileSync(join(target, file), content);
}

const checked = new Set<string>();

/**
 * Puts the default overlays in `dir`, once per session. A marker file remembers what was written last, so:
 * - a default that is new shows up, and one the user deleted stays deleted;
 * - a copy that was not edited is updated when the plugin ships a newer version;
 * - a copy that was edited is left alone, and an unknown one (written before the marker knew) is updated after a copy of
 *   it is kept in `.<name>.backup`.
 */
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
            const installed = installedHash(target, name);
            if (installed === shipped) {
                seeded[name] = shipped;
            } else if (installed === known || known === "") {
                if (known === "") {
                    const backup = join(dir, `.${name}.backup`);
                    rmSync(backup, { recursive: true, force: true });
                    cpSync(target, backup, { recursive: true });
                }
                install(target, name);
                seeded[name] = shipped;
            }
        }
    }
    writeFileSync(marker, JSON.stringify(seeded, null, 4));
}
