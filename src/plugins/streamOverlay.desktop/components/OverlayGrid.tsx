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
import { byCategory } from "@plugins/streamOverlay.desktop/groups";
import { captureGlobal, copyName, isGlobalActive, renamePreset, withoutPreset, withPreset } from "@plugins/streamOverlay.desktop/presets";
import { applyGlobalPreset, Native, plain, setOverlayEnabled, settings, updateStored } from "@plugins/streamOverlay.desktop/settings";
import type { GlobalPreset, OverlayInfo } from "@plugins/streamOverlay.desktop/types";
import { useState } from "@webpack/common";
import type { CSSProperties } from "react";

import { AppBindings } from "./AppBindings";
import { Fonts } from "./Fonts";
import { Layout } from "./Layout";
import { OverlayCard } from "./OverlayCard";
import { PresetManager } from "./PresetManager";
import { GlobalPresetSummary } from "./PresetSummary";
import { Tabs } from "./Tabs";

const TABS = [
    { id: "overlays", label: "Overlays" },
    { id: "layout", label: "Layout" },
    { id: "presets", label: "Presets" },
    { id: "apps", label: "Apps" },
    { id: "fonts", label: "Fonts" }
] as const;
type Tab = (typeof TABS)[number]["id"];

const MAX_CARDS_PER_ROW = 4;

interface OverlayGridProps {
    info: { root: string; overlays: OverlayInfo[]; };
    refresh(): void;
    onOpen(name: string): void;
}

export function OverlayGrid({ info, refresh, onOpen }: OverlayGridProps) {
    const { overlayRoot, enabledOverlays, overlayValues, globalPresets, globalFont } = settings.use(["overlayRoot", "enabledOverlays", "overlayValues", "globalPresets", "globalFont"]);
    const { overlays } = info;
    const sections = byCategory(overlays);
    const [tab, setTab] = useState<Tab>("overlays");

    const enabled = [...enabledOverlays];
    const values = plain(overlayValues);
    const presets: GlobalPreset[] = plain(globalPresets);
    const setPresets = (next: GlobalPreset[]) => updateStored("globalPresets", () => next);

    async function browse() {
        const picked = await Native.pickFolder(overlayRoot);
        if (picked) settings.store.overlayRoot = picked;
    }

    return (
        <section className="vc-so">
            <Tabs<Tab> label="Stream overlay settings" tabs={TABS} current={tab} onChange={setTab}>
                {tab === "overlays" && (
                    <>
                        <div>
                            <Paragraph size="sm" defaultColor={false} className="vc-so-muted vc-so-hint">
                                Turn an overlay on or off with its switch, or open it to change its settings.
                            </Paragraph>
                            {overlays.length > 0 ? <div className="vc-so-sections">{sections.map(({ category, items }) => (
                                <div key={category} className="vc-so-category" style={{ "--vc-so-count": Math.min(items.length, MAX_CARDS_PER_ROW) } as CSSProperties}>
                                    {/* no headings when everything is in the same place (or has no category at all) */}
                                    {sections.length > 1 && <Heading tag="h3" className="vc-so-group">{category || "Other"}</Heading>}
                                    <div className="vc-so-grid">
                                        {items.map(overlay => (
                                            <OverlayCard
                                                key={overlay.name}
                                                overlay={overlay}
                                                enabled={enabledOverlays.includes(overlay.name)}
                                                onToggle={on => setOverlayEnabled(overlay.name, on)}
                                                onOpen={() => onOpen(overlay.name)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            ))}</div> : (
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
                    </>
                )}

                {tab === "layout" && <Layout overlays={overlays} />}

                {tab === "presets" && (
                    <PresetManager
                        hint="A preset keeps which overlays are on and how every overlay is set up. Each overlay also has presets of its own."
                        emptyText="No presets yet. Turn on the overlays you want and set them up, then save it here to switch back to this setup in one click."
                        presets={presets}
                        isActive={preset => isGlobalActive(preset, overlays, enabled, values, globalFont)}
                        summarize={preset => <GlobalPresetSummary preset={preset} overlays={overlays} />}
                        save={name => setPresets(withPreset(presets, captureGlobal(name, overlays, enabled, values)))}
                        rename={(preset, to) => setPresets(renamePreset(presets, preset.name, to))}
                        duplicate={preset => {
                            const copy = copyName(presets, preset.name);
                            setPresets([...presets, { ...plain(preset), name: copy }]);
                            return copy;
                        }}
                        apply={applyGlobalPreset}
                        update={preset => {
                            setPresets(withPreset(presets, captureGlobal(preset.name, overlays, enabled, values)));
                            return () => setPresets(presets);
                        }}
                        remove={preset => {
                            setPresets(withoutPreset(presets, preset.name));
                            return () => setPresets(presets);
                        }}
                    />
                )}

                {tab === "apps" && <AppBindings presets={presets} onShowPresets={() => setTab("presets")} />}

                {tab === "fonts" && <Fonts />}
            </Tabs>
        </section>
    );
}
