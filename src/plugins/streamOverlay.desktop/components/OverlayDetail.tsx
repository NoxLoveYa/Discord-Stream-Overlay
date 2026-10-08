/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { Switch } from "@components/Switch";
import { copyName, presetsOf, renamePreset, sameSettings, withoutPreset, withPreset } from "@plugins/streamOverlay.desktop/presets";
import { plain, setOverlayEnabled, settings, updateStored, updateValues } from "@plugins/streamOverlay.desktop/settings";
import type { OverlayInfo, OverlayPreset, OverlayValue } from "@plugins/streamOverlay.desktop/types";
import { useState } from "@webpack/common";

import { OverlayOptionList } from "./OverlayOptions";
import { PresetManager } from "./PresetManager";
import { OverlayPresetSummary } from "./PresetSummary";
import { Tabs } from "./Tabs";

const TABS = [
    { id: "settings", label: "Settings" },
    { id: "presets", label: "Presets" }
] as const;
type Tab = (typeof TABS)[number]["id"];

export function OverlayDetail({ overlay, onBack }: { overlay: OverlayInfo; onBack(): void; }) {
    const { enabledOverlays, overlayValues, overlayPresets } = settings.use(["enabledOverlays", "overlayValues", "overlayPresets"]);
    const [tab, setTab] = useState<Tab>("settings");

    const { name } = overlay;
    const enabled = enabledOverlays.includes(name);
    const options = overlay.settings.filter(s => !s.hidden);
    const current: Record<string, OverlayValue> | undefined = plain(overlayValues[name]);
    const presets: OverlayPreset[] = plain(presetsOf(overlayPresets, name));

    const setPresets = (next: OverlayPreset[]) => updateStored("overlayPresets", all => { all[name] = next; });
    const setValues = (values: Record<string, OverlayValue> | undefined) => updateValues(all => {
        if (values) all[name] = values;
        else delete all[name];
    });

    return (
        <section className="vc-so">
            <nav className="vc-so-crumbs" aria-label="Breadcrumb">
                <button className="vc-so-crumb" onClick={onBack}>Overlays</button>
                <span aria-hidden="true">›</span>
                <span aria-current="page">{overlay.title}</span>
            </nav>

            <header className="vc-so-detail-head">
                <div>
                    <Heading tag="h2" className="vc-so-title">{overlay.title}</Heading>
                    {overlay.description && <Paragraph size="sm" defaultColor={false} className="vc-so-muted">{overlay.description}</Paragraph>}
                </div>
                <div className="vc-so-enable" role="group" aria-label={`${overlay.title} on or off`}>
                    <Paragraph size="sm">{enabled ? "On" : "Off"}</Paragraph>
                    <Switch checked={enabled} onChange={on => setOverlayEnabled(name, on)} />
                </div>
            </header>

            <Tabs<Tab> label={`${overlay.title} settings`} tabs={TABS} current={tab} onChange={setTab}>
                {tab === "settings" && (options.length > 0 ? (
                    <div>
                        <div className="vc-so-section-head">
                            <Paragraph size="sm" defaultColor={false} className="vc-so-muted">Changes apply right away.</Paragraph>
                            <Button variant="dangerSecondary" size="small" onClick={() => setValues(undefined)}>
                                Reset to defaults
                            </Button>
                        </div>
                        <OverlayOptionList overlay={name} options={options} />
                    </div>
                ) : (
                    <Paragraph size="sm" defaultColor={false} className="vc-so-muted">This overlay has no settings.</Paragraph>
                ))}

                {tab === "presets" && (
                    <PresetManager
                        hint="A preset keeps all the settings of this overlay, including where you moved it and how big you made it."
                        emptyText="No presets for this overlay yet. Set it up the way you like, then save it here to come back to it later."
                        presets={presets}
                        isActive={preset => sameSettings(overlay.settings, preset.values, current)}
                        summarize={preset => <OverlayPresetSummary overlay={overlay} preset={preset} />}
                        save={to => setPresets(withPreset(presets, { name: to, values: { ...current } }))}
                        rename={(preset, to) => setPresets(renamePreset(presets, preset.name, to))}
                        duplicate={preset => {
                            const copy = copyName(presets, preset.name);
                            setPresets([...presets, { name: copy, values: { ...preset.values } }]);
                            return copy;
                        }}
                        apply={preset => {
                            setValues({ ...preset.values });
                            return () => setValues(current);
                        }}
                        update={preset => {
                            setPresets(withPreset(presets, { name: preset.name, values: { ...current } }));
                            return () => setPresets(presets);
                        }}
                        remove={preset => {
                            setPresets(withoutPreset(presets, preset.name));
                            return () => setPresets(presets);
                        }}
                    />
                )}
            </Tabs>
        </section>
    );
}
