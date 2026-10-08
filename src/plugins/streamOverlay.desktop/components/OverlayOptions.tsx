/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Paragraph } from "@components/Paragraph";
import { Switch } from "@components/Switch";
import { effectiveFontValue, fontFollows } from "@plugins/streamOverlay.desktop/main/values";
import { settings, updateValues } from "@plugins/streamOverlay.desktop/settings";
import type { OverlaySetting, OverlayValue } from "@plugins/streamOverlay.desktop/types";
import { SearchableSelect } from "@webpack/common";
import type { ReactNode } from "react";

import { ColorControl } from "./ColorControl";
import { FontControl } from "./FontControl";
import { NumberControl } from "./NumberControl";

function OverlayOption({ overlay, setting, all }: { overlay: string; setting: OverlaySetting; all: OverlaySetting[]; }) {
    const { overlayValues, globalFont } = settings.use(["overlayValues", "globalFont"]);
    const storedAll = overlayValues[overlay] ?? {};
    const stored = storedAll[setting.id];
    // a font shows what it draws with (stored, global or theme default), so a gothic preset shows its blackletter
    const value = setting.type === "font"
        ? effectiveFontValue(setting, all, storedAll, globalFont)
        : stored ?? setting.default;
    const set = (v: OverlayValue) => updateValues(values => {
        (values[overlay] ??= {})[setting.id] = v;
    });
    const clear = () => updateValues(values => {
        delete values[overlay]?.[setting.id];
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
            const options = setting.options ?? [];
            control = (
                <div className="vc-so-option-select">
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
        case "font":
            control = (
                <FontControl
                    label={setting.label}
                    value={String(value)}
                    stored={typeof stored === "string" ? stored : undefined}
                    builtin={setting.options ?? []}
                    follows={stored === undefined ? fontFollows(all, storedAll, globalFont) : null}
                    onChange={set}
                    onClear={clear}
                />
            );
            break;
    }

    // the font picker manages its own customs: label on top, picker below
    if (setting.type === "font") {
        return (
            <div className="vc-so-row vc-so-row-stack">
                <Paragraph>{setting.label}</Paragraph>
                <Paragraph size="sm" defaultColor={false} className="vc-so-muted">
                    Saved per preset: bind a game to a global preset on the Apps tab to give it its own font.
                </Paragraph>
                {control}
            </div>
        );
    }

    return (
        <div className="vc-so-row">
            <Paragraph>{setting.label}</Paragraph>
            {control}
        </div>
    );
}

export function OverlayOptionList({ overlay, options, all }: { overlay: string; options: OverlaySetting[]; all: OverlaySetting[]; }) {
    return (
        <div>
            {options.map(setting => <OverlayOption key={setting.id} overlay={overlay} setting={setting} all={all} />)}
        </div>
    );
}
