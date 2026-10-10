/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { DeleteIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import { cleanName, MAX_NAME } from "@plugins/streamOverlay.desktop/presets";
import { Native } from "@plugins/streamOverlay.desktop/settings";
import type { FontEntry } from "@plugins/streamOverlay.desktop/types";
import { Logger } from "@utils/Logger";
import { SearchableSelect, TextInput, useEffect, useState } from "@webpack/common";

import { IconButton } from "./IconButton";
import { submitOrCancel } from "./keys";
import { NoticeBar, useNotice } from "./Notice";

const logger = new Logger("StreamOverlay");

interface FontControlProps {
    label: string;
    /** what the overlay draws with (stored, global or theme default) */
    value: string;
    /** what is stored for it: only nothing stored follows the chosen option */
    stored: string | undefined;
    builtin: { label: string; value: string; }[];
    /** where an unset font follows ("the Gothic theme (ObnoxiousGothic)"), null when just the default stack */
    follows: string | null;
    onChange(family: string): void;
    /** back to following: deletes the stored family */
    onClear(): void;
}

export function FontControl({ label, value, stored, builtin, follows, onChange, onClear }: FontControlProps) {
    const [fonts, setFonts] = useState<FontEntry[]>([]);
    const [naming, setNaming] = useState(false);
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    const { notice, say, dismiss } = useNotice();

    const refresh = async () => {
        try {
            setFonts(await Native.listCustomFonts());
        } catch (e) {
            logger.error("could not list the custom fonts", e);
            setFonts([]);
        }
    };
    useEffect(() => void refresh(), []);

    // customs the manifest already lists are not shown twice
    const customs = fonts.filter(f => !builtin.some(b => b.value.toLowerCase() === f.family.toLowerCase()));
    const options = [
        ...builtin,
        ...customs.map(f => ({ label: `${f.name} (custom)`, value: f.family }))
    ];
    const known = options.some(o => o.value === value);

    async function attempt(failure: string, action: () => Promise<void>) {
        if (busy) return;
        setBusy(true);
        try {
            await action();
        } catch (e) {
            logger.error(failure, e);
            say(failure);
        } finally {
            setBusy(false);
        }
    }

    async function adopt(entry: FontEntry) {
        await refresh();
        onChange(entry.family);
        say(`Added “${entry.name}”.`);
    }

    const importFile = () => attempt("Could not add that font file.", async () => {
        const entry = await Native.importFontFile();
        if (entry) await adopt(entry);
    });

    const addSystem = () => {
        const family = cleanName(name);
        if (!family) return;

        return attempt("Could not add that font.", async () => {
            const entry = await Native.addSystemFont(family);
            if (!entry) {
                say("Use letters, digits, spaces and dashes for the name.");
                return;
            }
            setName("");
            setNaming(false);
            await adopt(entry);
        });
    };

    async function remove(entry: FontEntry) {
        try {
            if (await Native.removeCustomFont(entry.name)) {
                await refresh();
                // the stored family is gone: follow the chosen option (or the default font) again instead of a missing name
                if (stored === entry.family) onClear();
                say(`Removed “${entry.name}”.`);
            }
        } catch (e) {
            logger.error("could not remove the font", e);
            say("Could not remove that font.");
        }
    }

    return (
        <div className="vc-so-font">
            <div className="vc-so-option-select">
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
                        maxLength={MAX_NAME}
                        autoFocus
                        spellCheck={false}
                        placeholder="Segoe UI"
                        aria-label="System font name"
                        onKeyDown={submitOrCancel(addSystem, () => setNaming(false))}
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
