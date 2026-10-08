/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The track that is playing, from the "streamoverlay:media" messages ({ state }: the track, or null when nothing plays).
(() => {
    const STEP = 500; // ms between two steps of the progress bar

    const board = document.querySelector(".board");
    const cover = board.querySelector(".cover img");
    const title = board.querySelector(".title");
    const artist = board.querySelector(".artist");
    const fill = board.querySelector(".fill");
    const now = board.querySelector(".now");
    const total = board.querySelector(".total");

    let media = null;
    let timer = 0;

    const time = ms => {
        const s = Math.max(0, Math.floor(ms / 1000));
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    };

    // `position` was true when the message arrived: it goes on from there while the track plays
    function position() {
        if (!media) return 0;
        return Math.min(media.duration, media.position + (media.playing ? Date.now() - media.at : 0));
    }

    function step() {
        const p = position();
        fill.style.setProperty("--p", media && media.duration ? p / media.duration : 0);
        now.textContent = time(p);
    }

    function show(next) {
        const changed = (next?.id ?? "") !== (media?.id ?? "");
        media = next;

        board.dataset.state = !media ? "idle" : media.playing ? "playing" : "paused";
        // textContent only: the names come from Spotify
        title.textContent = media ? media.title : "Nothing playing";
        artist.textContent = media ? media.artists.join(", ") || media.album : "Start a song in Spotify";
        total.textContent = time(media ? media.duration : 0);

        const src = media?.cover ?? "";
        if (src) {
            if (cover.getAttribute("src") !== src) cover.src = src;
        } else {
            cover.removeAttribute("src");
        }

        if (changed) fill.classList.add("jump");
        step();
        if (changed) {
            void fill.offsetWidth;
            fill.classList.remove("jump");
        }

        clearInterval(timer);
        if (media?.playing) timer = setInterval(step, STEP);
    }

    // a cover that cannot be loaded leaves the note
    cover.addEventListener("error", () => cover.removeAttribute("src"));

    addEventListener("message", ({ source, data }) => {
        if (source === parent && data?.type === "streamoverlay:media") show(data.state ?? null);
    });
})();
