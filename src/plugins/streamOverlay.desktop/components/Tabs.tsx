/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TabBar } from "@webpack/common";
import type { PropsWithChildren } from "react";

interface TabsProps<T extends string> {
    /** what the tabs are for, for assistive technology */
    label: string;
    tabs: ReadonlyArray<{ id: T; label: string; }>;
    current: T;
    onChange(tab: T): void;
}

/** Discord's tab bar (with the look of Vencord's own settings pages), and the content of the tab that is open below it. */
export function Tabs<T extends string>({ label, tabs, current, onChange, children }: PropsWithChildren<TabsProps<T>>) {
    return (
        <>
            <TabBar
                type="top"
                look="brand"
                className="vc-settings-tab-bar vc-so-tabs"
                aria-label={label}
                selectedItem={current}
                onItemSelect={onChange}
            >
                {tabs.map(tab => (
                    <TabBar.Item key={tab.id} className="vc-settings-tab-bar-item" id={tab.id}>
                        {tab.label}
                    </TabBar.Item>
                ))}
            </TabBar>

            <div role="tabpanel" aria-label={tabs.find(tab => tab.id === current)?.label} className="vc-so-panel">
                {children}
            </div>
        </>
    );
}
