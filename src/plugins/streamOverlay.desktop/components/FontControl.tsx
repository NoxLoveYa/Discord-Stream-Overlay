/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { DeleteIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import { Native } from "@plugins/streamOverlay.desktop/settings";
import type { FontEntry } from "@plugins/streamOverlay.desktop/types";
import { SearchableSelect, TextInput, useEffect, useState } from "@webpack/common";

import { IconButton } from "./IconButton";
import { NoticeBar, useNotice } from "./Notice";

interface FontControlProps {
    label: string;
    /** what the overlay draws with (stored, global or theme default) */
    value: string;
    /** what is stored for it, if anything: only nothing stored follows the theme */
    stored: string | undefined;
    /** the choices of the manifest (or the built-ins, for the global font) */
    builtin: { label: string; value: string; }[];
    /** where an unset font follows ("the gothic theme (…)", null when just the default stack) */
    follows: string | null;
    onChange(family: string): void;
    /** back to following (deletes the stored family) */
    onClear(): void;
}

/** A font picker: the built-ins, the user's customs, and adding more from a file or by system name. */
export function FontControl({ label, value, stored, builtin, follows, onChange, onClear }: FontControlProps) {
    const [fonts, setFonts] = useState<FontEntry[]>([]);
    const [naming, setNaming] = useState(false);
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    const { notice, say, dismiss } = useNotice();

    const refresh = async () => {
        try {
            setFonts(await Native.listCustomFonts());
        } catch {
            setFonts([]);
        }
    };
    useEffect(() => void refresh(), []);

    // customs the manifest already lists are not shown twice
    const customs = fonts.filter(f => !builtin.some(b => b.value.toLowerCase() === f.family.toLowerCase()));
    const options = [
        ...builtin.map(o => ({ label: o.label, value: o.value })),
        ...customs.map(f => ({ label: `${f.name} (custom)`, value: f.family }))
    ];
    const known = options.some(o => o.value === value);

    async function importFile() {
        if (busy) return;
        setBusy(true);
        try {
            const entry = await Native.importFontFile();
            if (entry) {
                await refresh();
                onChange(entry.family);
                say(`Added “${entry.name}”.`);
            }
        } catch {
            say("Could not add that font file.");
        } finally {
            setBusy(false);
        }
    }

    async function addSystem() {
        const family = name.replace(/\s+/g, " ").trim();
        if (!family || busy) return;
        setBusy(true);
        try {
            const entry = await Native.addSystemFont(family);
            if (entry) {
                await refresh();
                setName("");
                setNaming(false);
                onChange(entry.family);
                say(`Added “${entry.name}”.`);
            } else {
                say("Use letters, digits, spaces and dashes for the name.");
            }
        } catch {
            say("Could not add that font.");
        } finally {
            setBusy(false);
        }
    }

    async function remove(entry: FontEntry) {
        try {
            if (await Native.removeCustomFont(entry.name)) {
                await refresh();
                // the stored family is gone: follow the theme (or the default font) again instead of a missing name
                if (stored === entry.family) onClear();
                say(`Removed “${entry.name}”.`);
            }
        } catch {
            say("Could not remove that font.");
        }
    }

    return (
        <div className="vc-so-font">
            <div style={{ width: "220px" }}>
                <SearchableSelect
                    options={options}
                    value={known ? value : undefined}
                    placeholder={known ? undefined : value}
                    onChange={(v: string) => onChange(v)}
                    closeOnSelect
                    maxVisibleItems={6}
                />
            </div>
            {!known && (
                <Paragraph size="sm" defaultColor={false} className="vc-so-muted">
                    “{value}” is not installed any more: a readable font is used until you pick another.
                </Paragraph>
            )}
            {known && follows && (
                <Paragraph size="sm" defaultColor={false} className="vc-so-muted">
                    Follows {follows}. Pick one to override it.
                </Paragraph>
            )}
            {customs.length > 0 && (
                <div className="vc-so-font-customs" role="group" aria-label={`${label} custom fonts`}>
                    {customs.map(entry => (
                        <span key={entry.name} className="vc-so-font-chip">
                            {entry.name}
                            <IconButton label={`Remove ${entry.name}`} icon={DeleteIcon} danger onClick={() => remove(entry)} />
                        </span>
                    ))}
                </div>
            )}
            {naming ? (
                <div className="vc-so-font-addrow">
                    <TextInput
                        value={name}
                        onChange={setName}
                        maxLength={40}
                        autoFocus
                        spellCheck={false}
                        placeholder="Segoe UI"
                        aria-label="System font name"
                        onKeyDown={e => {
                            if (e.key === "Enter") addSystem();
                            else if (e.key === "Escape") {
                                e.stopPropagation();
                                setNaming(false);
                            }
                        }}
                    />
                    <Button size="small" variant="secondary" disabled={!name.trim() || busy} onClick={addSystem}>Add</Button>
                    <Button size="small" variant="secondary" onClick={() => setNaming(false)}>Cancel</Button>
                </div>
            ) : (
                <div className="vc-so-buttons">
                    <Button size="small" variant="secondary" disabled={busy} onClick={importFile}>Add font file…</Button>
                    <Button size="small" variant="secondary" onClick={() => setNaming(true)}>Add system font…</Button>
                </div>
            )}
            <NoticeBar notice={notice} onDismiss={dismiss} />
        </div>
    );
}
