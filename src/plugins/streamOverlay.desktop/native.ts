/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, BrowserWindow, desktopCapturer, dialog, type IpcMainInvokeEvent, type OpenDialogOptions, screen, shell } from "electron";
import redBorderHtml from "file://defaultOverlays/red-border/index.html";
import redBorderCss from "file://defaultOverlays/red-border/style.css";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve, sep } from "path";
import { pathToFileURL } from "url";

let overlay: BrowserWindow | null = null;
let loadedKey = "";
// bumped by show()/hide() so an exit animation that is still playing can tell it was superseded
let hideToken = 0;
// the overlay content has been played backwards and has to be reloaded before it is shown again
let exiting = false;

const EXIT_TIMEOUT_MS = 5000;

// Only finite animations can be played in / out: infinite ones (spinners...) never end, so they are left running.
const FINITE_ANIMATIONS = "document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime))";
const ENTER_SCRIPT = `${FINITE_ANIMATIONS}.forEach(a => { a.cancel(); a.play(); })`;
const EXIT_SCRIPT = `(() => {
    const anims = ${FINITE_ANIMATIONS};
    anims.forEach(a => a.reverse());
    return Promise.all(anims.map(a => a.finished.catch(() => {})));
})()`;

const defaultRoot = () => join(app.getPath("userData"), "StreamOverlay", "overlays");
const hostPath = () => join(app.getPath("temp"), "vencord-streamoverlay-host.html");

// Overlays shipped with the plugin. To add one: put its folder in ./defaultOverlays, import its files above and list it here.
const defaultOverlays: Record<string, Record<string, string>> = {
    "red-border": { "index.html": redBorderHtml, "style.css": redBorderCss }
};

// An empty root means "use the default folder". Each bundled overlay is copied in once: a marker file
// records which were handled, so new defaults show up in later versions while deleted or edited ones are left alone.
function resolveRoot(root: string) {
    if (root) return root;

    const dir = defaultRoot();
    const marker = join(dir, ".seeded");
    mkdirSync(dir, { recursive: true });

    const seeded = existsSync(marker) ? readFileSync(marker, "utf-8").split("\n") : [];
    const pending = Object.keys(defaultOverlays).filter(name => !seeded.includes(name));
    if (!pending.length) return dir;

    for (const name of pending) {
        const target = join(dir, name);
        if (existsSync(target)) continue;
        mkdirSync(target);
        for (const [file, content] of Object.entries(defaultOverlays[name]))
            writeFileSync(join(target, file), content);
    }
    writeFileSync(marker, [...seeded, ...pending].filter(Boolean).join("\n"));
    return dir;
}

// Every overlay is an iframe, so each keeps its own CSS, scripts and relative assets.
function hostHtml(files: string[]) {
    const frames = files
        .map(f => `<iframe src="${pathToFileURL(f).href.replace(/&/g, "&amp;")}"></iframe>`)
        .join("");

    return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden;color-scheme:normal}
iframe{position:fixed;inset:0;width:100%;height:100%;border:0;background:transparent;pointer-events:none}
</style>${frames}`;
}

// Discord ids look like "screen-handle:1339034295"; the name comes from STREAM_START ("Screen 1")
async function pickDisplay(sourceId: string | null, sourceName: string | null) {
    const displays = screen.getAllDisplays();
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });

    const num = sourceId?.match(/(\d+)$/)?.[1];
    const byId = displays.find(d => String(d.id) === num);
    if (byId) return { display: byId, match: "display-id" };

    const displayId = sources.find(s => s.id === sourceId || s.name === sourceName)?.display_id;
    const byCapturer = displays.find(d => String(d.id) === displayId);
    if (byCapturer) return { display: byCapturer, match: "desktopCapturer" };

    return { display: screen.getPrimaryDisplay(), match: "primary-fallback" };
}

function createOverlay() {
    const win = new BrowserWindow({
        show: false,
        transparent: true,
        frame: false,
        hasShadow: false,
        resizable: false,
        movable: false,
        focusable: false,
        skipTaskbar: true,
        fullscreenable: false,
        alwaysOnTop: true,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.setIgnoreMouseEvents(true);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", e => e.preventDefault());
    win.on("closed", () => {
        overlay = null;
        loadedKey = "";
        exiting = false;
    });
    return win;
}

// executeJavaScript works per frame regardless of origin, which the overlay iframes (file:// URLs) would otherwise block
function runInFrames(win: BrowserWindow, script: string) {
    return Promise.all(win.webContents.mainFrame.framesInSubtree.map(f => f.executeJavaScript(script).catch(() => { })));
}

function destroyOverlay() {
    if (overlay && !overlay.isDestroyed()) overlay.destroy();
    overlay = null;
    loadedKey = "";
    exiting = false;
}

export function listOverlays(_, root: string) {
    const dir = resolveRoot(root);
    try {
        const overlays = readdirSync(dir, { withFileTypes: true })
            .filter(d => d.isDirectory() && existsSync(join(dir, d.name, "index.html")))
            .map(d => d.name)
            .sort();
        return { root: dir, overlays };
    } catch {
        return { root: dir, overlays: [] as string[] };
    }
}

export async function pickFolder(event: IpcMainInvokeEvent, current: string) {
    const options: OpenDialogOptions = {
        title: "Select the folder containing your overlays",
        defaultPath: current || defaultRoot(),
        properties: ["openDirectory", "createDirectory"]
    };
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);

    return canceled ? null : filePaths[0];
}

export function openRoot(_, root: string) {
    return shell.openPath(resolveRoot(root));
}

export async function show(_, sourceId: string | null, sourceName: string | null, root: string, names: string[]) {
    hideToken++;
    const dir = resolve(resolveRoot(root));

    // names come from the renderer: only accept plain subfolders that really contain an index.html
    const files = names
        .map(name => resolve(dir, name, "index.html"))
        .filter(file => file.startsWith(dir + sep) && existsSync(file));

    if (!files.length) {
        destroyOverlay();
        return null;
    }

    const { display, match } = await pickDisplay(sourceId, sourceName);

    if (!overlay || overlay.isDestroyed()) overlay = createOverlay();
    overlay.setBounds(display.bounds);

    // an interrupted exit animation left the content reversed
    if (exiting) {
        exiting = false;
        loadedKey = "";
    }

    const key = JSON.stringify(files);
    const fresh = key !== loadedKey;
    if (fresh) {
        writeFileSync(hostPath(), hostHtml(files));
        await overlay.loadURL(pathToFileURL(hostPath()).href);
        loadedKey = key;
    }
    overlay.showInactive();
    // animations may already have run while the window was still hidden: replay the intro from the start
    if (fresh) await runInFrames(overlay, ENTER_SCRIPT);

    return { match, displayId: display.id, bounds: display.bounds, overlays: files.length };
}

// Re-reads overlay files from disk, for editing overlays while the overlay is visible.
export function reload() {
    loadedKey = "";
    overlay?.webContents.reloadIgnoringCache();
}

// Plays the finite animations backwards (when asked to) before closing the window.
export async function hide(_, animate = true) {
    const token = ++hideToken;

    if (animate && overlay && !overlay.isDestroyed() && overlay.isVisible()) {
        exiting = true;
        await Promise.race([
            runInFrames(overlay, EXIT_SCRIPT),
            new Promise(r => setTimeout(r, EXIT_TIMEOUT_MS))
        ]);
        if (token !== hideToken) return; // show() ran during the animation
    }

    destroyOverlay();
}
