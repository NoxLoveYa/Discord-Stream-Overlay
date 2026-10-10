/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { BrowserWindow } from "electron";

import { lolChannel } from "./lol";
import { mediaChannel } from "./media";
import { callHook } from "./page";

/**
 * A kind of live data an overlay asks for with a flag of the same name in overlay.json (`"media": true`). The page receives
 * `streamoverlay:<name>` messages (`{ state }`, null when there is none) and no overlay that did not ask does. The name must not be
 * one of the manifest's own fields. A channel is fed by one of two ends:
 * - `clean`: the settings page pushes the state (`Native.setChannel`, from a Source in sources.ts) and it is checked here
 * - `watch`: the main process reads it itself, only while some overlay is shown that asked for it
 */
export interface Channel<T = unknown> {
    name: string;
    clean?(input: unknown): T | null;
    /** what the Layout tab shows while there is no state, so there is something to drag */
    sample?(): T;
    /** the returned function stops it */
    watch?(push: (state: T | null) => void): () => void;
}

export const CHANNELS: Channel[] = [mediaChannel, lolChannel];

/** The latest state of every channel for one overlay window, and what keeps the watched ones up to date. */
export class Channels {
    private readonly states = new Map<string, unknown>();
    private readonly stops = new Map<string, () => void>();

    constructor(private readonly getWindow: () => BrowserWindow | null, private readonly sampled: boolean) { }

    set(name: string, state: unknown) {
        this.states.set(name, state);
        return this.push(name);
    }

    /** Hands the state of one channel, or of all of them, to the host page. */
    push(only?: string) {
        const win = this.getWindow();
        if (!win) return Promise.resolve();

        return Promise.all(CHANNELS.filter(c => !only || c.name === only).map(channel => {
            const state = this.states.get(channel.name) ?? (this.sampled ? channel.sample?.() : undefined) ?? null;
            return callHook(win.webContents, "Channel", channel.name, state);
        }));
    }

    /** Watches the channels some overlay asked for and nothing else, so an idle client costs nothing. */
    sync(wanted: string[]) {
        for (const channel of CHANNELS) {
            const stop = this.stops.get(channel.name);
            if (wanted.includes(channel.name)) {
                if (!stop && channel.watch) this.stops.set(channel.name, channel.watch(state => void this.set(channel.name, state)));
            } else if (stop) {
                stop();
                this.stops.delete(channel.name);
                this.states.delete(channel.name);
            }
        }
    }

    stop() {
        this.sync([]);
    }
}
