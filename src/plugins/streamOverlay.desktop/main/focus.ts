/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { basename } from "path";

import { spawnPowershell } from "./powershell";

const MAX_EXE_LENGTH = 128;

// Prints "F" + the file name of the program in focus whenever it changes. It asks Windows for nothing but that name:
// the right it opens the process with (0x1000) cannot read or change anything of it, and window titles are never looked at.
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

function startFocusWatch(onChange: (exe: string) => void) {
    if (process.platform !== "win32") return null;

    return spawnPowershell(WATCH_SCRIPT, line => {
        if (line[0] === "F") onChange(line.slice(1, MAX_EXE_LENGTH + 1));
    });
}

export class FocusWatcher {
    private watch: ReturnType<typeof startFocusWatch> = null;
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

    // `self` is Discord's own program: a window of it being in focus says nothing about what the user is doing
    read() {
        return { exe: this.exe, self: basename(process.execPath) };
    }
}
