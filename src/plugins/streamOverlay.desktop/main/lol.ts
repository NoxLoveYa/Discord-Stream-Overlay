/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { LolState } from "@plugins/streamOverlay.desktop/types";
import { get } from "https";

// The local League of Legends player, read straight from the game client on this machine: no login, no key,
// nothing leaves the machine. The Live Client API only answers while a game is live (never in champ select),
// so outside a game this reports null and the overlay falls back to its manual settings.
const LIVE_URL = "https://127.0.0.1:2999/liveclientdata/allgamedata";
const DD_VERSIONS = "https://ddragon.leagueoflegends.com/api/versions.json";
const ddragon = (version: string, path: string) => `https://ddragon.leagueoflegends.com/cdn/${version}/${path}`;

// addresses the overlay may show as images: Data Dragon spell icons only (like cleanMedia's cover check)
const DD_SPELL = /^https:\/\/ddragon\.leagueoflegends\.com\/cdn\/[\w.]+\/img\/spell\/[\w%.-]+\.png$/;
const CHAMPION_ID = /^[A-Za-z]+$/;
const SUMMONERS = new Set([
    "summoner-flash", "summoner-ignite", "summoner-teleport", "summoner-ghost",
    "summoner-exhaust", "summoner-heal", "summoner-barrier", "summoner-smite"
]);

// display names vary with the client language ("Flash", "Saut éclair", "Blitz"...): match them all,
// plus the internal ids ("SummonerFlash"). Unknown spells (ARAM Mark...) resolve to "" (the letter shows).
const SUMMONER_NAMES: Record<string, string> = {
    flash: "summoner-flash", sauteclair: "summoner-flash", blitz: "summoner-flash", destello: "summoner-flash",
    summonerflash: "summoner-flash",
    ignite: "summoner-ignite", embrasement: "summoner-ignite", entzunden: "summoner-ignite", ignicion: "summoner-ignite",
    summonerdot: "summoner-ignite",
    teleport: "summoner-teleport", teleportation: "summoner-teleport", teletransporte: "summoner-teleport",
    summonerteleport: "summoner-teleport",
    ghost: "summoner-ghost", fantome: "summoner-ghost", geist: "summoner-ghost", fantasma: "summoner-ghost",
    summonerhaste: "summoner-ghost",
    exhaust: "summoner-exhaust", fatigue: "summoner-exhaust", erschopfen: "summoner-exhaust",
    extenuacion: "summoner-exhaust", summonerexhaust: "summoner-exhaust",
    heal: "summoner-heal", soin: "summoner-heal", heilung: "summoner-heal", curacion: "summoner-heal",
    summonerheal: "summoner-heal",
    barrier: "summoner-barrier", barriere: "summoner-barrier", barrera: "summoner-barrier",
    summonerbarrier: "summoner-barrier",
    smite: "summoner-smite", chatiment: "summoner-smite", castigo: "summoner-smite",
    summonersmite: "summoner-smite"
};

// live names that match neither the Data Dragon id nor the display name ("Wukong" for id "MonkeyKing")
const SPECIAL_CHAMPIONS: Record<string, string> = { wukong: "MonkeyKing" };

const live = <T>(url: string): Promise<T | null> => getJson(url, true);
const web = <T>(url: string): Promise<T | null> => getJson(url, false);

function getJson<T>(url: string, insecure: boolean): Promise<T | null> {
    return new Promise(resolve => {
        const req = get(url, { rejectUnauthorized: !insecure }, res => {
            if (res.statusCode !== 200) {
                res.resume();
                resolve(null);
                return;
            }
            let raw = "";
            res.on("data", chunk => {
                raw += chunk;
                if (raw.length > 4_000_000) {
                    req.destroy();
                    resolve(null);
                }
            });
            res.on("end", () => {
                try {
                    resolve(JSON.parse(raw) as T);
                } catch {
                    resolve(null);
                }
            });
        });
        req.on("error", () => resolve(null));
        req.setTimeout(4000, () => {
            req.destroy();
            resolve(null);
        });
    });
}

/** "Saut éclair" -> "sauteclair", so every client language matches the same table. */
const norm = (value: unknown) =>
    typeof value === "string"
        ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "")
        : "";

const summonerId = (spell: any) => {
    for (const field of [spell?.displayName, spell?.name, spell?.rawDisplayName]) {
        const id = SUMMONER_NAMES[norm(field)];
        if (id) return id;
    }
    return "";
};

interface DdragonChampion {
    id: string;
    spells: string[];
}

let ddragonVersion: string | null = null;
let ddragonChampions: Map<string, DdragonChampion> | null = null;
let ddragonFailed = false;

