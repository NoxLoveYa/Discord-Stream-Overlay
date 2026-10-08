/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { pathToFileURL } from "url";

// Every overlay is an iframe, so each keeps its own CSS, scripts and relative assets.
//
// The main process talks to the overlays through this page:
//   window.__streamOverlayKeys(["Q", "SHIFT"])   forwarded to every overlay as { type: "streamoverlay:keys", down }
//                                                (each overlay also gets the latest state once it loads)
//   window.__streamOverlayTakeSaves()            returns what overlays posted as { type: "streamoverlay:save", values }
//                                                ({ i: iframe index, values }) since the last call
//   window.__streamOverlayPointer(x, y)          the cursor position in window coordinates, forwarded to interactive overlays
//                                                as { type: "streamoverlay:pointer", x, y }
// The window ignores the mouse until the key combo of an interactive overlay (overlay.json "interactive") is held, and
// Electron does not forward mouse moves from a window in that state, so the cursor position is relayed this way: it is
// how overlays know they are being hovered.
// Interactive overlays also get real mouse events (pointer-events) once the window takes the mouse.
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
