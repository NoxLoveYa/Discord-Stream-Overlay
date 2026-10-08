/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { CopyIcon, DeleteIcon, PencilIcon, RestartIcon } from "@components/Icons";
import { cleanName, MAX_NAME } from "@plugins/streamOverlay.desktop/presets";
import { TextInput, useState } from "@webpack/common";
import type { ComponentType, ReactNode, SVGProps } from "react";

function IconButton({ label, icon: Icon, disabled, danger, onClick }: {
    label: string;
    icon: ComponentType<SVGProps<SVGSVGElement>>;
    disabled?: boolean;
    danger?: boolean;
    onClick(): void;
}) {
    return (
        <button type="button" className="vc-so-icon-btn" data-danger={danger} title={label} aria-label={label} disabled={disabled} onClick={onClick}>
            <Icon width={16} height={16} />
        </button>
    );
}

interface PresetCardProps {
    name: string;
    /** the current state is the one this preset saved */
    active: boolean;
    /** was just created */
    fresh: boolean;
    summary: ReactNode;
    /** whether another preset already has this name */
    isTaken(name: string): boolean;
    onApply(): void;
    onUpdate(): void;
    onRename(name: string): void;
    onDuplicate(): void;
    onDelete(): void;
}

export function PresetCard({ name, active, fresh, summary, isTaken, onApply, onUpdate, onRename, onDuplicate, onDelete }: PresetCardProps) {
    const [renaming, setRenaming] = useState(false);
    const [draft, setDraft] = useState(name);

    const clean = cleanName(draft);
    const taken = !!clean && isTaken(clean);

    function startRenaming() {
        setDraft(name);
        setRenaming(true);
    }

    function commit() {
        if (!clean || taken) return;
        if (clean !== name) onRename(clean);
        setRenaming(false);
    }

    return (
        <Card className="vc-so-preset" data-active={active} data-fresh={fresh}>
            {renaming ? (
                <div className="vc-so-rename">
                    <TextInput
                        value={draft}
                        onChange={setDraft}
                        maxLength={MAX_NAME}
                        autoFocus
                        aria-label={`New name for ${name}`}
                        error={taken ? "Another preset has this name" : undefined}
                        onFocus={e => e.currentTarget.select()}
                        onKeyDown={e => {
                            if (e.key === "Enter") commit();
                            else if (e.key === "Escape") {
                                e.stopPropagation();
                                setRenaming(false);
                            }
                        }}
                    />
                    <div className="vc-so-rename-buttons">
                        <Button size="small" disabled={!clean || taken} onClick={commit}>Rename</Button>
                        <Button size="small" variant="secondary" onClick={() => setRenaming(false)}>Cancel</Button>
                    </div>
                </div>
            ) : (
                <>
                    <div className="vc-so-preset-top">
                        <button
                            className="vc-so-open vc-so-preset-name"
                            title={active ? "This preset is in use" : "Apply this preset"}
                            aria-label={active ? `${name}, in use` : `Apply the preset ${name}`}
                            onClick={onApply}
                        >
                            {name}
                        </button>
                        {active && <span className="vc-so-pill">In use</span>}
                    </div>

                    <div className="vc-so-preset-meta">{summary}</div>

                    <div className="vc-so-preset-actions" role="toolbar" aria-label={`Actions for ${name}`}>
                        <IconButton label="Update with the current settings" icon={RestartIcon} disabled={active} onClick={onUpdate} />
                        <IconButton label="Rename" icon={PencilIcon} onClick={startRenaming} />
                        <IconButton label="Duplicate" icon={CopyIcon} onClick={onDuplicate} />
                        <IconButton label="Delete" icon={DeleteIcon} danger onClick={onDelete} />
                    </div>
                </>
            )}
        </Card>
    );
}
