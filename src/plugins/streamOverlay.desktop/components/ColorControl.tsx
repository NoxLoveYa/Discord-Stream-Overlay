/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ColorControl.css";

import { DownArrow } from "@components/Icons";
import { TextInput, useEffect, useRef, useState } from "@webpack/common";
import type { KeyboardEvent } from "react";

// Built from scratch, like Discord's role color picker (default, custom, and these swatches): Discord's own ColorPicker is
// only filled in once Discord happened to load the module that defines it, so a settings page cannot rely on it.
const SWATCHES = [
    ["Turquoise", "#1abc9c"], ["Green", "#2ecc71"], ["Blue", "#3498db"], ["Purple", "#9b59b6"], ["Magenta", "#e91e63"],
    ["Yellow", "#f1c40f"], ["Orange", "#e67e22"], ["Red", "#e74c3c"], ["Light gray", "#95a5a6"], ["Slate", "#607d8b"],
    ["Dark turquoise", "#11806a"], ["Dark green", "#1f8b4c"], ["Dark blue", "#206694"], ["Dark purple", "#71368a"], ["Dark magenta", "#ad1457"],
    ["Dark yellow", "#c27c0e"], ["Dark orange", "#a84300"], ["Dark red", "#992d22"], ["Gray", "#979c9f"], ["Dark slate", "#546e7a"]
] as const;
const COLUMNS = 10;

const HEX = /^#[0-9a-f]{6}$/i;
const asHex = (text: string) => HEX.test(text) ? text.toLowerCase() : HEX.test("#" + text) ? "#" + text.toLowerCase() : null;

const markColor = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#1e1f22" : "#fff";
};

// native controls render light by default, which glares on Discord's dark themes
const colorScheme = () => document.documentElement.classList.contains("theme-light") ? "light" : "dark";

function CheckIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
        </svg>
    );
}

function DropperIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill="currentColor"
                d="m20.71 5.63-2.34-2.34a1 1 0 0 0-1.41 0l-3.12 3.12-1.93-1.91-1.41 1.41 1.42 1.42L3 16.25V21h4.75l8.92-8.92 1.42 1.42 1.41-1.41-1.92-1.92 3.12-3.12c.4-.4.4-1.03.01-1.42zM6.92 19 5 17.08l8.06-8.06 1.92 1.92L6.92 19z"
            />
        </svg>
    );
}

interface ColorControlProps {
    label: string;
    value: string;
    defaultValue?: string;
    onChange(hex: string): void;
}

export function ColorControl({ label, value, defaultValue, onChange }: ColorControlProps) {
    const [open, setOpen] = useState(false);
    // the text can be half typed, so it is only reported once it is a valid color
    const [text, setText] = useState(value);
    useEffect(() => setText(value), [value]);

    const trigger = useRef<HTMLButtonElement>(null);
    const swatches = useRef<(HTMLButtonElement | null)[]>([]);

    const current = HEX.test(value) ? value.toLowerCase() : "#000000";
    const fallback = defaultValue && HEX.test(defaultValue) ? defaultValue.toLowerCase() : null;
    const selected = SWATCHES.findIndex(([, hex]) => hex === current);
    const isCustom = selected < 0 && current !== fallback;
    const valid = asHex(text) !== null;

    function edit(next: string) {
        setText(next);
        const hex = asHex(next);
        if (hex) onChange(hex);
    }

    function close() {
        setOpen(false);
        trigger.current?.focus();
    }

    // arrow keys move through the swatches like through a grid; Tab leaves them
    function moveFocus(e: KeyboardEvent) {
        const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS } as Record<string, number>)[e.key];
        if (!step) return;

        const at = swatches.current.findIndex(el => el === document.activeElement);
        const next = swatches.current[at + step];
        if (next) {
            e.preventDefault();
            next.focus();
        }
    }

    return (
        <>
            <button
                ref={trigger}
                type="button"
                className="vc-so-color-trigger"
                aria-expanded={open}
                aria-label={`${label}: ${current}. ${open ? "Close the color picker" : "Pick a color"}`}
                onClick={() => setOpen(o => !o)}
            >
                <span className="vc-so-dot" style={{ background: current }} />
                <span className="vc-so-color-hex">{current}</span>
                <DownArrow className="vc-so-chevron" data-open={open} width={18} height={18} />
            </button>

            {open && (
                <div
                    className="vc-so-picker"
                    role="group"
                    aria-label={`${label}: pick a color`}
                    onKeyDown={e => {
                        if (e.key !== "Escape") return;
                        e.stopPropagation();
                        close();
                    }}
                >
                    <div className="vc-so-picker-main">
                        <div className="vc-so-tiles">
                            {fallback && (
                                <button
                                    type="button"
                                    className="vc-so-tile"
                                    data-selected={current === fallback}
                                    aria-label={`Default color ${fallback}`}
                                    onClick={() => onChange(fallback)}
                                >
                                    <span className="vc-so-tile-face" style={{ background: fallback, color: markColor(fallback) }}>
                                        {current === fallback && <CheckIcon />}
                                    </span>
                                    <span className="vc-so-tile-name">Default</span>
                                </button>
                            )}

                            <div className="vc-so-tile" data-selected={isCustom}>
                                <input
                                    type="color"
                                    className="vc-so-native"
                                    aria-label="Custom color"
                                    value={current}
                                    style={{ colorScheme: colorScheme() }}
                                    onChange={e => onChange(e.currentTarget.value.toLowerCase())}
                                />
                                <span className="vc-so-tile-face" style={isCustom ? { background: current, color: markColor(current) } : undefined}>
                                    {isCustom ? <CheckIcon /> : <DropperIcon />}
                                </span>
                                <span className="vc-so-tile-name">Custom</span>
                            </div>
                        </div>

                        <div className="vc-so-swatches" role="radiogroup" aria-label="Colors" onKeyDown={moveFocus}>
                            {SWATCHES.map(([name, hex], i) => (
                                <button
                                    key={hex}
                                    ref={el => void (swatches.current[i] = el)}
                                    type="button"
                                    role="radio"
                                    className="vc-so-swatch"
                                    aria-checked={i === selected}
                                    aria-label={`${name} ${hex}`}
                                    title={name}
                                    tabIndex={i === Math.max(selected, 0) ? 0 : -1}
                                    style={{ background: hex, color: markColor(hex) }}
                                    onClick={() => onChange(hex)}
                                >
                                    {i === selected && <CheckIcon />}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="vc-so-picker-hex">
                        <TextInput
                            value={text}
                            onChange={edit}
                            maxLength={7}
                            spellCheck={false}
                            placeholder="#8b5cf6"
                            aria-label={`${label} as hex`}
                            error={valid ? undefined : "Use a color like #8b5cf6"}
                            onFocus={e => e.currentTarget.select()}
                        />
                    </div>
                </div>
            )}
        </>
    );
}
