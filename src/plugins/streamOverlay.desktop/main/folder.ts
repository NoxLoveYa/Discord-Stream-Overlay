/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { OverlayInfo } from "@plugins/streamOverlay.desktop/types";
import { app, type BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import { existsSync, readdirSync } from "fs";
import { join, resolve, sep } from "path";

import { seedDefaults } from "./defaults";
import { readManifest } from "./manifest";

export const defaultRoot = () => join(app.getPath("userData"), "StreamOverlay", "overlays");

/** An empty root means the default folder, which receives the bundled overlays on first use. */
export function resolveRoot(root: string) {
    if (root) return root;

    const dir = defaultRoot();
    seedDefaults(dir);
    return dir;
}

export function listOverlays(root: string): { root: string; overlays: OverlayInfo[]; } {
    const dir = resolveRoot(root);
    try {
        const overlays = readdirSync(dir, { withFileTypes: true })
            .filter(d => d.isDirectory() && !d.name.startsWith(".") && existsSync(join(dir, d.name, "index.html")))
            .map(d => {
                const { title, description, category, draggable, settings } = readManifest(join(dir, d.name, "index.html"));
                return { name: d.name, title: title || d.name, description, category, draggable, settings };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
        return { root: dir, overlays };
    } catch {
        return { root: dir, overlays: [] };
    }
}

/** The names come from the renderer: only plain subfolders of the root that contain an index.html are accepted. */
export function findOverlays(root: string, names: string[]) {
    const dir = resolve(resolveRoot(root));
    return names
        .map(name => ({ name, file: resolve(dir, name, "index.html") }))
        .filter(({ file }) => file.startsWith(dir + sep) && existsSync(file));
}

export async function pickFolder(parent: BrowserWindow | null, current: string) {
    const options: OpenDialogOptions = {
        title: "Select the folder containing your overlays",
        defaultPath: current || defaultRoot(),
        properties: ["openDirectory", "createDirectory"]
    };
    const { canceled, filePaths } = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);

    return canceled ? null : filePaths[0];
}
