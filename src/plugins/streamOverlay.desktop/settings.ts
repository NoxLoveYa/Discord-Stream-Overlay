/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType, PluginNative } from "@utils/types";

import { OverlayPicker } from "./components/OverlayPicker";
import type { OverlayValues } from "./types";

export const Native = VencordNative.pluginHelpers.StreamOverlay as PluginNative<typeof import("./native")>;

export const settings = definePluginSettings({
    overlayRoot: {
        type: OptionType.CUSTOM,
        default: ""
    },
    enabledOverlays: {
        type: OptionType.CUSTOM,
        default: ["red-border", "keyboard"] as string[]
    },
    overlayValues: {
        type: OptionType.CUSTOM,
        default: {} as OverlayValues
    },
    overlayPicker: {
        type: OptionType.COMPONENT,
        component: OverlayPicker
    },
    alwaysShow: {
        type: OptionType.BOOLEAN,
        description: "Show the overlays even when not screensharing (for testing)",
        default: false
    }
});

/** settings.store hands out proxies: edit a plain copy and assign it back. */
export function updateValues(edit: (values: OverlayValues) => void) {
    const values: OverlayValues = JSON.parse(JSON.stringify(settings.store.overlayValues));
    edit(values);
    settings.store.overlayValues = values;
}
