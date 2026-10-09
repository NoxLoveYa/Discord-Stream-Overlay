/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Lights up the [data-key] elements while their key is held; the keyboard can regroup them (its "arrangement" setting).
(() => {
    const board = document.querySelector(".board");
    const keys = [...document.querySelectorAll("[data-key]")];
    const byKey = new Map(keys.map(key => [key.dataset.key, key]));
    const home = keys.map(key => ({
        key,
        parent: key.parentElement,
        next: key.nextElementSibling,
        span: key.style.getPropertyValue("--span")
    }));
    const originalRows = board ? [...board.querySelectorAll(":scope > .row")] : [];
    let arrangedRows = [];

    // rows of keys; pad is empty slots before a key, span its width in key widths (default: the one of index.html)
    const ARRANGEMENTS = {
        fps: [
            [{ k: "W", pad: 1 }],
            [{ k: "A" }, { k: "S" }, { k: "D" }],
            [{ k: "SHIFT" }, { k: "CTRL" }],
            [{ k: "SPACE", span: 3 }]
        ],
        moba: [
            [{ k: "Q" }, { k: "W" }, { k: "E" }, { k: "R" }, { k: "D", pad: 1 }, { k: "F" }]
        ]
    };

    const SUMMONERS = new Set([
        "summoner-flash", "summoner-ignite", "summoner-teleport", "summoner-ghost",
        "summoner-exhaust", "summoner-heal", "summoner-barrier", "summoner-smite"
    ]);
    const FALLBACK_SUMMONER = { D: "summoner-flash", F: "summoner-ignite" };

    // the settings reach the page as data attributes (data-summoner-d is dataset.summonerD) and as an event
    const settingsOf = root => ({
        arrangement: root.dataset.arrangement,
        champion: root.dataset.champion,
        summonerD: root.dataset.summonerD,
        summonerF: root.dataset.summonerF
    });

    // the manual settings, kept so the live state only overrides what is "auto"
    const picked = settingsOf(document.documentElement);
    // the live LoL player from the "streamoverlay:lol" messages, null outside a game
    let live = null;

    function setIcon(name, file) {
        const key = byKey.get(name);
        const cap = key?.querySelector(":scope > .cap");
        if (!cap) return;

        let img = cap.querySelector(":scope > img.spell");
        if (!file) {
            img?.removeAttribute("src");
            key.classList.remove("has-icon");
            return;
        }
        if (!img) {
            img = document.createElement("img");
            img.className = "spell";
            img.alt = "";
            img.draggable = false;
            cap.prepend(img);
        }
        if (img.getAttribute("src") !== file) img.setAttribute("src", file);
        key.classList.add("has-icon");
    }

    // the summoners follow the arrangement alone (a Letters board still shows them), the spells need a champion
    function applyIcons() {
        const inMoba = picked.arrangement === "moba";
        const spells = inMoba ? qwer() : null;
        for (const [i, k] of ["Q", "W", "E", "R"].entries()) setIcon(k, spells?.[i] ?? null);
        setIcon("D", inMoba ? summonerFile("D") : null);
        setIcon("F", inMoba ? summonerFile("F") : null);
    }

    // the ability icons of the live champion: Data Dragon addresses, validated by the host
    function qwer() {
        if (picked.champion !== "auto") return null;

        const urls = Array.isArray(live?.spells) ? live.spells : [];
        return [0, 1, 2, 3].map(i => typeof urls[i] === "string" && urls[i] ? urls[i] : null);
    }

    function summonerFile(which) {
        const manual = which === "D" ? picked.summonerD : picked.summonerF;
        if (typeof manual === "string" && manual !== "auto")
            return SUMMONERS.has(manual) ? `spells/${manual}.png` : null;
        const id = which === "D" ? live?.summonerD : live?.summonerF;
        const resolved = typeof id === "string" && SUMMONERS.has(id) ? id : FALLBACK_SUMMONER[which];
        return `spells/${resolved}.png`;
    }

    function applyArrangement(name) {
        if (!board) return;
        const rows = Object.hasOwn(ARRANGEMENTS, name) ? ARRANGEMENTS[name] : undefined;
        const anchor = board.querySelector(".resize");

        for (const row of [...arrangedRows, ...originalRows]) row.remove();
        arrangedRows = [];

        if (!rows) {
            // last key first, so that the sibling a key goes before is back in its row already
            for (const { key, parent, next, span } of [...home].reverse()) {
                parent.insertBefore(key, next);
                key.style.marginLeft = "";
                if (span) key.style.setProperty("--span", span);
                else key.style.removeProperty("--span");
                key.classList.remove("is-hidden");
            }
            for (const row of originalRows) board.insertBefore(row, anchor);
            return;
        }

        const shown = new Set();
        for (const line of rows) {
            const row = document.createElement("div");
            row.className = "row";
            arrangedRows.push(row);
            for (const { k, span, pad } of line) {
                const key = byKey.get(k);
                if (!key) continue;
                shown.add(k);
                key.style.marginLeft = pad ? `calc(var(--pitch) * ${pad})` : "";
                if (span) key.style.setProperty("--span", span);
                row.appendChild(key);
            }
            board.insertBefore(row, anchor);
        }
        for (const key of keys) key.classList.toggle("is-hidden", !shown.has(key.dataset.key));
    }

    addEventListener("message", ({ source, data }) => {
        if (source !== parent) return;

        if (data?.type === "streamoverlay:keys") {
            const down = new Set(data.down);
            for (const key of keys) key.classList.toggle("is-down", down.has(key.dataset.key));
        } else if (data?.type === "streamoverlay:lol") {
            live = data.state ?? null;
            applyIcons();
        }
    });

    addEventListener("streamoverlay:settings", ({ detail }) => {
        if (!detail || typeof detail !== "object") return;
        if (typeof detail.arrangement === "string") {
            picked.arrangement = detail.arrangement;
            applyArrangement(detail.arrangement);
        }
        if (typeof detail.champion === "string") picked.champion = detail.champion;
        if (typeof detail["summoner-d"] === "string") picked.summonerD = detail["summoner-d"];
        if (typeof detail["summoner-f"] === "string") picked.summonerF = detail["summoner-f"];
        applyIcons();
    });

    if (picked.arrangement) applyArrangement(picked.arrangement);
    applyIcons();
})();
