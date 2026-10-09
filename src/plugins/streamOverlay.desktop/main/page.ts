/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A page that is navigating or already gone rejects the script: there is nothing to do about it, the next call reaches the new page.
export const runInPage = (target: { executeJavaScript(code: string): Promise<unknown>; }, code: string) =>
    target.executeJavaScript(code).catch(() => { });
