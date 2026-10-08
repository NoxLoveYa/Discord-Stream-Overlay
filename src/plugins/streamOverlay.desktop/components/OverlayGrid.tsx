/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { ExpandableSection } from "@components/ExpandableCard";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { captureGlobal, isGlobalActive, withoutPreset, withPreset } from "@plugins/streamOverlay.desktop/presets";
import { applyGlobalPreset, Native, setOverlayEnabled, settings, updateStored } from "@plugins/streamOverlay.desktop/settings";
import type { OverlayInfo } from "@plugins/streamOverlay.desktop/types";

import { OverlayCard } from "./OverlayCard";
import { PresetBar } from "./PresetBar";

interface OverlayGridProps {
    info: { root: string; overlays: OverlayInfo[]; };
    refresh(): void;
    onOpen(name: string): void;
}

export function OverlayGrid({ info, refresh, onOpen }: OverlayGridProps) {
    const { overlayRoot, enabledOverlays, overlayValues, globalPresets } = settings.use(["overlayRoot", "enabledOverlays", "overlayValues", "globalPresets"]);
    const { overlays } = info;

    async function browse() {
        const picked = await Native.pickFolder(overlayRoot);
        if (picked) settings.store.overlayRoot = picked;
    }

    return (
        <section className="vc-so">
            <div>
                <Heading tag="h3">Presets</Heading>
                <Paragraph size="sm" defaultColor={false} className="vc-so-muted vc-so-hint">
                    A preset keeps which overlays are on and how every overlay is set up. Each overlay also has presets of its own.
                </Paragraph>
                <PresetBar
                    presets={globalPresets}
                    isActive={preset => isGlobalActive(preset, overlays, enabledOverlays, overlayValues)}
                    onApply={applyGlobalPreset}
                    onSave={name => updateStored("globalPresets", all => withPreset(all, captureGlobal(name, overlays, enabledOverlays, overlayValues)))}
                    onDelete={name => updateStored("globalPresets", all => withoutPreset(all, name))}
                    emptyText="No presets yet."
                />
            </div>

            <div>
                <Heading tag="h3">Overlays</Heading>
                <Paragraph size="sm" defaultColor={false} className="vc-so-muted vc-so-hint">
                    Turn an overlay on or off with its switch, or open it to change its settings.
                </Paragraph>
                {overlays.length > 0 ? (
                    <div className="vc-so-grid">
                        {overlays.map(overlay => (
                            <OverlayCard
                                key={overlay.name}
                                overlay={overlay}
                                enabled={enabledOverlays.includes(overlay.name)}
                                onToggle={on => setOverlayEnabled(overlay.name, on)}
                                onOpen={() => onOpen(overlay.name)}
                            />
                        ))}
                    </div>
                ) : (
                    <Card>
                        <Paragraph>No overlays found in this folder. Each subfolder with an index.html is one overlay.</Paragraph>
                    </Card>
                )}
            </div>

            <ExpandableSection
                renderContent={() => (
                    <>
                        <Paragraph size="sm" defaultColor={false} className="vc-so-muted vc-so-path">{info.root}</Paragraph>
                        <div className="vc-so-buttons">
                            <Button size="small" onClick={browse}>Browse…</Button>
                            <Button size="small" variant="secondary" onClick={() => Native.openRoot(overlayRoot)}>Open folder</Button>
                            <Button size="small" variant="secondary" onClick={refresh}>Refresh list</Button>
                            <Button size="small" variant="secondary" onClick={() => Native.reload()}>Reload overlays</Button>
                            {overlayRoot && (
                                <Button size="small" variant="dangerSecondary" onClick={() => settings.store.overlayRoot = ""}>Use default folder</Button>
                            )}
                        </div>
                        <Paragraph size="sm" defaultColor={false} className="vc-so-muted vc-so-hint">
                            Keep an overlay's background transparent. The README of the plugin explains how to write your own.
                        </Paragraph>
                    </>
                )}
            >
                <Paragraph weight="semibold">Overlays folder</Paragraph>
            </ExpandableSection>
        </section>
    );
}
