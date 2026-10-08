/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { changedCount, colorsOf } from "@plugins/streamOverlay.desktop/presets";
import type { GlobalPreset, OverlayInfo, OverlayPreset } from "@plugins/streamOverlay.desktop/types";

const MAX_SHOWN = 4;

export function OverlayPresetSummary({ overlay, preset }: { overlay: OverlayInfo; preset: OverlayPreset; }) {
    const colors = colorsOf(overlay.settings, preset.values).slice(0, MAX_SHOWN);
    const changed = changedCount(overlay.settings, preset.values);

    return (
        <>
            {colors.length > 0 && (
                <span className="vc-so-dots" aria-hidden="true">
                    {colors.map((color, i) => <i key={i} style={{ background: color }} />)}
                </span>
            )}
            <span>{changed === 0 ? "Default settings" : changed === 1 ? "1 change" : `${changed} changes`}</span>
        </>
    );
}

export function GlobalPresetSummary({ preset, overlays }: { preset: GlobalPreset; overlays: OverlayInfo[]; }) {
    const on = overlays.filter(o => preset.enabled.includes(o.name));

    return (
        <>
            {on.length > 0 && (
                <span className="vc-so-minis" aria-hidden="true">
                    {on.slice(0, MAX_SHOWN).map(o => <span key={o.name} className="vc-so-mini" title={o.title}>{o.title.charAt(0).toUpperCase()}</span>)}
                    {on.length > MAX_SHOWN && <span className="vc-so-mini">+{on.length - MAX_SHOWN}</span>}
                </span>
            )}
            <span>{on.length === 0 ? "Nothing on" : `${on.length} on`}</span>
        </>
    );
}
