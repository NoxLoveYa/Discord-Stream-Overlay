/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { OptionType, PluginNative } from "@utils/types";
import { Forms, SearchableSelect, useCallback, useEffect, useState } from "@webpack/common";

export const Native = VencordNative.pluginHelpers.StreamOverlay as PluginNative<typeof import("./native")>;

export const settings = definePluginSettings({
    overlayRoot: {
        type: OptionType.CUSTOM,
        default: ""
    },
    enabledOverlays: {
        type: OptionType.CUSTOM,
        default: ["red-border"] as string[]
    },
    overlayPicker: {
        type: OptionType.COMPONENT,
        component: OverlayPicker
    },
    alwaysShow: {
        type: OptionType.BOOLEAN,
        description: "Show the overlays even when not screensharing (for testing)",
        default: false
    }
});

function OverlayPicker() {
    const { overlayRoot, enabledOverlays } = settings.use(["overlayRoot", "enabledOverlays"]);
    const [info, setInfo] = useState({ root: overlayRoot, overlays: [] as string[] });

    const refresh = useCallback(async () => setInfo(await Native.listOverlays(overlayRoot)), [overlayRoot]);
    useEffect(() => void refresh(), [refresh]);

    async function browse() {
        const picked = await Native.pickFolder(overlayRoot);
        if (picked) settings.store.overlayRoot = picked;
    }

    const options = info.overlays.map(name => ({ label: name, value: name }));

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
                value={enabledOverlays.filter(name => info.overlays.includes(name))}
                onChange={(names: string[]) => settings.store.enabledOverlays = names}
                closeOnSelect={false}
                maxVisibleItems={6}
            />
            <Forms.FormText style={{ marginTop: "8px" }}>
                Each subfolder with an index.html is one overlay. Keep its background transparent.
                Finite CSS animations (use animation-fill-mode: both) play when the overlay appears and in reverse when the share stops.
            </Forms.FormText>
        </section>
    );
}
