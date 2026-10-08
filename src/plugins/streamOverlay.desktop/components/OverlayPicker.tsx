/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Native, settings } from "@plugins/streamOverlay.desktop/settings";
import type { OverlayInfo } from "@plugins/streamOverlay.desktop/types";
import { Forms, SearchableSelect, useCallback, useEffect, useState } from "@webpack/common";

import { OverlayOptions } from "./OverlayOptions";

export function OverlayPicker() {
    const { overlayRoot, enabledOverlays } = settings.use(["overlayRoot", "enabledOverlays"]);
    const [info, setInfo] = useState({ root: overlayRoot, overlays: [] as OverlayInfo[] });

    const refresh = useCallback(async () => setInfo(await Native.listOverlays(overlayRoot)), [overlayRoot]);
    useEffect(() => void refresh(), [refresh]);

    async function browse() {
        const picked = await Native.pickFolder(overlayRoot);
        if (picked) settings.store.overlayRoot = picked;
    }

    const names = info.overlays.map(o => o.name);
    const options = names.map(name => ({ label: name, value: name }));
    const enabled = enabledOverlays.filter(name => names.includes(name));

    return (
        <section>
            <Forms.FormTitle>Overlays folder</Forms.FormTitle>
            <Forms.FormText>{info.root}</Forms.FormText>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", margin: "8px 0 16px" }}>
                <Button onClick={browse}>Browse…</Button>
                <Button variant="secondary" onClick={() => Native.openRoot(overlayRoot)}>Open folder</Button>
                <Button variant="secondary" onClick={refresh}>Refresh list</Button>
                <Button variant="secondary" onClick={() => Native.reload()}>Reload overlays</Button>
                {overlayRoot && (
                    <Button variant="dangerSecondary" onClick={() => settings.store.overlayRoot = ""}>Use default folder</Button>
                )}
            </div>

            <Forms.FormTitle>Active overlays</Forms.FormTitle>
            <SearchableSelect
                multi
                placeholder={options.length ? "Select overlays" : "No overlays found"}
                options={options}
                value={enabled}
                onChange={(selected: string[]) => settings.store.enabledOverlays = selected}
                closeOnSelect={false}
                maxVisibleItems={6}
            />
            <Forms.FormText style={{ marginTop: "8px" }}>
                Each subfolder with an index.html is one overlay: keep its background transparent.
                See the README of the plugin to write your own (settings, key states, animations).
            </Forms.FormText>

            {enabled.map(name => {
                const options = (info.overlays.find(o => o.name === name)?.settings ?? []).filter(s => !s.hidden);
                return options.length > 0 && <OverlayOptions key={name} overlay={name} options={options} />;
            })}
        </section>
    );
}
