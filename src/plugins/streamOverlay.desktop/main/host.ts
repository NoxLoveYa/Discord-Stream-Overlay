/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { pathToFileURL } from "url";

/**
 * The page that holds every overlay as an iframe and bridges them to the main process
 * (the message protocol is described in the README).
 */
export function hostHtml(files: string[], interactive: boolean[] = []) {
    const frames = files
        .map((f, i) => `<iframe src="${pathToFileURL(f).href.replace(/&/g, "&amp;")}"${interactive[i] ? " data-interactive" : ""}></iframe>`)
        .join("");

    return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden;color-scheme:normal}
iframe{position:fixed;inset:0;width:100%;height:100%;border:0;background:transparent;pointer-events:none}
iframe[data-interactive]{pointer-events:auto}
</style>${frames}<script>
let down = [];
let pointer = null;
const saves = [];
const frames = () => [...document.querySelectorAll("iframe")];
const post = f => f.contentWindow.postMessage({ type: "streamoverlay:keys", down }, "*");
const postPointer = f => pointer && f.hasAttribute("data-interactive") && f.contentWindow.postMessage({ type: "streamoverlay:pointer", ...pointer }, "*");
window.__streamOverlayKeys = keys => { down = keys; frames().forEach(post); };
window.__streamOverlayPointer = (x, y) => { pointer = { x, y }; frames().forEach(postPointer); };
window.__streamOverlayTakeSaves = () => saves.splice(0);
frames().forEach(f => f.addEventListener("load", () => { post(f); postPointer(f); }));
addEventListener("message", ({ source, data }) => {
    const i = frames().findIndex(f => f.contentWindow === source);
    if (i >= 0 && data?.type === "streamoverlay:save" && data.values && typeof data.values === "object") saves.push({ i, values: data.values });
});
</script>`;
}
