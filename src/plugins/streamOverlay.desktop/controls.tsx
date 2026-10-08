/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./controls.css";

import { useEffect, useState } from "@webpack/common";
import type { CSSProperties } from "react";

// Native inputs on purpose: Discord's own ColorPicker / Slider are filled in lazily (only once Discord happened to load
// the module that defines them), so a settings page built on them can silently render nothing.

const HEX = /^#[0-9a-f]{6}$/i;
const decimals = (step: number) => (String(step).split(".")[1] ?? "").length;

const BORDER = "var(--border-subtle, rgb(255 255 255 / 14%))";
const DANGER = "var(--status-danger, #f23f43)";

// native controls render light by default, which glares on Discord's dark themes
const colorScheme = () => document.documentElement.classList.contains("theme-light") ? "light" : "dark";

const field = {
    height: "30px",
    boxSizing: "border-box",
    border: `1px solid ${BORDER}`,
    borderRadius: "6px",
    background: "var(--input-background, rgb(30 31 34))",
    color: "var(--text-normal, #dbdee1)"
} as const;

// "#ff8800" or "ff8800"
const asHex = (text: string) => HEX.test(text) ? text.toLowerCase() : HEX.test("#" + text) ? "#" + text.toLowerCase() : null;

export function ColorControl({ value, onChange }: { value: string; onChange(hex: string): void; }) {
    // the text can be half typed, so it is only reported once it is a valid color
    const [text, setText] = useState(value);
    useEffect(() => setText(value), [value]);

    const valid = asHex(text) !== null;
    function edit(next: string) {
        setText(next);
        const hex = asHex(next);
        if (hex) onChange(hex);
    }

    return (
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
                type="color"
                aria-label="Pick a color"
                value={HEX.test(value) ? value : "#000000"}
                onChange={e => edit(e.currentTarget.value)}
                style={{ ...field, width: "40px", padding: "2px", cursor: "pointer", colorScheme: colorScheme() }}
            />
            <input
                type="text"
                aria-label="Color as hex"
                value={text}
                maxLength={7}
                spellCheck={false}
                // typing replaces the current color
                onFocus={e => e.currentTarget.select()}
                onChange={e => edit(e.currentTarget.value)}
                style={{
                    ...field,
                    width: "88px",
                    padding: "0 8px",
                    fontFamily: "var(--font-code, monospace)",
                    colorScheme: colorScheme(),
                    borderColor: valid ? BORDER : DANGER,
                    // the focus ring would otherwise hide the red border while typing
                    outlineColor: valid ? undefined : DANGER
                }}
            />
        </div>
    );
}

export function NumberControl({ value, min, max, step, unit, onChange }: {
    value: number;
    min: number;
    max: number;
    step: number;
    unit: string;
    onChange(value: number): void;
}) {
    const digits = decimals(step);
    const fill = max > min ? Math.min(100, Math.max(0, (value - min) / (max - min) * 100)) : 0;

    return (
        <div style={{ display: "flex", alignItems: "center", gap: "12px", width: "280px" }}>
            <input
                type="range"
                className="vc-so-range"
                aria-label="Value"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={e => onChange(Number(Number(e.currentTarget.value).toFixed(digits)))}
                style={{ "--fill": `${fill}%` } as CSSProperties}
            />
            <span style={{ width: "60px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--text-normal, #dbdee1)" }}>
                {value.toFixed(digits)}{unit}
            </span>
        </div>
    );
}
