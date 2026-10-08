/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./presets.css";

import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { PlusIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import { cleanName, findPreset, isTaken, MAX_NAME, newName } from "@plugins/streamOverlay.desktop/presets";
import { TextInput, useEffect, useState } from "@webpack/common";
import type { ReactNode } from "react";

import { NoticeBar, type Undo, useNotice } from "./Notice";
import { PresetCard } from "./PresetCard";

const FRESH_MS = 1600;

interface PresetManagerProps<T extends { name: string; }> {
    hint: string;
    emptyText: string;
    presets: T[];
    /** whether the current state is the one this preset saved */
    isActive(preset: T): boolean;
    summarize(preset: T): ReactNode;
    /** creates the preset from the current state, or replaces the one with that name */
    save(name: string): void;
    rename(preset: T, name: string): void;
    /** returns the name of the copy */
    duplicate(preset: T): string;
    // these return what undoes them
    apply(preset: T): Undo;
    update(preset: T): Undo;
    remove(preset: T): Undo;
}

/** The presets of something: a card each (click to apply), what is in use, a way to save the current state, and undo. */
export function PresetManager<T extends { name: string; }>(props: PresetManagerProps<T>) {
    const { presets, isActive } = props;

    const [composing, setComposing] = useState(false);
    const [name, setName] = useState("");
    const [fresh, setFresh] = useState<string | null>(null);
    const { notice, say, dismiss } = useNotice();

    useEffect(() => {
        if (!fresh) return;
        const timer = setTimeout(() => setFresh(null), FRESH_MS);
        return () => clearTimeout(timer);
    }, [fresh]);

    const clean = cleanName(name);
    const replaces = !!clean && !!findPreset(presets, clean);
    const inUse = presets.filter(isActive);

    function startComposing() {
        setName(newName(presets));
        setComposing(true);
    }

    function save() {
        if (!clean) return;
        props.save(clean);
        say(replaces ? `Replaced “${clean}”.` : `Saved “${clean}”.`);
        setFresh(clean);
        setComposing(false);
    }

    return (
        <section className="vc-so-pm">
            <div className="vc-so-pm-head">
                <div>
                    <Paragraph size="sm" defaultColor={false} className="vc-so-muted vc-so-hint">{props.hint}</Paragraph>
                </div>
                {!composing && (
                    <Button size="small" onClick={startComposing}>
                        <span className="vc-so-btn-content"><PlusIcon width={14} height={14} />Save current</span>
                    </Button>
                )}
            </div>

            {presets.length > 0 && (
                <div className="vc-so-status" data-state={inUse.length ? "in-use" : "unsaved"}>
                    <span className="vc-so-status-dot" />
                    {inUse.length ? `Using “${inUse[0].name}”` : "Unsaved changes: the current settings are not a preset"}
                </div>
            )}

            {composing && (
                <div className="vc-so-composer">
                    <div className="vc-so-composer-field">
                        <TextInput
                            value={name}
                            onChange={setName}
                            maxLength={MAX_NAME}
                            autoFocus
                            placeholder="Preset name"
                            aria-label="Preset name"
                            onFocus={e => e.currentTarget.select()}
                            onKeyDown={e => {
                                if (e.key === "Enter") save();
                                else if (e.key === "Escape") {
                                    e.stopPropagation();
                                    setComposing(false);
                                }
                            }}
                        />
                    </div>
                    <Button size="small" disabled={!clean} onClick={save}>{replaces ? "Replace" : "Save"}</Button>
                    <Button size="small" variant="secondary" onClick={() => setComposing(false)}>Cancel</Button>
                    {replaces && <Paragraph size="sm" defaultColor={false} className="vc-so-muted">A preset with this name exists: saving replaces it.</Paragraph>}
                </div>
            )}

            <NoticeBar notice={notice} onDismiss={dismiss} />

            {presets.length > 0 ? (
                <div className="vc-so-preset-grid">
                    {presets.map(preset => (
                        <PresetCard
                            key={preset.name}
                            name={preset.name}
                            active={isActive(preset)}
                            fresh={fresh === preset.name}
                            summary={props.summarize(preset)}
                            isTaken={other => isTaken(presets, other, preset.name)}
                            onApply={() => {
                                if (!isActive(preset)) say(`Applied “${preset.name}”.`, props.apply(preset));
                            }}
                            onUpdate={() => say(`Updated “${preset.name}” with the current settings.`, props.update(preset))}
                            onRename={to => {
                                props.rename(preset, to);
                                setFresh(to);
                                say(`Renamed to “${to}”.`);
                            }}
                            onDuplicate={() => {
                                const copy = props.duplicate(preset);
                                setFresh(copy);
                                say(`Duplicated as “${copy}”.`);
                            }}
                            onDelete={() => say(`Deleted “${preset.name}”.`, props.remove(preset))}
                        />
                    ))}
                </div>
            ) : (
                <Card className="vc-so-empty">
                    <Paragraph size="sm" defaultColor={false} className="vc-so-muted">{props.emptyText}</Paragraph>
                </Card>
            )}
        </section>
    );
}
