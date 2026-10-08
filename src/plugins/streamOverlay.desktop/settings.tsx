/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Switch } from "@components/Switch";
import { OptionType, PluginNative } from "@utils/types";
import { Forms, SearchableSelect, useCallback, useEffect, useState } from "@webpack/common";
import type { ReactNode } from "react";

import { ColorControl, NumberControl } from "./controls";
import type { OverlaySetting, OverlayValue } from "./manifest";

export const Native = VencordNative.pluginHelpers.StreamOverlay as PluginNative<typeof import("./native")>;

export const settings = definePluginSettings({
    overlayRoot: {
        type: OptionType.CUSTOM,
        default: ""
    },
    enabledOverlays: {
        type: OptionType.CUSTOM,
        default: ["red-border", "keyboard"] as string[]
    },
    // { overlayName: { settingId: value } }: the values of the settings declared in each overlay's overlay.json
    overlayValues: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, Record<string, OverlayValue>>
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

// settings.store hands out proxies: edit a plain copy and assign it back
export function updateValues(edit: (values: Record<string, Record<string, OverlayValue>>) => void) {
    const values = JSON.parse(JSON.stringify(settings.store.overlayValues));
    edit(values);
    settings.store.overlayValues = values;
}

function OverlayOption({ overlay, setting }: { overlay: string; setting: OverlaySetting; }) {
    const { overlayValues } = settings.use(["overlayValues"]);
    const value = overlayValues[overlay]?.[setting.id] ?? setting.default;
    const set = (v: OverlayValue) => updateValues(values => {
        (values[overlay] ??= {})[setting.id] = v;
    });

    let control: ReactNode;
    switch (setting.type) {
        case "color":
            control = <ColorControl value={String(value)} onChange={set} />;
            break;
        case "number":
            control = (
                <NumberControl
                    value={Number(value)}
                    min={setting.min ?? 0}
                    max={setting.max ?? 100}
                    step={setting.step ?? 1}
                    unit={setting.unit ?? ""}
                    onChange={set}
                />
            );
            break;
        case "boolean":
            control = <Switch checked={value === true} onChange={set} />;
            break;
        case "select": {
            const options = (setting.options ?? []).map(o => ({ label: o.label, value: o.value }));
            control = (
                <div style={{ width: "220px" }}>
                    <SearchableSelect
                        options={options}
                        value={options.find(o => o.value === value)?.value}
                        onChange={(v: string) => set(v)}
                        closeOnSelect
                        maxVisibleItems={6}
                    />
                </div>
            );
            break;
        }
    }

    return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", padding: "6px 0" }}>
            <Forms.FormText>{setting.label}</Forms.FormText>
            {control}
        </div>
    );
}

function OverlaySettingsSection({ overlay, options }: { overlay: string; options: OverlaySetting[]; }) {
    return (
        <section style={{ marginTop: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Forms.FormTitle tag="h3" style={{ margin: 0 }}>{overlay} settings</Forms.FormTitle>
                <Button variant="secondary" size="small" onClick={() => updateValues(values => void delete values[overlay])}>Reset</Button>
            </div>
            <div>
                {options.map(setting => <OverlayOption key={setting.id} overlay={overlay} setting={setting} />)}
            </div>
        </section>
    );
}

function OverlayPicker() {
    const { overlayRoot, enabledOverlays } = settings.use(["overlayRoot", "enabledOverlays"]);
    const [info, setInfo] = useState({ root: overlayRoot, overlays: [] as { name: string; settings: OverlaySetting[]; }[] });

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
                Each subfolder with an index.html is one overlay. Keep its background transparent.
                Finite CSS animations (use animation-fill-mode: both) play when the overlay appears and in reverse when the share stops.
                An overlay can read key states by listing them in the "keys" array of an overlay.json (for example W, SHIFT); only those keys are read, and only while it is visible.
                Its "settings" array adds the controls below while the overlay is active (types: color, number, boolean, select);
                the values reach the page as CSS variables (--id, plus --id-rgb for colors), data-id attributes and a "streamoverlay:settings" event.
            </Forms.FormText>

            {enabled.map(name => {
                const options = (info.overlays.find(o => o.name === name)?.settings ?? []).filter(s => !s.hidden);
                return options.length > 0 && <OverlaySettingsSection key={name} overlay={name} options={options} />;
            })}
        </section>
    );
}
