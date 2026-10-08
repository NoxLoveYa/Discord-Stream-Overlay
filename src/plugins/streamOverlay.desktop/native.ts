/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, BrowserWindow, desktopCapturer, dialog, type Display, type IpcMainInvokeEvent, type OpenDialogOptions, screen, shell } from "electron";
import keyboardHtml from "file://defaultOverlays/keyboard/index.html";
import keyboardManifest from "file://defaultOverlays/keyboard/overlay.json";
import keyboardCss from "file://defaultOverlays/keyboard/style.css";
import redBorderHtml from "file://defaultOverlays/red-border/index.html";
import redBorderManifest from "file://defaultOverlays/red-border/overlay.json";
import redBorderCss from "file://defaultOverlays/red-border/style.css";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve, sep } from "path";
import { pathToFileURL } from "url";

import { hostHtml } from "./host";
import { type KeyPoll, startKeyPoll } from "./keys";
import { type Manifest, type OverlayValue, readManifest, resolveValue, settingsScript, unionKeys } from "./manifest";

let overlay: BrowserWindow | null = null;
let loadedKey = "";
// what is on screen (in iframe order), to (re)apply the overlay settings to the right frames
let current: { name: string; file: string; manifest: Manifest; values: Record<string, OverlayValue>; }[] = [];
// whether the window currently takes the mouse (see setMouseCaptured)
let mouseCaptured = false;
// relays the cursor position to interactive overlays while one is visible (see syncPointerPoll)
let pointerTimer: ReturnType<typeof setInterval> | null = null;
let lastPointer = "";
// the display is only looked up again when the shared source changes
let displayCache: { key: string; display: Display; match: string; } | null = null;
// reads the state of the keys the visible overlays asked for in their overlay.json; null when none did
let keyPoll: KeyPoll | null = null;
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
    "red-border": { "index.html": redBorderHtml, "style.css": redBorderCss, "overlay.json": redBorderManifest },
    "keyboard": { "index.html": keyboardHtml, "style.css": keyboardCss, "overlay.json": keyboardManifest }
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
    // clicks pass through (hovering is relayed by sendPointer, Electron's "forward" option delivers nothing here)
    win.setIgnoreMouseEvents(true);
    mouseCaptured = false;
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", e => e.preventDefault());
    win.on("closed", () => {
        overlay = null;
        loadedKey = "";
        exiting = false;
        stopKeyPoll();
        syncPointerPoll(false);
    });
    return win;
}

// While an interactive overlay's key combo is held the window takes the mouse (to drag things around); otherwise
// clicks pass through to whatever is below.
function setMouseCaptured(capture: boolean) {
    if (capture === mouseCaptured) return;
    mouseCaptured = capture;
    if (overlay && !overlay.isDestroyed()) overlay.setIgnoreMouseEvents(!capture);
}

// Electron does not forward mouse moves from a window that ignores the mouse (checked on 42), so interactive overlays
// learn where the cursor is from here: that is what lets them react to being hovered while clicks pass through.
function sendPointer() {
    if (!overlay || overlay.isDestroyed() || !overlay.isVisible()) return;

    const cursor = screen.getCursorScreenPoint();
    const bounds = overlay.getBounds();
    const x = cursor.x - bounds.x;
    const y = cursor.y - bounds.y;

    const key = `${x},${y}`;
    if (key === lastPointer) return;
    lastPointer = key;
    overlay.webContents.executeJavaScript(`window.__streamOverlayPointer?.(${x}, ${y})`).catch(() => { });
}

function syncPointerPoll(on: boolean) {
    if (on && !pointerTimer) {
        pointerTimer = setInterval(sendPointer, 50);
    } else if (!on && pointerTimer) {
        clearInterval(pointerTimer);
        pointerTimer = null;
    }
    if (!on) lastPointer = "";
}

function sendKeys(down: string[]) {
    setMouseCaptured(current.some(({ manifest: { interactive } }) => interactive.length > 0 && interactive.every(k => down.includes(k))));

    if (!overlay || overlay.isDestroyed()) return;
    overlay.webContents.executeJavaScript(`window.__streamOverlayKeys?.(${JSON.stringify(down)})`).catch(() => { });
}

function stopKeyPoll() {
    keyPoll?.stop();
    keyPoll = null;
    // without key state nothing can say the combo is still held, so never leave the screen blocked
    setMouseCaptured(false);
}

// Restarts the poller only when the set of requested keys changed.
function syncKeyPoll(names: string[]) {
    if (keyPoll && keyPoll.names.join() === names.join()) return;
    stopKeyPoll();
    keyPoll = startKeyPoll(names, sendKeys);
}

// executeJavaScript works per frame regardless of origin, which the overlay iframes (file:// URLs) would otherwise block
function runInFrames(win: BrowserWindow, script: string) {
    return Promise.all(win.webContents.mainFrame.framesInSubtree.map(f => f.executeJavaScript(script).catch(() => { })));
}

