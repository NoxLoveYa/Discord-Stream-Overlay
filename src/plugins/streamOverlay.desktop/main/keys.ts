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
    ["LMB", 0x01], ["RMB", 0x02], ["MMB", 0x04],
    ["F24", 0x87]
]);

// Prints "K" + a 0/1 per requested key on every change, and, when the mouse is wanted, "M<dx> <dy> <wheel>": the
// movement and wheel since the previous such line (at most every 16 ms). The mouse comes from raw input rather than
// the cursor position, which stops moving at the edge of the screen or when a game locks the cursor.
// It exits once its stdin closes (plugin stopped, Discord dead).
const POLL_SCRIPT = `
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
public static class InputPoll {
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] static extern bool RegisterRawInputDevices(RawDevice[] devices, uint count, uint size);
    [DllImport("user32.dll")] static extern uint GetRawInputData(IntPtr raw, uint command, IntPtr data, ref uint size, uint header);
    [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint ms);

    [StructLayout(LayoutKind.Sequential)]
    struct RawDevice { public ushort Page; public ushort Usage; public uint Flags; public IntPtr Target; }

    static int dx, dy, wheel;
    static Sink sink;

    class Sink : NativeWindow {
        public Sink() {
            CreateParams p = new CreateParams();
            p.Parent = new IntPtr(-3);
            CreateHandle(p);
            RawDevice[] devices = { new RawDevice { Page = 1, Usage = 2, Flags = 0x100, Target = Handle } };
            RegisterRawInputDevices(devices, 1, (uint)Marshal.SizeOf(typeof(RawDevice)));
        }
        protected override void WndProc(ref Message m) {
            if (m.Msg == 0x00FF) Read(m.LParam);
            base.WndProc(ref m);
        }
    }

    static void Read(IntPtr raw) {
        uint size = 0;
        uint header = (uint)(IntPtr.Size == 8 ? 24 : 16);
        GetRawInputData(raw, 0x10000003, IntPtr.Zero, ref size, header);
        if (size == 0 || size > 512) return;
        IntPtr buf = Marshal.AllocHGlobal((int)size);
        try {
            if (GetRawInputData(raw, 0x10000003, buf, ref size, header) != size || Marshal.ReadInt32(buf) != 0) return;
            int o = (int)header;
            if ((Marshal.ReadInt16(buf, o) & 1) == 0) {
                Interlocked.Add(ref dx, Marshal.ReadInt32(buf, o + 12));
                Interlocked.Add(ref dy, Marshal.ReadInt32(buf, o + 16));
            }
            if ((Marshal.ReadInt16(buf, o + 4) & 0x0400) != 0) Interlocked.Add(ref wheel, Marshal.ReadInt16(buf, o + 6));
        } finally { Marshal.FreeHGlobal(buf); }
    }

    public static void Run(int[] keys, bool mouse) {
        timeBeginPeriod(1);
        Thread watcher = new Thread(() => { Console.In.ReadToEnd(); Environment.Exit(0); });
        watcher.IsBackground = true;
        watcher.Start();
        if (mouse) {
            Thread pump = new Thread(() => { sink = new Sink(); Application.Run(); });
            pump.SetApartmentState(ApartmentState.STA);
            pump.IsBackground = true;
            pump.Start();
        }
        char[] last = new char[keys.Length];
        for (int i = 0; i < last.Length; i++) last[i] = '?';
        int lastMouse = Environment.TickCount;
        while (true) {
            bool changed = false;
            for (int i = 0; i < keys.Length; i++) {
                char c = (GetAsyncKeyState(keys[i]) & 0x8000) != 0 ? '1' : '0';
                if (c != last[i]) { last[i] = c; changed = true; }
            }
            if (changed) { Console.Out.WriteLine("K" + new string(last)); Console.Out.Flush(); }
            if (mouse && Environment.TickCount - lastMouse >= 16) {
                int x = Interlocked.Exchange(ref dx, 0), y = Interlocked.Exchange(ref dy, 0), w = Interlocked.Exchange(ref wheel, 0);
                if (x != 0 || y != 0 || w != 0) {
                    Console.Out.WriteLine("M" + x + " " + y + " " + w);
                    Console.Out.Flush();
                    lastMouse = Environment.TickCount;
                }
            }
            Thread.Sleep(2);
        }
    }
}
'@
[InputPoll]::Run([int[]]@(__KEYS__), __MOUSE__)
`;

export interface InputPoll {
    names: string[];
    mouse: boolean;
    stop(): void;
}

export interface InputHandlers {
    keys(down: string[]): void;
    mouse(dx: number, dy: number, wheel: number): void;
}

export function startInputPoll(names: string[], mouse: boolean, on: InputHandlers): InputPoll | null {
    if (process.platform !== "win32" || (!names.length && !mouse)) return null;

    const script = POLL_SCRIPT
        .replace("__KEYS__", names.map(n => VIRTUAL_KEYS.get(n)).join(","))
        .replace("__MOUSE__", mouse ? "$true" : "$false");
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

            if (line[0] === "K") {
                const bits = line.slice(1);
                if (bits.length === names.length && /^[01]*$/.test(bits))
                    on.keys(names.filter((_, i) => bits[i] === "1"));
            } else if (line[0] === "M") {
                const [dx, dy, wheel] = line.slice(1).split(" ").map(Number);
                if ([dx, dy, wheel].every(Number.isInteger)) on.mouse(dx, dy, wheel);
            }
        }
    });
    child.on("error", () => { });
    // whatever ends the helper, nothing may stay "held"
    child.on("exit", () => on.keys([]));

    return {
        names,
        mouse,
        stop() {
            child.stdin.end();
            child.kill();
        }
    };
}
