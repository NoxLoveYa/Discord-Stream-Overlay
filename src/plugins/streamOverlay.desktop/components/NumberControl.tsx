/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Paragraph } from "@components/Paragraph";
import { Slider, useRef } from "@webpack/common";

interface NumberControlProps {
    /** what the setting is called, for assistive technology */
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    unit: string;
    onChange(value: number): void;
}

const decimals = (step: number) => (String(step).split(".")[1] ?? "").length;

export function NumberControl({ label, value, min, max, step, unit, onChange }: NumberControlProps) {
    const digits = decimals(step);
    const snap = (v: number) => Number(Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min)).toFixed(digits));

    // Discord's Slider reads initialValue once. A value that changed from outside (a preset, a reset, the overlay saving
    // where it was dragged to) needs a fresh slider, while the user's own changes must not replace it mid-drag.
    const lastEmitted = useRef(value);
    const version = useRef(0);
    if (value !== lastEmitted.current) {
        lastEmitted.current = value;
        version.current++;
    }

    return (
        <div className="vc-so-number" role="group" aria-label={label}>
            <div className="vc-so-slider">
                <Slider
                    key={version.current}
                    initialValue={value}
                    minValue={min}
                    maxValue={max}
                    keyboardStep={step}
                    onValueRender={(v: number) => `${snap(v).toFixed(digits)}${unit}`}
                    getAriaValueText={(v: number) => `${snap(v).toFixed(digits)}${unit}`}
                    onValueChange={(v: number) => {
                        const next = snap(v);
                        if (next === lastEmitted.current) return;
                        lastEmitted.current = next;
                        onChange(next);
                    }}
                />
            </div>
            <Paragraph size="sm" className="vc-so-readout">{value.toFixed(digits)}{unit}</Paragraph>
        </div>
    );
}