async function ddragonData() {
    if (ddragonChampions || ddragonFailed) return ddragonChampions;
    try {
        const versions = await web<string[]>(DD_VERSIONS);
        const version = versions?.[0];
        if (typeof version !== "string" || !/^[\w.]+$/.test(version)) {
            ddragonFailed = true;
            return null;
        }
        ddragonVersion = version;
        const json = await web<any>(ddragon(ddragonVersion, "data/en_US/champion.json"));
        if (!json || typeof json.data !== "object") {
            ddragonFailed = true;
            return null;
        }
        const map = new Map<string, DdragonChampion>();
        for (const entry of Object.values<any>(json.data)) {
            if (typeof entry?.id !== "string" || !Array.isArray(entry.spells)) continue;
            const spells = entry.spells.slice(0, 4).map((s: any) =>
                typeof s?.image?.full === "string" ? ddragon(ddragonVersion!, `img/spell/${s.image.full}`) : "");
            const champion = { id: entry.id, spells };
            map.set(norm(entry.id), champion);
            if (typeof entry.name === "string") map.set(norm(entry.name), champion);
        }
        ddragonChampions = map;
        return map;
    } catch {
        ddragonFailed = true;
        return null;
    }
}

async function resolveChampion(raw: string): Promise<DdragonChampion | null> {
    const name = norm(typeof raw === "string" ? raw.replace(/^game_character_displayname_/, "") : "");
    if (!name) return null;
    if (SPECIAL_CHAMPIONS[name]) {
        const data = await ddragonData();
        return data?.get(norm(SPECIAL_CHAMPIONS[name])) ?? null;
    }
    return (await ddragonData())?.get(name) ?? null;
}

/** The state comes from the game client: shapes are checked, image addresses whitelisted. */
export function cleanLol(raw: any): LolState | null {
    const champion = typeof raw?.champion === "string" && CHAMPION_ID.test(raw.champion) ? raw.champion : "";
    const spells = (Array.isArray(raw?.spells) ? raw.spells : []).slice(0, 4)
        .map((u: unknown) => typeof u === "string" && DD_SPELL.test(u) ? u : "");
    while (spells.length < 4) spells.push("");
    const summonerD = SUMMONERS.has(raw?.summonerD) ? raw.summonerD : "";
    const summonerF = SUMMONERS.has(raw?.summonerF) ? raw.summonerF : "";
    if (!champion && spells.every(s => !s) && !summonerD && !summonerF) return null;
    return { champion, spells, summonerD, summonerF };
}

async function readLive(): Promise<LolState | null> {
    const json = await live<any>(LIVE_URL);
    if (!json) return null;
    const players: any[] = Array.isArray(json.allPlayers) ? json.allPlayers
        : Array.isArray(json.playerlist) ? json.playerlist : [];
    const active = typeof json.activePlayer?.summonerName === "string" ? json.activePlayer.summonerName
        : typeof json.activePlayerName === "string" ? json.activePlayerName : "";
    const me = players.find(p => p?.summonerName === active) ?? null;
    if (!me) return null;

    const champion = await resolveChampion(me.championName ?? me.rawChampionName ?? "");
    return cleanLol({
        champion: champion?.id ?? "",
        spells: champion?.spells ?? [],
        summonerD: summonerId(me.summonerSpells?.summonerSpellOne),
        summonerF: summonerId(me.summonerSpells?.summonerSpellTwo)
    });
}

type Listener = (state: LolState | null) => void;

const listeners = new Set<Listener>();
let timer: NodeJS.Timeout | null = null;
let last: LolState | null = null;
let misses = 0;

const same = (a: LolState | null, b: LolState | null) => JSON.stringify(a) === JSON.stringify(b);

function schedule() {
    // no game around: poll lazily, so an idle client costs nothing
    timer = setTimeout(() => void tick(), last ? 2000 : misses ? 5000 : 2000);
}

async function tick() {
    timer = null;
    let next: LolState | null = null;
    try {
        next = await readLive();
    } catch {
        next = null;
    }
    misses = next ? 0 : misses + 1;
    if (!same(next, last)) {
        last = next;
        for (const fn of [...listeners]) {
            try {
                fn(next);
            } catch { /* a closed window unsubscribes on its own */ }
        }
    }
    if (listeners.size) schedule();
}

/**
 * Calls back with the live LoL state whenever it changes (null outside a game), starting the poll on the
 * first subscriber and stopping it with the last one: nothing runs while no overlay asked for it.
 */
export function subscribeLol(fn: Listener) {
    listeners.add(fn);
    if (!timer) void tick();
    else {
        try {
            fn(last);
        } catch { /* ignore */ }
    }
    return () => {
        listeners.delete(fn);
        if (!listeners.size && timer) {
            clearTimeout(timer);
            timer = null;
        }
    };
}
