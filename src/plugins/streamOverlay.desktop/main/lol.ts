/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { LolState } from "@plugins/streamOverlay.desktop/types";
import { get } from "https";

import { own } from "./values";

// The Live Client API only answers while a game is live (never in champ select), so outside a game this reports null
// and the overlay falls back to its manual settings. Nothing leaves the machine except the public Data Dragon lookups.
const LIVE_URL = "https://127.0.0.1:2999/liveclientdata/allgamedata";
const DD_VERSIONS = "https://ddragon.leagueoflegends.com/api/versions.json";
const ddragon = (version: string, path: string) => `https://ddragon.leagueoflegends.com/cdn/${version}/${path}`;

const REQUEST_TIMEOUT_MS = 4000;
const MAX_RESPONSE_CHARS = 4_000_000;
const ACTIVE_POLL_MS = 2000;
const IDLE_POLL_MS = 5000;
const DD_RETRY_MS = 60_000;

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

// everything below comes from a local process or the network: shapes are checked before use
interface LiveSpell {
    displayName?: unknown;
    name?: unknown;
    rawDisplayName?: unknown;
}

interface LivePlayer {
    summonerName?: unknown;
    championName?: unknown;
    rawChampionName?: unknown;
    summonerSpells?: { summonerSpellOne?: LiveSpell; summonerSpellTwo?: LiveSpell; };
}

interface LiveGame {
    allPlayers?: unknown;
    playerlist?: unknown;
    activePlayer?: { summonerName?: unknown; };
    activePlayerName?: unknown;
}

interface DdragonChampionJson {
    id?: unknown;
    name?: unknown;
    spells?: { image?: { full?: unknown; }; }[];
}

interface DdragonChampion {
    id: string;
    spells: string[];
}

const live = <T>(url: string): Promise<T | null> => getJson(url, true);
const web = <T>(url: string): Promise<T | null> => getJson(url, false);

// `insecure`: the game's local server presents a self-signed certificate
function getJson<T>(url: string, insecure: boolean): Promise<T | null> {
    return new Promise(resolve => {
        const req = get(url, { rejectUnauthorized: !insecure }, res => {
            if (res.statusCode !== 200) {
                res.resume();
                resolve(null);
                return;
            }
            res.setEncoding("utf8");
            let raw = "";
            res.on("data", chunk => {
                raw += chunk;
                if (raw.length > MAX_RESPONSE_CHARS) {
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
            res.on("error", () => resolve(null));
        });
        req.on("error", () => resolve(null));
        req.setTimeout(REQUEST_TIMEOUT_MS, () => {
            req.destroy();
            resolve(null);
        });
    });
}

// "Saut éclair" -> "sauteclair", so every client language matches the same table
const norm = (value: unknown) =>
    typeof value === "string"
        ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "")
        : "";

const summonerId = (spell: LiveSpell | undefined) => {
    for (const field of [spell?.displayName, spell?.name, spell?.rawDisplayName]) {
        const id = own(SUMMONER_NAMES, norm(field));
        if (id) return id;
    }
    return "";
};

let ddragonChampions: Map<string, DdragonChampion> | null = null;
let ddragonRetryAt = 0;

async function loadDdragon(): Promise<Map<string, DdragonChampion> | null> {
    const versions = await web<string[]>(DD_VERSIONS);
    const version = versions?.[0];
    if (typeof version !== "string" || !/^[\w.]+$/.test(version)) return null;

    const json = await web<{ data?: Record<string, DdragonChampionJson>; }>(ddragon(version, "data/en_US/champion.json"));
    if (!json?.data || typeof json.data !== "object") return null;

    const map = new Map<string, DdragonChampion>();
    for (const entry of Object.values(json.data)) {
        if (typeof entry?.id !== "string" || !Array.isArray(entry.spells)) continue;
        const spells = entry.spells.slice(0, 4).map(s =>
            typeof s?.image?.full === "string" ? ddragon(version, `img/spell/${s.image.full}`) : "");
        const champion = { id: entry.id, spells };
        map.set(norm(entry.id), champion);
        if (typeof entry.name === "string") map.set(norm(entry.name), champion);
    }
    return map;
}

async function ddragonData() {
    if (ddragonChampions || Date.now() < ddragonRetryAt) return ddragonChampions;

    ddragonChampions = await loadDdragon().catch(() => null);
    if (!ddragonChampions) ddragonRetryAt = Date.now() + DD_RETRY_MS;
    return ddragonChampions;
}

async function resolveChampion(raw: unknown): Promise<DdragonChampion | null> {
    const name = norm(typeof raw === "string" ? raw.replace(/^game_character_displayname_/, "") : "");
    if (!name) return null;
    return (await ddragonData())?.get(norm(own(SPECIAL_CHAMPIONS, name) ?? name)) ?? null;
}

// image addresses are whitelisted and ids shape-checked: this goes straight to the overlay page
function cleanLol(raw: LolState): LolState | null {
    const champion = CHAMPION_ID.test(raw.champion) ? raw.champion : "";
    const spells = raw.spells.slice(0, 4).map(u => DD_SPELL.test(u) ? u : "");
    while (spells.length < 4) spells.push("");
    const summonerD = SUMMONERS.has(raw.summonerD) ? raw.summonerD : "";
    const summonerF = SUMMONERS.has(raw.summonerF) ? raw.summonerF : "";
    if (!champion && spells.every(s => !s) && !summonerD && !summonerF) return null;
    return { champion, spells, summonerD, summonerF };
}

async function readLive(): Promise<LolState | null> {
    const json = await live<LiveGame>(LIVE_URL);
    if (!json) return null;
    const players: LivePlayer[] = Array.isArray(json.allPlayers) ? json.allPlayers
        : Array.isArray(json.playerlist) ? json.playerlist : [];
    const active = typeof json.activePlayer?.summonerName === "string" ? json.activePlayer.summonerName
        : typeof json.activePlayerName === "string" ? json.activePlayerName : "";
    const me = players.find(p => p?.summonerName === active);
    if (!me) return null;

    const champion = await resolveChampion(me.championName ?? me.rawChampionName);
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
let busy = false;
let last: LolState | null = null;

const same = (a: LolState | null, b: LolState | null) => JSON.stringify(a) === JSON.stringify(b);

function notify(fn: Listener, state: LolState | null) {
    try {
        fn(state);
    } catch { /* a closed window unsubscribes on its own */ }
}

async function tick() {
    timer = null;
    busy = true;
    const next = await readLive().catch(() => null);
    busy = false;
    if (!listeners.size) return; // everyone left while the request was in flight

    if (!same(next, last)) {
        last = next;
        for (const fn of [...listeners]) notify(fn, next);
    }
    // no game around: poll lazily, so an idle client costs nothing
    timer = setTimeout(() => void tick(), last ? ACTIVE_POLL_MS : IDLE_POLL_MS);
}

/** Calls back whenever the live LoL state changes (null outside a game). Polls only while someone is subscribed. */
export function subscribeLol(fn: Listener) {
    listeners.add(fn);
    if (last) notify(fn, last);
    if (!timer && !busy) void tick();

    return () => {
        listeners.delete(fn);
        if (listeners.size) return;

        if (timer) clearTimeout(timer);
        timer = null;
        // a later subscriber has to be told the state again, even if the game did not change meanwhile
        last = null;
    };
}
