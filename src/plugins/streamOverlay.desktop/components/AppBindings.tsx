/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./apps.css";

import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { DeleteIcon, PlusIcon, SearchIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import { Switch } from "@components/Switch";
import { detectApp, useFocusedApp } from "@plugins/streamOverlay.desktop/appPresets";
import { cleanApp, MAX_APP, withBinding, withoutBinding } from "@plugins/streamOverlay.desktop/apps";
import { findPreset } from "@plugins/streamOverlay.desktop/presets";
import { plain, settings, updateStored } from "@plugins/streamOverlay.desktop/settings";
import type { AppBinding, GlobalPreset } from "@plugins/streamOverlay.desktop/types";
import { SearchableSelect, TextInput, useEffect, useState } from "@webpack/common";

import { IconButton } from "./IconButton";
import { submitOrCancel } from "./keys";
import { NoticeBar, useNotice } from "./Notice";

export function AppBindings({ presets, onShowPresets }: { presets: GlobalPreset[]; onShowPresets(): void; }) {
    const { appBindings, appRevert } = settings.use(["appBindings", "appRevert"]);
    const bindings: AppBinding[] = plain(appBindings);
    const focused = useFocusedApp();
    const { notice, say, dismiss } = useNotice();

    const [composing, setComposing] = useState(false);
    const [app, setApp] = useState("");
    const [preset, setPreset] = useState("");
    const [detecting, setDetecting] = useState<AbortController | null>(null);
    // the search ended without finding anything
    const [missed, setMissed] = useState(false);

    useEffect(() => () => detecting?.abort(), [detecting]);

    const clean = cleanApp(app);
    const invalid = !!app.trim() && !clean;
    const replaces = !!clean && bindings.some(b => b.app === clean);
    const hint = invalid ? "" : detecting ? "Switch to the app you want: it is picked up as soon as it is in focus."
        : missed ? "No app came into focus. Try again, or type the name."
            : replaces ? `${clean} is already here: adding it replaces its preset.`
                : "The name of the program, like game.exe. Or press Detect and switch to the app.";
    const options = presets.map(p => ({ label: p.name, value: p.name }));
    const setBindings = (next: AppBinding[]) => updateStored("appBindings", () => next);
    const change = (target: string, edit: Partial<AppBinding>) =>
        setBindings(bindings.map(b => b.app === target ? { ...b, ...edit } : b));

    function startComposing() {
        setApp("");
        setMissed(false);
        setPreset(presets[0]?.name ?? "");
        setComposing(true);
    }

    function stopComposing() {
        detecting?.abort();
        setComposing(false);
    }

    async function detect() {
        if (detecting) return detecting.abort();

        const controller = new AbortController();
        setApp("");
        setMissed(false);
        setDetecting(controller);
        const found = await detectApp(controller.signal);
        setDetecting(null);
        if (found) setApp(found);
        else setMissed(!controller.signal.aborted);
    }

    function add() {
        if (!clean || !preset) return;

        setBindings(withBinding(bindings, { app: clean, preset, enabled: true }));
        say(replaces ? `Changed ${clean} to “${preset}”.` : `${clean} now switches to “${preset}” while it is in focus.`);
        stopComposing();
    }

    return (
        <section className="vc-so-pm">
            <div className="vc-so-pm-head">
                <div>
                    <Paragraph size="sm" defaultColor={false} className="vc-so-muted vc-so-hint">
                        Switch to a preset while an app is in focus, like a game. An app is recognised by the name of its program,
                        never by what is on its window.
                    </Paragraph>
                </div>
                {!composing && (
                    <Button size="small" onClick={startComposing}>
                        <span className="vc-so-btn-content"><PlusIcon width={14} height={14} />Add app</span>
                    </Button>
                )}
            </div>

            {bindings.length > 0 && (
                <div className="vc-so-status" data-state={bindings.some(b => b.enabled && b.app === focused) ? "in-use" : "idle"}>
                    <span className="vc-so-status-dot" />
                    {focused ? `In focus: ${focused}` : "Waiting for one of these apps to come into focus"}
                </div>
            )}

            {composing && (
                <Card className="vc-so-form" role="group" aria-label="Add an app">
                    <Paragraph size="md" weight="semibold">Add an app</Paragraph>

                    <div className="vc-so-field">
                        <Paragraph size="sm" weight="semibold">App</Paragraph>
                        <div className="vc-so-field-row">
                            <TextInput
                                value={app}
                                onChange={value => { setApp(value); setMissed(false); }}
                                maxLength={MAX_APP}
                                autoFocus
                                disabled={!!detecting}
                                spellCheck={false}
                                placeholder={detecting ? "Waiting for an app…" : "game.exe"}
                                aria-label="App"
                                error={invalid ? "Use the name of the program, like game.exe" : undefined}
                                onKeyDown={submitOrCancel(add, stopComposing)}
                            />
                            <Button variant="secondary" onClick={detect}>
                                <span className="vc-so-btn-content">
                                    {!detecting && <SearchIcon width={16} height={16} />}
                                    {detecting ? "Stop" : "Detect"}
                                </span>
                            </Button>
                        </div>
                        {hint && (
                            <Paragraph size="sm" defaultColor={false} className="vc-so-muted vc-so-field-hint" role="status">
                                {detecting && <span className="vc-so-pulse" aria-hidden="true" />}
                                {hint}
                            </Paragraph>
                        )}
                    </div>

                    <div className="vc-so-field">
                        <Paragraph size="sm" weight="semibold">Switch to preset</Paragraph>
                        {options.length > 0 ? (
                            <div className="vc-so-select">
                                <SearchableSelect
                                    options={options}
                                    value={preset || undefined}
                                    onChange={(value: string) => setPreset(value)}
                                    placeholder="Choose a preset"
                                    closeOnSelect
                                    maxVisibleItems={6}
                                />
                            </div>
                        ) : (
                            <div className="vc-so-callout">
                                <Paragraph size="sm" defaultColor={false} className="vc-so-muted">
                                    An app switches to one of your global presets, and you have none yet.
                                </Paragraph>
                                <Button size="small" variant="secondary" onClick={onShowPresets}>Go to Presets</Button>
                            </div>
                        )}
                    </div>

                    <div className="vc-so-form-actions">
                        <Button variant="secondary" onClick={stopComposing}>Cancel</Button>
                        <Button disabled={!clean || !preset} onClick={add}>{replaces ? "Replace" : "Add app"}</Button>
                    </div>
                </Card>
            )}

            <NoticeBar notice={notice} onDismiss={dismiss} />

            {bindings.length > 0 ? (
                <>
                    <div className="vc-so-app-grid">
                        {bindings.map(binding => {
                            const bound = findPreset(presets, binding.preset);

                            return (
                                <Card key={binding.app} className="vc-so-app" data-enabled={binding.enabled} data-focused={focused === binding.app}>
                                    <div className="vc-so-card-top">
                                        <span className="vc-so-badge" aria-hidden="true">{binding.app.charAt(0).toUpperCase()}</span>
                                        <div className="vc-so-app-flags">
                                            {focused === binding.app && <span className="vc-so-pill">In focus</span>}
                                            <div className="vc-so-switch" role="group" aria-label={`${binding.app} on or off`}>
                                                <Switch checked={binding.enabled} onChange={on => change(binding.app, { enabled: on })} />
                                            </div>
                                        </div>
                                    </div>

                                    <Paragraph weight="semibold" className="vc-so-app-name">{binding.app}</Paragraph>
                                    <div className="vc-so-select">
                                        <SearchableSelect
                                            options={options}
                                            value={bound?.name}
                                            onChange={(value: string) => change(binding.app, { preset: value })}
                                            placeholder="Preset to switch to"
                                            closeOnSelect
                                            maxVisibleItems={6}
                                        />
                                    </div>
                                    {!bound && (
                                        <Paragraph size="sm" defaultColor={false} className="vc-so-warn">
                                            There is no preset “{binding.preset}” any more: nothing is applied.
                                        </Paragraph>
                                    )}

                                    <div className="vc-so-app-actions">
                                        <IconButton
                                            label={`Remove ${binding.app}`}
                                            icon={DeleteIcon}
                                            danger
                                            onClick={() => {
                                                setBindings(withoutBinding(bindings, binding.app));
                                                say(`Removed ${binding.app}.`, () => setBindings(bindings));
                                            }}
                                        />
                                    </div>
                                </Card>
                            );
                        })}
                    </div>

                    <div className="vc-so-row">
                        <div className="vc-so-row-text">
                            <Paragraph>Go back when the app is no longer in focus</Paragraph>
                            <Paragraph size="sm" defaultColor={false} className="vc-so-muted">
                                Puts back what was on and how it was set up before, unless you changed it in the meantime.
                            </Paragraph>
                        </div>
                        <div role="group" aria-label="Go back when the app is no longer in focus">
                            <Switch checked={appRevert} onChange={on => { settings.store.appRevert = on; }} />
                        </div>
                    </div>
                </>
            ) : !composing && (
                <Card className="vc-so-empty">
                    <Paragraph size="sm" defaultColor={false} className="vc-so-muted">
                        No apps yet. Add an app, and the preset to switch to while it is in focus.
                    </Paragraph>
                </Card>
            )}
        </section>
    );
}
