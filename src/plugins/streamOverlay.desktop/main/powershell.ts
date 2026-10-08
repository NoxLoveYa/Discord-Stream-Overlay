/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { spawn } from "child_process";

/** Runs a script that prints one event per line and exits once its stdin closes. */
export function spawnPowershell(script: string, onLine: (line: string) => void) {
    const child = spawn("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")
    ], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });

    let pending = "";
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
        pending += chunk;
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) {
            const line = pending.slice(0, end).trim();
            pending = pending.slice(end + 1);
            onLine(line);
        }
    });
    // powershell could not start: there is nothing to read
    child.on("error", () => { });

    return {
        child,
        stop() {
            child.stdin.end();
            child.kill();
        }
    };
}
