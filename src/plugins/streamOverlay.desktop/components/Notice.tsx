/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./common.css";

import { useEffect, useState } from "@webpack/common";

const NOTICE_MS = 8000;

export type Undo = () => void;

interface NoticeState {
    text: string;
    undo?: Undo;
}

export function useNotice() {
    const [notice, setNotice] = useState<NoticeState | null>(null);

    useEffect(() => {
        if (!notice) return;
        const timer = setTimeout(() => setNotice(null), NOTICE_MS);
        return () => clearTimeout(timer);
    }, [notice]);

    return {
        notice,
        say: (text: string, undo?: Undo) => setNotice({ text, undo }),
        dismiss: () => setNotice(null)
    };
}

export function NoticeBar({ notice, onDismiss }: { notice: NoticeState | null; onDismiss(): void; }) {
    if (!notice) return null;

    const { text, undo } = notice;

    return (
        <div className="vc-so-notice" role="status">
            <span>{text}</span>
            {undo && (
                <button className="vc-so-undo" onClick={() => { undo(); onDismiss(); }}>Undo</button>
            )}
            <button className="vc-so-notice-close" aria-label="Dismiss" onClick={onDismiss}>×</button>
        </div>
    );
}
