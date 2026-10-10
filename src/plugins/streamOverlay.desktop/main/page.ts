/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

interface PageTarget {
    executeJavaScript(code: string): Promise<unknown>;
}

// A page that is navigating or already gone rejects the script: there is nothing to do about it, the next call reaches the new page.
export const runInPage = (target: PageTarget, code: string) => target.executeJavaScript(code).catch(() => { });

/** Calls `window.__streamOverlay<hook>(...args)` of the host page (main/host.ts) once it is there. */
export const callHook = (target: PageTarget, hook: string, ...args: unknown[]) =>
    runInPage(target, `window.__streamOverlay${hook}?.(${args.map(arg => JSON.stringify(arg)).join(", ")})`);
