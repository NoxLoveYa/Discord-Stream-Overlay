/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./common.css";

import type { ComponentType, SVGProps } from "react";

interface IconButtonProps {
    label: string;
    icon: ComponentType<SVGProps<SVGSVGElement>>;
    disabled?: boolean;
    danger?: boolean;
    onClick(): void;
}

export function IconButton({ label, icon: Icon, disabled, danger, onClick }: IconButtonProps) {
    return (
        <button type="button" className="vc-so-icon-btn" data-danger={danger} title={label} aria-label={label} disabled={disabled} onClick={onClick}>
            <Icon width={16} height={16} />
        </button>
    );
}
