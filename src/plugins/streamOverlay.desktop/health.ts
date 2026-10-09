/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Whether "stream only" really puts the overlay in the stream: the overlay leaves the screen as soon as the hook is in, so
// a stream encoded by something the hook cannot draw into (an AMD or Intel hardware encoder) would show it nowhere.

// what the native hook reports (see status() in nvenc/hook.cc), summed over the pages that have it
interface HookStatus {
    /** drawing is on: it switches itself off when a frame cannot be drawn */
    draw: boolean;
    /** frames given to an encoder since drawing went on, and the ones the overlay was drawn on */
    encodes: number;
    drawn: number;
    /** frames whose texture the hook never saw being registered (the stream began before the hook) */
    unknown: number;
    error: string;
}

/** How long the stream gets to start encoding before it counts that nothing went through the hook. */
export const GRACE_MS = 10_000;

export function parseStatus(text: string): HookStatus | null {
    try {
        const raw = JSON.parse(text) as Record<string, unknown> | null;
        const count = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
        return {
            draw: raw?.draw === true,
            encodes: count(raw?.encodes),
            drawn: count(raw?.drawn),
            unknown: count(raw?.unknown),
            error: typeof raw?.error === "string" ? raw.error : ""
        };
    } catch {
        return null;
    }
}

// the page that encodes has the numbers; any of them may have stopped drawing
export function combineStatus(list: (HookStatus | null)[]): HookStatus | null {
    const known = list.filter((s): s is HookStatus => s != null);
    if (!known.length) return null;

    return {
        draw: known.every(s => s.draw),
        encodes: known.reduce((n, s) => n + s.encodes, 0),
        drawn: known.reduce((n, s) => n + s.drawn, 0),
        unknown: known.reduce((n, s) => n + s.unknown, 0),
        error: known.find(s => s.error)?.error ?? ""
    };
}

const switchedOff = (status: HookStatus) => `drawing was switched off${status.error ? `: ${status.error}` : ""}`;

/** Why the overlay is not in the stream, or null when it is or it is too early to tell. `encoding`: whether Discord says it encodes at all. */
export function judgeHook(status: HookStatus | null, waited: number, encoding: boolean | null = null): string | null {
    if (waited < GRACE_MS) {
        // it switches itself off when a frame cannot be drawn: no need to wait for that
        return status && !status.draw ? switchedOff(status) : null;
    }

    if (!status) return "the encoder hook did not answer";
    if (!status.draw) return switchedOff(status);
    if (status.encodes === 0) {
        if (encoding === false) return null;
        return "the stream is not encoded by NVENC or by Windows' software encoder (another encoder, or the screen is on another graphics card)";
    }
    if (status.drawn === 0) {
        if (status.error) return status.error;
        return status.unknown > 0 ? "the stream began before the hook was in" : "no frame could be drawn on";
    }
    return null;
}
