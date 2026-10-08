/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Builds a Windows installer (dist/package/Vencord-StreamOverlay-Setup-<version>.exe) with Inno Setup. It contains this
// Vencord (built from this checkout), the prebuilt stream-only addon and the Vencord patcher, so the machine it is
// installed on needs no Node, pnpm or Visual Studio. Run it with `pnpm package`.
//
// Inno Setup 6 is needed: `winget install JRSoftware.InnoSetup`, or set ISCC to the path of ISCC.exe.

import { spawnSync } from "child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "dist", "package");
const STAGE = join(OUT, "stage");
const ADDON = join(ROOT, "src", "plugins", "streamOverlay.desktop", "nvenc", "build", "Release", "streamoverlay_nvenc.node");
const CLI = join(ROOT, "dist", "Installer", "VencordInstallerCli.exe");

// what Discord loads of a build; the standalone and web files and the source maps are left out
const DIST_FILES = ["patcher.js", "patcher.js.LEGAL.txt", "preload.js", "renderer.js", "renderer.js.LEGAL.txt", "renderer.css"];

const log = message => console.log(`[package] ${message}`);

function fail(message) {
    console.error(`[package] ${message}`);
    process.exit(1);
}

function run(command, args, what) {
    const { status, error } = spawnSync(command, args, { cwd: ROOT, stdio: "inherit" });
    if (status !== 0) fail(`${what} failed${error ? `: ${error.message}` : ` (exit code ${status})`}`);
}

function findIscc() {
    const candidates = [
        process.env.ISCC,
        join(process.env.LOCALAPPDATA ?? "", "Programs", "Inno Setup 6", "ISCC.exe"),
        join(process.env["ProgramFiles(x86)"] ?? "", "Inno Setup 6", "ISCC.exe"),
        join(process.env.ProgramFiles ?? "", "Inno Setup 6", "ISCC.exe")
    ];
    return candidates.find(file => file && existsSync(file));
}

if (process.platform !== "win32") fail("The installer is for Windows.");

const iscc = findIscc();
if (!iscc) fail("Inno Setup 6 was not found: run `winget install JRSoftware.InnoSetup` (or set ISCC to the path of ISCC.exe).");

const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));

log("building Vencord");
run(process.execPath, ["--require=./scripts/suppressExperimentalWarnings.js", "scripts/build/build.mjs"], "the build");

// builds the addon too when its sources changed (and installs it for this machine, as `pnpm build` does)
if (!existsSync(ADDON)) {
    log("building the stream-only addon");
    run(process.execPath, ["scripts/build/nvenc.mjs"], "the addon build");
}
if (!existsSync(ADDON)) fail("The stream-only addon could not be built (see above): the installer would not have it.");

if (!existsSync(CLI)) {
    log("downloading the Vencord patcher");
    // downloads it, then prints its usage
    run(process.execPath, ["scripts/runInstaller.mjs", "--", "-help"], "downloading the patcher");
}
if (!existsSync(CLI)) fail("The Vencord patcher (VencordInstallerCli.exe) is missing.");

log("staging the files");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(STAGE, "dist"), { recursive: true });
for (const file of DIST_FILES) {
    const from = join(ROOT, "dist", file);
    if (!existsSync(from)) fail(`dist/${file} is missing: the build did not make it.`);
    copyFileSync(from, join(STAGE, "dist", file));
}
copyFileSync(ADDON, join(STAGE, "streamoverlay_nvenc.node"));
copyFileSync(CLI, join(STAGE, "VencordInstallerCli.exe"));
copyFileSync(join(ROOT, "scripts", "package", "patch.cmd"), join(STAGE, "patch.cmd"));
copyFileSync(join(ROOT, "LICENSE"), join(STAGE, "LICENSE"));

log("building the installer");
run(iscc, ["/Q", `/DVersion=${version}`, `/DStage=${STAGE}`, `/DOutputDir=${OUT}`, join(ROOT, "scripts", "package", "installer.iss")], "Inno Setup");

rmSync(STAGE, { recursive: true, force: true });
log(`done: ${join(OUT, `Vencord-StreamOverlay-Setup-${version}.exe`)}`);
