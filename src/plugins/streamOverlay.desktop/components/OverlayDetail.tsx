/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { Switch } from "@components/Switch";
import { presetsOf, sameSettings, withoutPreset, withPreset } from "@plugins/streamOverlay.desktop/presets";
import { setOverlayEnabled, settings, updateStored, updateValues } from "@plugins/streamOverlay.desktop/settings";
import type { OverlayInfo, OverlayPreset } from "@plugins/streamOverlay.desktop/types";

import { OverlayOptionList } from "./OverlayOptions";
import { PresetBar } from "./PresetBar";

export function OverlayDetail({ overlay, onBack }: { overlay: OverlayInfo; onBack(): void; }) {
    const { enabledOverlays, overlayValues, overlayPresets } = settings.use(["enabledOverlays", "overlayValues", "overlayPresets"]);

    const enabled = enabledOverlays.includes(overlay.name);
    const options = overlay.settings.filter(s => !s.hidden);
    const current = overlayValues[overlay.name];

    const savePreset = (name: string) => updateStored("overlayPresets", all => {
        all[overlay.name] = withPreset(presetsOf(all, overlay.name), { name, values: { ...current } });
    });
    const deletePreset = (name: string) => updateStored("overlayPresets", all => {
        all[overlay.name] = withoutPreset(presetsOf(all, overlay.name), name);
    });
    const applyPreset = (preset: OverlayPreset) => updateValues(values => {
        values[overlay.name] = { ...preset.values };
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
                    <Switch checked={enabled} onChange={on => setOverlayEnabled(overlay.name, on)} />
                </div>
            </header>

            <div>
                <Heading tag="h3">Presets</Heading>
                <Paragraph size="sm" defaultColor={false} className="vc-so-muted vc-so-hint">
                    A preset keeps all the settings below, including where you moved the overlay and how big you made it.
                </Paragraph>
                <PresetBar
                    presets={presetsOf(overlayPresets, overlay.name)}
                    isActive={preset => sameSettings(overlay.settings, preset.values, current)}
                    onApply={applyPreset}
                    onSave={savePreset}
                    onDelete={deletePreset}
                    emptyText="No presets for this overlay yet."
                />
            </div>

            <div>
                <div className="vc-so-section-head">
                    <Heading tag="h3" className="vc-so-title">Settings</Heading>
                    {options.length > 0 && (
                        <Button variant="dangerSecondary" size="small" onClick={() => updateValues(values => void delete values[overlay.name])}>
                            Reset to defaults
                        </Button>
                    )}
                </div>
                {options.length > 0
                    ? <OverlayOptionList overlay={overlay.name} options={options} />
                    : <Paragraph size="sm" defaultColor={false} className="vc-so-muted">This overlay has no settings.</Paragraph>}
            </div>
        </section>
    );
}
