/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createHash } from "crypto";
import keyboardGothic from "file://../defaultOverlays/keyboard/gothic.css";
import keyboardHtml from "file://../defaultOverlays/keyboard/index.html";
import keyboardManifest from "file://../defaultOverlays/keyboard/overlay.json";
import summonerBarrier from "file://../defaultOverlays/keyboard/spells/summoner-barrier.png?base64";
import summonerExhaust from "file://../defaultOverlays/keyboard/spells/summoner-exhaust.png?base64";
import summonerFlash from "file://../defaultOverlays/keyboard/spells/summoner-flash.png?base64";
import summonerGhost from "file://../defaultOverlays/keyboard/spells/summoner-ghost.png?base64";
import summonerHeal from "file://../defaultOverlays/keyboard/spells/summoner-heal.png?base64";
import summonerIgnite from "file://../defaultOverlays/keyboard/spells/summoner-ignite.png?base64";
import summonerSmite from "file://../defaultOverlays/keyboard/spells/summoner-smite.png?base64";
import summonerTeleport from "file://../defaultOverlays/keyboard/spells/summoner-teleport.png?base64";
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
import themeMolten from "file://../defaultOverlays/shared/theme-molten.css";
import themeNeon from "file://../defaultOverlays/shared/theme-neon.css";
import themeOcean from "file://../defaultOverlays/shared/theme-ocean.css";
import themePorcelain from "file://../defaultOverlays/shared/theme-porcelain.css";
import themeRoyal from "file://../defaultOverlays/shared/theme-royal.css";
import themeSakura from "file://../defaultOverlays/shared/theme-sakura.css";
import themeTerminal from "file://../defaultOverlays/shared/theme-terminal.css";
import spotifyBanner from "file://../defaultOverlays/spotify/banner.css";
import spotifyGothic from "file://../defaultOverlays/spotify/gothic.css";
import spotifyHtml from "file://../defaultOverlays/spotify/index.html";
import spotifyManifest from "file://../defaultOverlays/spotify/overlay.json";
import spotifyScript from "file://../defaultOverlays/spotify/script.js";
import spotifyCss from "file://../defaultOverlays/spotify/style.css";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";

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

const themes = {
    "theme-neon.css": themeNeon,
    "theme-porcelain.css": themePorcelain,
    "theme-terminal.css": themeTerminal,
    "theme-sakura.css": themeSakura,
    "theme-molten.css": themeMolten,
    "theme-royal.css": themeRoyal,
    "theme-ocean.css": themeOcean
};

const defaultOverlays: Record<string, Record<string, string>> = {
    "red-border": {
        "index.html": redBorderHtml,
        "style.css": redBorderCss,
        "overlay.json": redBorderManifest
    },
    "keyboard": {
        ...board,
        ...gothic,
        ...themes,
        "gothic-keys.css": gothicKeys,
        "gothic.css": keyboardGothic,
        "index.html": keyboardHtml,
        "style.css": keyboardCss,
        "overlay.json": keyboardManifest,
        "spells/summoner-barrier.png": summonerBarrier,
        "spells/summoner-exhaust.png": summonerExhaust,
        "spells/summoner-flash.png": summonerFlash,
        "spells/summoner-ghost.png": summonerGhost,
        "spells/summoner-heal.png": summonerHeal,
        "spells/summoner-ignite.png": summonerIgnite,
        "spells/summoner-smite.png": summonerSmite,
        "spells/summoner-teleport.png": summonerTeleport
    },
    "mouse": {
        ...board,
        ...gothic,
        ...themes,
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
        ...themes,
        "banner.css": spotifyBanner,
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

const CUSTOM = "custom";

const hashOf = (files: string[], read: (file: string) => string | null) => {
    const hash = createHash("sha1");
    for (const file of [...files].sort()) hash.update(`${file}\0${read(file) ?? "\0missing"}\0`);
    return hash.digest("hex");
};

const shippedHash = (name: string) => hashOf(Object.keys(defaultOverlays[name]), file => defaultOverlays[name][file]);

// the pngs are shipped as base64 instead of text and read back the same way, so hashes match: by the extension, since a copy from
// an older version can have pngs that this version no longer ships
const isBinary = (file: string) => file.endsWith(".png");

const readInstalled = (target: string, file: string) => {
    try {
        const full = join(target, file);
        return isBinary(file) ? readFileSync(full).toString("base64") : readFileSync(full, "utf-8");
    } catch {
        return null; // the user deleted it
    }
};

const installedHash = (target: string, files: string[]) => hashOf(files, file => readInstalled(target, file));

// the files of a folder, the ones in subfolders too ("spells/flash.png"), like the names of the shipped files
const filesIn = (target: string, base = ""): string[] =>
    readdirSync(join(target, base), { withFileTypes: true }).flatMap(entry =>
        entry.isDirectory() ? filesIn(target, `${base}${entry.name}/`) : entry.isFile() ? [`${base}${entry.name}`] : []);

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
    for (const [file, content] of Object.entries(defaultOverlays[name])) {
        const dest = join(target, file);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, isBinary(file) ? Buffer.from(content, "base64") : content);
    }

    if (prune) {
        for (const file of filesIn(target))
            if (!Object.hasOwn(defaultOverlays[name], file)) rmSync(join(target, file), { force: true });
    }
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
