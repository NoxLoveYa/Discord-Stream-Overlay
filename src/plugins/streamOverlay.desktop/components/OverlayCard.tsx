/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Card } from "@components/Card";
import { Paragraph } from "@components/Paragraph";
import { Switch } from "@components/Switch";
import { isShown } from "@plugins/streamOverlay.desktop/groups";
import type { OverlayInfo } from "@plugins/streamOverlay.desktop/types";

interface OverlayCardProps {
    overlay: OverlayInfo;
    enabled: boolean;
    onToggle(on: boolean): void;
    onOpen(): void;
}

export function OverlayCard({ overlay, enabled, onToggle, onOpen }: OverlayCardProps) {
    const count = overlay.settings.filter(s => isShown(s, overlay.settings, undefined)).length;

    return (
        <Card className="vc-so-card" data-enabled={enabled}>
            <div className="vc-so-card-top">
                <span className="vc-so-badge" aria-hidden="true">{overlay.title.charAt(0).toUpperCase()}</span>
                <div className="vc-so-switch" role="group" aria-label={`${overlay.title} on or off`} title={enabled ? `Turn ${overlay.title} off` : `Turn ${overlay.title} on`}>
                    <Switch checked={enabled} onChange={onToggle} />
                </div>
            </div>

            <button className="vc-so-open" aria-label={`${overlay.title}: open its settings`} onClick={onOpen}>
                {overlay.title}
            </button>
            {overlay.description && (
                <Paragraph size="sm" defaultColor={false} className="vc-so-muted">{overlay.description}</Paragraph>
            )}

            <div className="vc-so-card-foot">
                <span>{enabled ? "On" : "Off"} · {count === 1 ? "1 setting" : `${count} settings`}</span>
                <span aria-hidden="true">›</span>
            </div>
        </Card>
    );
}
