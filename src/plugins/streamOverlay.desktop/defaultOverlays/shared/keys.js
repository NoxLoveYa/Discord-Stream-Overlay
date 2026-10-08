/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Lights up every [data-key] element while that key (or mouse button) is held.
(() => {
    const keys = [...document.querySelectorAll("[data-key]")];

    addEventListener("message", ({ source, data }) => {
        if (source !== parent || data?.type !== "streamoverlay:keys") return;

        const down = new Set(data.down);
        for (const key of keys) key.classList.toggle("is-down", down.has(key.dataset.key));
    });
})();
