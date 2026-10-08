/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { cleanName, findPreset, MAX_NAME } from "@plugins/streamOverlay.desktop/presets";
import { TextInput, useState } from "@webpack/common";

interface PresetBarProps<T extends { name: string; }> {
    presets: T[];
    /** whether the current state is the one this preset saved */
    isActive(preset: T): boolean;
    onApply(preset: T): void;
    onSave(name: string): void;
    onDelete(name: string): void;
    emptyText: string;
}

export function PresetBar<T extends { name: string; }>({ presets, isActive, onApply, onSave, onDelete, emptyText }: PresetBarProps<T>) {
    const [name, setName] = useState("");
    const [deleting, setDeleting] = useState<string | null>(null);

    const clean = cleanName(name);
    const replaces = !!clean && !!findPreset(presets, clean);
    const pending = deleting && findPreset(presets, deleting);

    function save() {
        if (!clean) return;
        onSave(clean);
        setName("");
    }

    return (
        <div className="vc-so-presets">
            {presets.length > 0 ? (
                <ul className="vc-so-chips">
                    {presets.map(preset => (
                        <li key={preset.name} className="vc-so-chip" data-active={isActive(preset)}>
                            <button className="vc-so-chip-apply" title="Apply this preset" onClick={() => onApply(preset)}>
                                {preset.name}
                            </button>
                            <button
                                className="vc-so-chip-delete"
                                title="Delete this preset"
                                aria-label={`Delete preset ${preset.name}`}
                                onClick={() => setDeleting(preset.name)}
                            >
                                ×
                            </button>
                        </li>
                    ))}
                </ul>
            ) : (
                <Paragraph size="sm" defaultColor={false} className="vc-so-muted">{emptyText}</Paragraph>
            )}

            {pending && (
                <div className="vc-so-confirm" role="alert">
                    <Paragraph size="sm">Delete the preset “{pending.name}”?</Paragraph>
                    <Button variant="dangerPrimary" size="small" onClick={() => { onDelete(pending.name); setDeleting(null); }}>Delete</Button>
                    <Button variant="secondary" size="small" onClick={() => setDeleting(null)}>Cancel</Button>
                </div>
            )}

            <div className="vc-so-save">
                <div className="vc-so-name">
                    <TextInput
                        value={name}
                        onChange={setName}
                        maxLength={MAX_NAME}
                        placeholder="Name for a new preset"
                        aria-label="Preset name"
                        onKeyDown={e => e.key === "Enter" && save()}
                    />
                </div>
                <Button disabled={!clean} onClick={save}>{replaces ? "Replace preset" : "Save as preset"}</Button>
            </div>
        </div>
    );
}
