/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { spawn } from "child_process";
import { basename } from "path";

// Prints "F" + the file name of the program of the window in focus (like "game.exe") whenever it changes, and exits once
// its stdin closes (plugin stopped, Discord dead). It asks Windows for nothing but that name: the right it opens the
// process with cannot read or change anything of it, and window titles are never looked at.
const WATCH_SCRIPT = `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class FocusWatch {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint size);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    static string Exe() {
        uint pid;
        GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        if (pid == 0) return "";
        IntPtr process = OpenProcess(0x1000, false, pid);
        if (process == IntPtr.Zero) return "";
        try {
            StringBuilder name = new StringBuilder(1024);
            uint size = 1024;
            return QueryFullProcessImageName(process, 0, name, ref size) ? Path.GetFileName(name.ToString()) : "";
        } finally { CloseHandle(process); }
    }

    public static void Run() {
        Thread watcher = new Thread(() => { Console.In.ReadToEnd(); Environment.Exit(0); });
        watcher.IsBackground = true;
        watcher.Start();
        string last = null;
        while (true) {
            string exe = Exe();
            if (exe != last) { last = exe; Console.Out.WriteLine("F" + exe); Console.Out.Flush(); }
            Thread.Sleep(250);
        }
    }
}
'@
[FocusWatch]::Run()
`;

export interface FocusWatch {
    stop(): void;
}

export function startFocusWatch(onChange: (exe: string) => void): FocusWatch | null {
    if (process.platform !== "win32") return null;

    const child = spawn("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-EncodedCommand", Buffer.from(WATCH_SCRIPT, "utf16le").toString("base64")
    ], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });

    let pending = "";
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
        pending += chunk;
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) {
            const line = pending.slice(0, end).trim();
            pending = pending.slice(end + 1);
            if (line[0] === "F") onChange(line.slice(1, 129));
        }
    });
    child.on("error", () => { });

    return {
        stop() {
            child.stdin.end();
            child.kill();
        }
    };
}

/** Keeps track of the program in focus while someone is interested in it. */
export class FocusWatcher {
    private watch: FocusWatch | null = null;
    private exe = "";

    set(on: boolean) {
        if (on === !!this.watch) return;

        if (on) {
            this.watch = startFocusWatch(exe => this.exe = exe);
        } else {
            this.watch?.stop();
            this.watch = null;
            this.exe = "";
        }
    }

    /** `self` is Discord's own program: a window of it being in focus says nothing about what the user is doing */
    read() {
        return { exe: this.exe, self: basename(process.execPath) };
    }
}
