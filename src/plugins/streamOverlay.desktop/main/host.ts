/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { pathToFileURL } from "url";

interface HostOverlay {
    file: string;
    keys: string[];
    interactive: boolean;
    mouse: boolean;
    channels: string[];
}

// The page that holds every overlay as an iframe and bridges them to the main process (protocol: see the README).
export function hostHtml(overlays: HostOverlay[]) {
    const frames = overlays
        .map(o => {
            const attrs = [
                `src="${pathToFileURL(o.file).href.replace(/&/g, "&amp;")}"`,
                `data-keys="${o.keys.join(",")}"`,
                o.interactive && "data-interactive",
                o.mouse && "data-mouse",
                `data-channels="${o.channels.join(",")}"`
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
const states = new Map();
const frames = () => [...document.querySelectorAll("iframe")];
const post = f => f.contentWindow.postMessage({ type: "streamoverlay:keys", down: down.filter(k => f.dataset.keys.split(",").includes(k)) }, "*");
const postPointer = f => pointer && f.hasAttribute("data-interactive") && f.contentWindow.postMessage({ type: "streamoverlay:pointer", ...pointer }, "*");
const postChannel = (f, name) => states.has(name) && f.dataset.channels.split(",").includes(name) && f.contentWindow.postMessage({ type: "streamoverlay:" + name, state: states.get(name) }, "*");
window.__streamOverlayChannel = (name, state) => { states.set(name, state); frames().forEach(f => postChannel(f, name)); };
window.__streamOverlayKeys = keys => { down = keys; frames().forEach(post); };
window.__streamOverlayPointer = (x, y) => { pointer = { x, y }; frames().forEach(postPointer); };
window.__streamOverlayMouse = (dx, dy, wheel) => frames().forEach(f => f.hasAttribute("data-mouse") && f.contentWindow.postMessage({ type: "streamoverlay:mouse", dx, dy, wheel }, "*"));
window.__streamOverlayTakeSaves = () => saves.splice(0);
frames().forEach(f => f.addEventListener("load", () => { post(f); postPointer(f); states.forEach((_, name) => postChannel(f, name)); }));
addEventListener("message", ({ source, data }) => {
    const i = frames().findIndex(f => f.contentWindow === source);
    if (i < 0 || !data) return;
    if (data.type === "streamoverlay:save" && data.values && typeof data.values === "object") saves.push({ i, values: data.values });
    else if (data.type === "streamoverlay:capture" && frames()[i].hasAttribute("data-interactive")) frames()[i].style.pointerEvents = data.on === true ? "auto" : "none";
});
</script>`;
}
