/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { useEffect, useState } from "@webpack/common";

import { matchBinding } from "./apps";
import { findPreset, isGlobalActive } from "./presets";
import { applyGlobalPreset, Native, plain, restoreState, settings, snapshotState } from "./settings";
import type { GlobalPreset } from "./types";

const logger = new Logger("StreamOverlay");

const POLL_MS = 300;
// a program has to stay in focus this long before it counts, so passing through windows with alt + tab changes nothing
const STABLE_MS = 600;
const DETECT_MS = 20000;

let timer: ReturnType<typeof setInterval> | undefined;
let busy = false;
let watching = false;
// how many things want to know what is in focus besides the bindings (the settings page, a detection)
let interest = 0;
let seen = { app: "", since: 0 };
let focused = "";
const listeners = new Set<(app: string) => void>();

/** What a binding replaced: where to go back to when its program is no longer in focus. */
let applied: { app: string; preset: string; before: ReturnType<typeof snapshotState>; } | null = null;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function setWatching(on: boolean) {
    if (on === watching) return;
    watching = on;
    await Native.watchFocus(on);
}

function setFocused(app: string) {
    if (app === focused) return;
    focused = app;
    listeners.forEach(listener => listener(app));
}

/** Whether nobody changed what the binding applied since: only then is it safe to put the old state back. */
async function untouched(presetName: string) {
    const presets: GlobalPreset[] = plain(settings.store.globalPresets);
    const preset = findPreset(presets, presetName);
    if (!preset) return false;

    const { overlays } = await Native.listOverlays(settings.store.overlayRoot);
    return isGlobalActive(preset, overlays, [...settings.store.enabledOverlays], plain(settings.store.overlayValues));
}

async function follow(app: string) {
    const match = matchBinding(app, plain(settings.store.appBindings), plain(settings.store.globalPresets));

    if (match) {
        if (applied?.app === match.binding.app && applied.preset === match.preset.name) return;

        // from one program's preset to another's, going back still means going back to what was there before the first
        const before = applied?.before ?? snapshotState();
        applyGlobalPreset(match.preset);
        applied = { app: match.binding.app, preset: match.preset.name, before };
        logger.info("applied a preset for the program in focus", { app, preset: match.preset.name });
        return;
    }

    if (!applied) return;

    const { before, preset } = applied;
    applied = null;
    if (settings.store.appRevert && await untouched(preset)) {
        restoreState(before);
        logger.info("went back to what was set before", { app });
    }
}

async function tick() {
    if (busy) return;
    busy = true;

    try {
        const hasBindings = settings.store.appBindings.some(b => b.enabled);
        await setWatching(interest > 0 || hasBindings || applied !== null);
        if (!watching) return;

        const { exe, self } = await Native.getFocus();
        const app = exe.toLowerCase();
        const own = !app || app === self.toLowerCase();

        if (app !== seen.app) seen = { app, since: Date.now() };
        setFocused(own ? "" : app);

        // Discord's own windows say nothing about what is being done, nor does a window that cannot be told
        if (own || Date.now() - seen.since < STABLE_MS) return;
        if (hasBindings || applied) await follow(app);
    } catch (error) {
        logger.error("following the program in focus failed", error);
    } finally {
        busy = false;
    }
}

export function startAppPresets() {
    clearInterval(timer);
    timer = setInterval(tick, POLL_MS);
}

export function stopAppPresets() {
    clearInterval(timer);
    applied = null;
    seen = { app: "", since: 0 };
    setFocused("");
    watching = false;
    Native.watchFocus(false);
}

/** The program in focus (not Discord), while the component is on screen. */
export function useFocusedApp() {
    const [app, setApp] = useState(focused);

    useEffect(() => {
        interest++;
        listeners.add(setApp);
        setApp(focused);
        return () => {
            interest--;
            listeners.delete(setApp);
        };
    }, []);

    return app;
}

/** Resolves with the next program that comes into focus (not Discord), or null after a while or when aborted. */
export async function detectApp(signal: AbortSignal) {
    interest++;
    try {
        await setWatching(true);

        for (const end = Date.now() + DETECT_MS; !signal.aborted && Date.now() < end; await sleep(POLL_MS)) {
            const { exe, self } = await Native.getFocus();
            const app = exe.toLowerCase();
            if (app && app !== self.toLowerCase()) return app;
        }
        return null;
    } finally {
        interest--;
    }
}
