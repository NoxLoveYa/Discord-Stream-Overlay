/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Paragraph } from "@components/Paragraph";
import { Switch } from "@components/Switch";
import { settings, updateValues } from "@plugins/streamOverlay.desktop/settings";
import type { OverlaySetting, OverlayValue } from "@plugins/streamOverlay.desktop/types";
import { SearchableSelect } from "@webpack/common";
import type { ReactNode } from "react";

import { ColorControl } from "./ColorControl";
import { NumberControl } from "./NumberControl";

function OverlayOption({ overlay, setting }: { overlay: string; setting: OverlaySetting; }) {
    const { overlayValues } = settings.use(["overlayValues"]);
    const value = overlayValues[overlay]?.[setting.id] ?? setting.default;
    const set = (v: OverlayValue) => updateValues(values => {
        (values[overlay] ??= {})[setting.id] = v;
    });

    let control: ReactNode;
    switch (setting.type) {
        case "color":
            control = <ColorControl label={setting.label} value={String(value)} defaultValue={String(setting.default)} onChange={set} />;
            break;
        case "number":
            control = (
                <NumberControl
                    label={setting.label}
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
            control = (
                <div role="group" aria-label={setting.label}>
                    <Switch checked={value === true} onChange={set} />
                </div>
            );
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
        <div className="vc-so-row">
            <Paragraph>{setting.label}</Paragraph>
            {control}
        </div>
    );
}

export function OverlayOptionList({ overlay, options }: { overlay: string; options: OverlaySetting[]; }) {
    return (
        <div className="vc-so-rows">
            {options.map(setting => <OverlayOption key={setting.id} overlay={overlay} setting={setting} />)}
        </div>
    );
}
