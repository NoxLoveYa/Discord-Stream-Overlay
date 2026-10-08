/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Lights up the [data-key] elements while their key is held; the keyboard can regroup them (its "arrangement" setting).
(() => {
    const board = document.querySelector(".board");
    const keys = [...document.querySelectorAll("[data-key]")];
    // where every key was written in index.html, to go back to the full keyboard
    const home = keys.map(key => ({
        key,
        parent: key.parentElement,
        next: key.nextElementSibling,
        span: key.style.getPropertyValue("--span")
    }));

    // Rows of keys, in key widths; pad is empty slots before the key, span its width.
    // Every key keeps the span of index.html unless the map says otherwise.
    const ARRANGEMENTS = {
        // W over S, then A S D, then the modifiers, then the spacebar as wide as the cluster
        fps: [
            [{ k: "W", pad: 1 }],
            [{ k: "A" }, { k: "S" }, { k: "D" }],
            [{ k: "SHIFT" }, { k: "CTRL" }],
            [{ k: "SPACE", span: 3 }]
        ],
        // the spells and the summoners on one row, a gap between them, like the bottom of a LoL screen
        moba: [
            [{ k: "Q" }, { k: "W" }, { k: "E" }, { k: "R" }, { k: "D", pad: 1 }, { k: "F" }]
        ]
    };

    const byKey = new Map(keys.map(key => [key.dataset.key, key]));

    // Spell icons for the MOBA arrangement: the champion's QWER (bundled files for Fiora and Akali,
    // Data Dragon addresses for a live-detected champion) and the summoner of D and F (bundled files).
    // A missing icon leaves the letter.
    const CHAMPIONS = {
        fiora: { Q: "spells/fiora-q.png", W: "spells/fiora-w.png", E: "spells/fiora-e.png", R: "spells/fiora-r.png" },
        akali: { Q: "spells/akali-q.png", W: "spells/akali-w.png", E: "spells/akali-e.png", R: "spells/akali-r.png" }
    };
    const SUMMONERS = new Set([
        "summoner-flash", "summoner-ignite", "summoner-teleport", "summoner-ghost",
        "summoner-exhaust", "summoner-heal", "summoner-barrier", "summoner-smite"
    ]);

    // the live LoL player, from the "streamoverlay:lol" messages (null outside a game)
    let live = null;
    // an "auto" setting with no game around falls back to the old defaults
    const FALLBACK_SUMMONER = { D: "summoner-flash", F: "summoner-ignite" };
    // the manual settings, kept so the live state only overrides what is "auto"
    const picked = { arrangement: undefined, champion: undefined, summonerD: undefined, summonerF: undefined };

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

    // Icons only in the MOBA arrangement: anywhere else the keys show their letters again.
    // The summoners follow the arrangement alone (a Letters board still shows them), the spells need a champion.
    function applyIcons() {
        const inMoba = picked.arrangement === "moba";
        const spells = inMoba ? qwer() : null;
        for (const [i, k] of ["Q", "W", "E", "R"].entries()) setIcon(k, spells?.[i] ?? null);
        setIcon("D", inMoba ? summonerFile("D") : null);
        setIcon("F", inMoba ? summonerFile("F") : null);
    }

    // QWER: the picked champion when one is picked, else the live one (bundled when Fiora or Akali,
    // Data Dragon addresses otherwise), else the letters.
    function qwer() {
        if (picked.champion !== "auto") {
            const manual = typeof picked.champion === "string" ? CHAMPIONS[picked.champion] : null;
            return manual ? [manual.Q, manual.W, manual.E, manual.R] : null;
        }
        const id = typeof live?.champion === "string" ? live.champion.toLowerCase() : "";
        if (id && CHAMPIONS[id]) {
            const bundled = CHAMPIONS[id];
            return [bundled.Q, bundled.W, bundled.E, bundled.R];
        }
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
        const rows = ARRANGEMENTS[name];

        // the default arrangement (or a page without the setting): everything back where it was
        if (!rows) {
            for (const { key, parent, next, span } of home) {
                parent.insertBefore(key, next);
                key.style.marginLeft = "";
                if (span) key.style.setProperty("--span", span);
                else key.style.removeProperty("--span");
                key.classList.remove("is-hidden");
            }
            return;
        }

        for (const row of [...board.children].filter(el => el.classList?.contains("row"))) row.remove();

        const shown = new Set();
        for (const line of rows) {
            const row = document.createElement("div");
            row.className = "row";
            for (const { k, span, pad } of line) {
                const key = byKey.get(k);
                if (!key) continue;
                shown.add(k);
                key.style.marginLeft = pad ? `calc(var(--pitch) * ${pad})` : "";
                // a span in the map wins, otherwise the key keeps the width of index.html
                if (span) key.style.setProperty("--span", span);
                row.appendChild(key);
            }
            board.insertBefore(row, board.querySelector(".resize"));
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

    // the settings reach the page as data attributes and as an event (see main/values.ts).
    // data-summoner-d arrives as dataset.summonerD (dashes become camel case).
    const settingsOf = root => ({
        arrangement: root.dataset.arrangement,
        champion: root.dataset.champion,
        summonerD: root.dataset.summonerD,
        summonerF: root.dataset.summonerF
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
    Object.assign(picked, settingsOf(document.documentElement));
    applyIcons();
    const initial = document.documentElement.dataset.arrangement;
    if (typeof initial === "string" && initial) applyArrangement(initial);
})();
