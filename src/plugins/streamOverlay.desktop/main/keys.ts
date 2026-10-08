/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { spawn } from "child_process";

// Whitelist: no key outside this table is ever read. F24 is bound to nothing, so tests can press it safely.
export const VIRTUAL_KEYS = new Map<string, number>([
    ...[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"].map(c => [c, c.charCodeAt(0)] as const),
    ["SHIFT", 0x10], ["CTRL", 0x11], ["ALT", 0x12], ["CAPS", 0x14], ["SPACE", 0x20], ["TAB", 0x09], ["ENTER", 0x0d], ["ESC", 0x1b],
    ["LEFT", 0x25], ["UP", 0x26], ["RIGHT", 0x27], ["DOWN", 0x28],
    ["F24", 0x87]
]);

// Prints a line of 0/1 (one per requested key) on every change, and exits once its stdin closes (plugin stopped, Discord dead).
const POLL_SCRIPT = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class KeyPoll {
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint ms);
    public static void Run(int[] keys) {
        timeBeginPeriod(1);
        Thread watcher = new Thread(() => { Console.In.ReadToEnd(); Environment.Exit(0); });
        watcher.IsBackground = true;
        watcher.Start();
        char[] last = new char[keys.Length];
        for (int i = 0; i < last.Length; i++) last[i] = '?';
        while (true) {
            bool changed = false;
            for (int i = 0; i < keys.Length; i++) {
                char c = (GetAsyncKeyState(keys[i]) & 0x8000) != 0 ? '1' : '0';
                if (c != last[i]) { last[i] = c; changed = true; }
            }
            if (changed) { Console.Out.WriteLine(new string(last)); Console.Out.Flush(); }
            Thread.Sleep(2);
        }
    }
}
'@
[KeyPoll]::Run([int[]]@(__KEYS__))
`;

export interface KeyPoll {
    names: string[];
    stop(): void;
}

export function startKeyPoll(names: string[], onChange: (down: string[]) => void): KeyPoll | null {
    if (process.platform !== "win32" || !names.length) return null;

    const script = POLL_SCRIPT.replace("__KEYS__", names.map(n => VIRTUAL_KEYS.get(n)).join(","));
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
            if (line.length === names.length && /^[01]+$/.test(line))
                onChange(names.filter((_, i) => line[i] === "1"));
        }
    });
    child.on("error", () => { });
    // whatever ends the helper, nothing may stay "held"
    child.on("exit", () => onChange([]));

    return {
        names,
        stop() {
            child.stdin.end();
            child.kill();
        }
    };
}
