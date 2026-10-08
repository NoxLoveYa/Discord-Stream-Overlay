/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./overlays.css";

import { Native, settings } from "@plugins/streamOverlay.desktop/settings";
import type { OverlayInfo } from "@plugins/streamOverlay.desktop/types";
import { useCallback, useEffect, useState } from "@webpack/common";

import { OverlayDetail } from "./OverlayDetail";
import { OverlayGrid } from "./OverlayGrid";

export function OverlayPicker() {
    const { overlayRoot } = settings.use(["overlayRoot"]);
    const [info, setInfo] = useState({ root: overlayRoot, overlays: [] as OverlayInfo[] });
    const [open, setOpen] = useState<string | null>(null);

    const refresh = useCallback(async () => setInfo(await Native.listOverlays(overlayRoot)), [overlayRoot]);
    useEffect(() => void refresh(), [refresh]);

    const overlay = info.overlays.find(o => o.name === open);

    return overlay
        ? <OverlayDetail overlay={overlay} onBack={() => setOpen(null)} />
        : <OverlayGrid info={info} refresh={refresh} onOpen={setOpen} />;
}
