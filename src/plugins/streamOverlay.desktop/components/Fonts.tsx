/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Paragraph } from "@components/Paragraph";
import { BUILTIN_FONTS } from "@plugins/streamOverlay.desktop/main/values";
import { settings } from "@plugins/streamOverlay.desktop/settings";

import { FontControl } from "./FontControl";

/** The default font of every overlay, and the custom fonts (imported files or system names). */
export function Fonts() {
    const { globalFont } = settings.use(["globalFont"]);

    return (
        <section className="vc-so-fonts">
            <Paragraph size="sm" defaultColor={false} className="vc-so-muted vc-so-hint">
                The font of every overlay that has no font of its own. An overlay's own page can override it,
                and that choice is saved per preset, so a game can have its own font through the Apps tab.
                The gothic theme keeps its blackletter on the keys whatever the font is.
            </Paragraph>
            <div className="vc-so-row">
                <Paragraph>Default font</Paragraph>
                <FontControl
                    label="Default font"
                    value={typeof globalFont === "string" ? globalFont : "default"}
                    stored={typeof globalFont === "string" ? globalFont : "default"}
                    builtin={BUILTIN_FONTS}
                    follows={null}
                    onChange={family => { settings.store.globalFont = family; }}
                    onClear={() => { settings.store.globalFont = "default"; }}
                />
            </div>
        </section>
    );
}
