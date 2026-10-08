/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Whether "stream only" really puts the overlay in the stream. The overlay is taken off the screen as soon as the hook is
// in, so if the stream is not encoded by an encoder the hook draws into (NVENC, or Windows' own software H.264 encoder: not a
// laptop whose screen is on the integrated GPU with an AMD or Intel hardware encoder) nobody would see it at all. No React and no store, so it can be tested alone.

/** What the native hook reports (see status() in nvenc/hook.cc), summed over the pages that have it. */
export interface HookStatus {
    /** drawing is on: it switches itself off when a frame cannot be drawn */
    draw: boolean;
    /** frames NVENC was given since drawing went on */
    encodes: number;
    /** of those, the ones the overlay was drawn on */
    drawn: number;
    /** frames whose texture the hook never saw being registered (the stream began before the hook) */
    unknown: number;
    error: string;
}

/** How long the stream gets to start encoding before it counts that nothing went through the hook. */
export const GRACE_MS = 10_000;

export function parseStatus(text: string): HookStatus | null {
    try {
        const raw = JSON.parse(text);
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

/** Adds up what several pages of the app report (the one that encodes has the numbers; any of them may have stopped drawing). */
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

/**
 * Why the overlay is not in the stream, or null when it is (or it is too early to tell). `waited` is how long the overlay
 * has been off the screen. `encoding` is whether Discord says it encodes the stream at all (null: it does not say): with
 * nobody watching it encodes nothing, which gives the hook nothing to see and is no reason to give up.
 */
export function judgeHook(status: HookStatus | null, waited: number, encoding: boolean | null = null): string | null {
    if (waited < GRACE_MS) {
        // it switches itself off when a frame cannot be drawn: no need to wait for that
        return status && !status.draw ? `drawing was switched off${status.error ? `: ${status.error}` : ""}` : null;
    }

    if (!status) return "the encoder hook did not answer";
    if (!status.draw) return `drawing was switched off${status.error ? `: ${status.error}` : ""}`;
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
