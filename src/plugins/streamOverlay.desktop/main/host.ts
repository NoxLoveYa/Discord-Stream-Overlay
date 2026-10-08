/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { pathToFileURL } from "url";

export interface HostOverlay {
    file: string;
    keys: string[];
    interactive: boolean;
    mouse: boolean;
}

/**
 * The page that holds every overlay as an iframe and bridges them to the main process
 * (the message protocol is described in the README). An overlay only ever receives what it asked for.
 */
export function hostHtml(overlays: HostOverlay[]) {
    const frames = overlays
        .map(o => {
            const attrs = [
                `src="${pathToFileURL(o.file).href.replace(/&/g, "&amp;")}"`,
                `data-keys="${o.keys.join(",")}"`,
                o.interactive && "data-interactive",
                o.mouse && "data-mouse"
            ];
            return `<iframe ${attrs.filter(Boolean).join(" ")}></iframe>`;
        })
        .join("");

    return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden;color-scheme:normal}
iframe{position:fixed;inset:0;width:100%;height:100%;border:0;background:transparent;pointer-events:none}
</style>${frames}<script>
let down = [];
let pointer = null;
const saves = [];
const frames = () => [...document.querySelectorAll("iframe")];
const post = f => f.contentWindow.postMessage({ type: "streamoverlay:keys", down: down.filter(k => f.dataset.keys.split(",").includes(k)) }, "*");
const postPointer = f => pointer && f.hasAttribute("data-interactive") && f.contentWindow.postMessage({ type: "streamoverlay:pointer", ...pointer }, "*");
window.__streamOverlayKeys = keys => { down = keys; frames().forEach(post); };
window.__streamOverlayPointer = (x, y) => { pointer = { x, y }; frames().forEach(postPointer); };
window.__streamOverlayMouse = (dx, dy, wheel) => frames().forEach(f => f.hasAttribute("data-mouse") && f.contentWindow.postMessage({ type: "streamoverlay:mouse", dx, dy, wheel }, "*"));
window.__streamOverlayTakeSaves = () => saves.splice(0);
frames().forEach(f => f.addEventListener("load", () => { post(f); postPointer(f); }));
addEventListener("message", ({ source, data }) => {
    const i = frames().findIndex(f => f.contentWindow === source);
    if (i < 0 || !data) return;
    if (data.type === "streamoverlay:save" && data.values && typeof data.values === "object") saves.push({ i, values: data.values });
    else if (data.type === "streamoverlay:capture" && frames()[i].hasAttribute("data-interactive")) frames()[i].style.pointerEvents = data.on === true ? "auto" : "none";
});
</script>`;
}
