/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { plugins } from "@api/PluginManager";
import { MainSettingsIcon } from "@components/Icons";
import { openPluginModal } from "@components/settings";
import { Menu } from "@webpack/common";

// the stream options of the "manage-streams" menu, the one behind the streaming button
const STREAM_OPTION_IDS = ["stream-settings-audio-enable", "stream-settings", "change-windows", "stop-streaming"];

export const manageStreamsPatch: NavContextMenuPatchCallback = children => {
    const item = (
        <Menu.MenuItem
            id="vc-stream-overlay-settings"
            label="Overlay Settings"
            icon={MainSettingsIcon}
            leadingAccessory={{ type: "icon", icon: MainSettingsIcon }}
            action={() => openPluginModal(plugins.StreamOverlay)}
        />
    );

    const group = findGroupChildrenByChildId(STREAM_OPTION_IDS, children);
    if (group) group.push(item);
    else children.push(<Menu.MenuGroup>{item}</Menu.MenuGroup>);
};