// Sets the overlays' settings (CSS variables, data attributes, event) inside their own frames.
function applySettings() {
    if (!overlay || overlay.isDestroyed()) return Promise.resolve([]);

    const frames = overlay.webContents.mainFrame.framesInSubtree;
    return Promise.all(current.map(({ file, manifest, values }) => {
        const url = pathToFileURL(file).href.toLowerCase();
        const frame = frames.find(f => f.url.toLowerCase() === url);
        if (!frame || !manifest.settings.length) return;
        return frame.executeJavaScript(settingsScript(manifest.settings, values)).catch(() => { });
    }));
}

function destroyOverlay() {
    stopKeyPoll();
    syncPointerPoll(false);
    if (overlay && !overlay.isDestroyed()) overlay.destroy();
    overlay = null;
    loadedKey = "";
    exiting = false;
    current = [];
    displayCache = null;
}

export function listOverlays(_, root: string) {
    const dir = resolveRoot(root);
    try {
        const overlays = readdirSync(dir, { withFileTypes: true })
            .filter(d => d.isDirectory() && existsSync(join(dir, d.name, "index.html")))
            .map(d => ({ name: d.name, settings: readManifest(join(dir, d.name, "index.html")).settings }))
            .sort((a, b) => a.name.localeCompare(b.name));
        return { root: dir, overlays };
    } catch {
        return { root: dir, overlays: [] as { name: string; settings: Manifest["settings"]; }[] };
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

export async function show(
    _,
    sourceId: string | null,
    sourceName: string | null,
    root: string,
    names: string[],
    settingValues: Record<string, Record<string, OverlayValue>>
) {
    hideToken++;
    const dir = resolve(resolveRoot(root));

    // names come from the renderer: only accept plain subfolders that really contain an index.html
    const overlays = names
        .map(name => ({ name, file: resolve(dir, name, "index.html") }))
        .filter(({ file }) => file.startsWith(dir + sep) && existsSync(file));

    if (!overlays.length) {
        destroyOverlay();
        return null;
    }

    const files = overlays.map(o => o.file);
    const manifests = files.map(readManifest);
    current = overlays.map(({ name, file }, i) => ({ name, file, manifest: manifests[i], values: settingValues?.[name] ?? {} }));

    const displayKey = `${sourceId}|${sourceName}`;
    if (displayCache?.key !== displayKey) displayCache = { key: displayKey, ...await pickDisplay(sourceId, sourceName) };
    const { display, match } = displayCache;

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
        writeFileSync(hostPath(), hostHtml(files, manifests.map(m => m.interactive.length > 0)));
        await overlay.loadURL(pathToFileURL(hostPath()).href);
        loadedKey = key;
    }
    // before the window becomes visible, so the first frame already has the right colors
    await applySettings();
    overlay.showInactive();
    // animations may already have run while the window was still hidden: replay the intro from the start
    if (fresh) await runInFrames(overlay, ENTER_SCRIPT);

    // only the keys the visible overlays declared are read, and only while they are visible
    const keys = unionKeys(manifests);
    syncKeyPoll(keys);
    // a freshly loaded page has not been told where the cursor is yet
    if (fresh) lastPointer = "";
    syncPointerPoll(manifests.some(m => m.interactive.length > 0));

    return { match, displayId: display.id, bounds: display.bounds, overlays: files.length, keys: keys.length };
}

// Re-reads overlay files from disk, for editing overlays while the overlay is visible.
export function reload() {
    loadedKey = "";
    lastPointer = "";
    overlay?.webContents.once("did-finish-load", () => void applySettings());
    overlay?.webContents.reloadIgnoringCache();

    // the reloaded page has lost the key state: restarting the poller makes it send the current one again
    const names = keyPoll?.names;
    stopKeyPoll();
    if (names) keyPoll = startKeyPoll(names, sendKeys);
}

// Values the overlays asked to save since the last call (e.g. a position that was dragged), validated against
// what each overlay declared: { overlayName: { settingId: value } }
export async function takeChanges() {
    const changes: Record<string, Record<string, OverlayValue>> = {};
    if (!overlay || overlay.isDestroyed()) return changes;

    const saves: { i: number; values: Record<string, unknown>; }[] =
        await overlay.webContents.executeJavaScript("window.__streamOverlayTakeSaves?.() ?? []").catch(() => []);

    for (const { i, values } of saves) {
        const entry = current[i];
        if (!entry || !values || typeof values !== "object") continue;

        for (const setting of entry.manifest.settings) {
            if (!Object.prototype.hasOwnProperty.call(values, setting.id)) continue;
            (changes[entry.name] ??= {})[setting.id] = resolveValue(setting, values[setting.id]);
        }
    }
    return changes;
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
