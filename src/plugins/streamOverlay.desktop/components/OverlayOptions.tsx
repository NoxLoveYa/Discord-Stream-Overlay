/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Switch } from "@components/Switch";
import { settings, updateValues } from "@plugins/streamOverlay.desktop/settings";
import type { OverlaySetting, OverlayValue } from "@plugins/streamOverlay.desktop/types";
import { Forms, SearchableSelect } from "@webpack/common";
import type { ReactNode } from "react";

import { ColorControl, NumberControl } from "./controls";

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

export function OverlayOptions({ overlay, options }: { overlay: string; options: OverlaySetting[]; }) {
    return (
        <section style={{ marginTop: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Forms.FormTitle tag="h3" style={{ margin: 0 }}>{overlay} settings</Forms.FormTitle>
                <Button variant="secondary" size="small" onClick={() => updateValues(values => void delete values[overlay])}>Reset</Button>
            </div>
            {options.map(setting => <OverlayOption key={setting.id} overlay={overlay} setting={setting} />)}
        </section>
    );
}
