/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Writes the overlays bundled with the StreamOverlay plugin (src/plugins/streamOverlay.desktop/defaultOverlays) into the data
// folder of every Discord that has been run, with the code the plugin runs when it first lists its overlays (an unedited copy is
// updated, one you edited, added to or deleted from is left alone). They are then there before Discord starts. Windows only.
// `pnpm inject` runs it after patching; run it by hand with `node scripts/build/overlays.mjs`.

import { createHash } from "crypto";
import { build } from "esbuild";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULTS = join(ROOT, "src", "plugins", "streamOverlay.desktop", "main", "defaults.ts");
const DISCORDS = ["discord", "discordptb", "discordcanary"];

const log = message => console.log(`[StreamOverlay] ${message}`);

const walk = (dir, base = "") => readdirSync(join(dir, base), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(dir, `${base}${entry.name}/`) : [`${base}${entry.name}`]);

// file -> hash, without the markers and backups the plugin keeps next to the overlays (their names start with a dot)
const snapshot = dir => new Map(existsSync(dir)
    ? walk(dir).filter(file => !file.startsWith(".")).map(file => [file, createHash("sha1").update(readFileSync(join(dir, file))).digest("hex")])
    : []);

if (process.platform === "win32") {
    const tmp = mkdtempSync(join(tmpdir(), "streamoverlay-"));
    try {
        // common.mjs reads package.json from the working directory
        process.chdir(ROOT);
        const { fileUrlPlugin } = await import("./common.mjs");

        // the plugin's own code, bundled: the overlays are imported there as text, so it cannot run as it is
        const { outputFiles } = await build({
            entryPoints: [DEFAULTS], bundle: true, platform: "node", format: "cjs", write: false, plugins: [fileUrlPlugin], logLevel: "silent"
        });
        const bundle = join(tmp, "defaults.cjs");
        writeFileSync(bundle, outputFiles[0].text);
        const { seedDefaults } = createRequire(import.meta.url)(bundle);

        // what a fresh folder gets, to tell the overlays that are left alone from the ones that are current
        const fresh = join(tmp, "fresh");
        seedDefaults(fresh);
        const shipped = snapshot(fresh);
        const shippedNames = new Set([...shipped.keys()].map(file => file.split("/")[0]));
        const differing = (a, b) => new Set([...a.keys(), ...b.keys()].filter(file => a.get(file) !== b.get(file)).map(file => file.split("/")[0]));

        const found = DISCORDS.filter(name => existsSync(join(process.env.APPDATA, name)));
        if (!found.length) log("no Discord has been run yet: the plugin writes its overlays the first time it lists them");

        for (const name of found) {
            const dir = join(process.env.APPDATA, name, "StreamOverlay", "overlays");
            const before = snapshot(dir);
            seedDefaults(dir);
            const after = snapshot(dir);

            const changed = differing(before, after);
            const edited = [...differing(shipped, after)].filter(overlay => shippedNames.has(overlay));
            const parts = [];
            if (changed.size) parts.push(`updated ${[...changed].join(", ")}`);
            if (edited.length) parts.push(`left alone because they differ from the bundled ones (edited?): ${edited.join(", ")}`);
            log(`${name}: ${parts.join("; ") || "the overlays are up to date"}`);
        }
    } catch (e) {
        console.warn(`[StreamOverlay] could not write the overlays, the plugin writes them the first time it lists them: ${e.message}`);
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}
