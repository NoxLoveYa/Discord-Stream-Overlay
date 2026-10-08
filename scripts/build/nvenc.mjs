/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Builds the native addon of the StreamOverlay plugin ("stream only", src/plugins/streamOverlay.desktop/nvenc) and
// installs it where the plugin looks for it. Windows only. Missing tools (the Visual Studio C++ build tools, CMake) are
// installed with winget first. It runs after `pnpm install` and before `pnpm build`, and never fails either of them: the
// plugin then keeps the overlay on screen. Set VENCORD_SKIP_NVENC=1 to skip it. Run it by hand with
// `node scripts/build/nvenc.mjs`.

import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), "../../src/plugins/streamOverlay.desktop/nvenc");
const BUILD = join(SOURCE, "build");
const ADDON = "streamoverlay_nvenc.node";
// next to the installed addon: says which sources it was built from
const STAMP = ".built";
const DISCORDS = ["discord", "discordptb", "discordcanary"];

const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
const vswhere = join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");

const log = message => console.log(`[StreamOverlay] ${message}`);
const query = (command, args) => spawnSync(command, args, { encoding: "utf-8" }).stdout?.trim() ?? "";

function run(command, args) {
    const { status, error } = spawnSync(command, args, { stdio: "inherit" });
    if (status !== 0) throw new Error(`${command} ${args.slice(0, 2).join(" ")} failed: ${error?.message ?? `exit code ${status}`}`);
}

const sourceHash = () => createHash("sha1")
    .update(readFileSync(join(SOURCE, "hook.cc")))
    .update(readFileSync(join(SOURCE, "yuvblend.h")))
    .update(readFileSync(join(SOURCE, "CMakeLists.txt")))
    .digest("hex");

/** The plugin looks in the data folder of the Discord it runs in: every branch that has been run gets a copy. */
function installDirs() {
    const found = DISCORDS.map(name => join(process.env.APPDATA, name)).filter(existsSync);
    return (found.length ? found : [join(process.env.APPDATA, "discord")]).map(dir => join(dir, "StreamOverlay", "nvenc"));
}

const upToDate = (dir, hash) =>
    existsSync(join(dir, ADDON)) && existsSync(join(dir, STAMP)) && readFileSync(join(dir, STAMP), "utf-8") === hash;

/** Install folders of the Visual Studios that have the C++ compiler. */
const visualStudios = () => existsSync(vswhere)
    ? query(vswhere, ["-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"])
        .split(/\r?\n/).filter(Boolean)
    : [];

function findCmake() {
    const candidates = [
        query("where", ["cmake"]).split(/\r?\n/)[0],
        join(programFiles, "CMake", "bin", "cmake.exe"),
        ...visualStudios().map(vs => join(vs, "Common7", "IDE", "CommonExtensions", "Microsoft", "CMake", "CMake", "bin", "cmake.exe"))
    ];
    return candidates.find(file => file && existsSync(file)) ?? null;
}

function winget(id, override) {
    const args = ["install", "--id", id, "-e", "--silent", "--accept-package-agreements", "--accept-source-agreements"];
    if (override) args.push("--override", override);
    run("winget", args);
}

function ensureTools() {
    if (!visualStudios().length) {
        log("the Visual Studio C++ build tools are missing: installing them with winget (several GB, Windows asks for permission)");
        winget(
            "Microsoft.VisualStudio.2022.BuildTools",
            "--wait --quiet --norestart --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.CMake.Project --includeRecommended"
        );
    }

    let cmake = findCmake();
    if (!cmake) {
        log("CMake is missing: installing it with winget");
        winget("Kitware.CMake");
        // a new install is not on this process's PATH, but it is in a known place
        cmake = findCmake();
    }
    if (!cmake) throw new Error("CMake was not found after installing it: open a new terminal and run the build again");
    return cmake;
}

function install(dir, hash) {
    mkdirSync(dir, { recursive: true });

    // a .node that Discord has loaded cannot be overwritten but can be renamed: it is replaced when Discord starts again
    const file = join(dir, ADDON);
    if (existsSync(file)) renameSync(file, `${file}.${Date.now()}.old`);
    copyFileSync(join(BUILD, "Release", ADDON), file);
    writeFileSync(join(dir, STAMP), hash);

    for (const name of readdirSync(dir).filter(name => name.endsWith(".old"))) {
        try {
            rmSync(join(dir, name), { force: true });
        } catch { /* still loaded by a running Discord */ }
    }
}

if (process.platform === "win32" && !process.env.VENCORD_SKIP_NVENC) {
    try {
        const hash = sourceHash();
        const dirs = installDirs();

        if (dirs.every(dir => upToDate(dir, hash))) {
            log("the stream-only addon is up to date");
        } else {
            const cmake = ensureTools();
            run(cmake, ["-S", SOURCE, "-B", BUILD, "-A", "x64"]);
            run(cmake, ["--build", BUILD, "--config", "Release", "--clean-first"]);
            for (const dir of dirs) install(dir, hash);
            log(`stream-only addon installed in ${dirs.join(", ")}`);
        }
    } catch (e) {
        console.warn(
            `[StreamOverlay] could not build the stream-only addon, the overlays will stay on your screen: ${e.message}\n` +
            "Install the Visual Studio Build Tools (\"Desktop development with C++\") and CMake, then run: node scripts/build/nvenc.mjs"
        );
    }
}
