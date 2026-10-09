/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings, PlainSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { FriendsStore, React, Select, useStateFromStores } from "@webpack/common";

const settings = definePluginSettings({
    applicationId: {
        type: OptionType.COMPONENT,
        default: "",
        component: ActivitySelectComponent
    }
});

let originalFilter: any = null;
let patchedPrototype: any = null;
const logger = new Logger("FriendsActivitySorter");

function getSelectedApplicationId() {
    return PlainSettings.plugins.FriendsActivitySorter?.applicationId ?? "";
}

function ActivitySelectComponent({ setValue }: { setValue(value: string): void; }) {
    const rows = useStateFromStores([FriendsStore], () => FriendsStore.getState().rows as any);

    const options = React.useMemo(() => {
        const activities = new Map<string, { label: string; value: string; }>();

        for (const row of rows?._rows ?? []) {
            for (const activity of row.activities ?? []) {
                if (!activity.application_id || activities.has(activity.application_id)) continue;

                activities.set(activity.application_id, {
                    label: activity.name,
                    value: activity.application_id
                });
            }
        }

        return [
            { label: "All activities", value: "" },
            ...Array.from(activities.values()).sort((a, b) => a.label.localeCompare(b.label))
        ];
    }, [rows]);

    const selectedApplicationId = getSelectedApplicationId();

    return React.createElement(Select, {
        placeholder: "Choose an activity",
        options,
        maxVisibleItems: 10,
        closeOnSelect: true,
        select: setValue,
        isSelected: (value: string) => value === selectedApplicationId,
        serialize: (value: string) => String(value)
    });
}

export default definePlugin({
    name: "FriendsActivitySorter",
    description: "Plugin that allows you to display only friends playing a specific game in the activity list.",
    authors: [Devs.IamSwan],

    start() {
        logger.info("Starting plugin");

        const rows = FriendsStore.getState().rows as any;
        const rowsPrototype = rows && Object.getPrototypeOf(rows);

        if (!rows || !rowsPrototype) {
            logger.warn("FriendsStore rows or prototype are not available yet; nothing to patch");
            return;
        }

        if (patchedPrototype === rowsPrototype) {
            logger.debug("FriendsRows prototype is already patched; skipping duplicate start");
            return;
        }

        originalFilter = rowsPrototype.filter;
        patchedPrototype = rowsPrototype;
        logger.info("Captured original FriendsRows.filter from prototype", originalFilter);

        rowsPrototype.filter = function (section, searchQuery) {
            logger.debug("filter called", { section, searchQuery });

            const filteredRows = originalFilter?.call(this, section, searchQuery) ?? [];
            logger.debug("original filter result", { section, count: filteredRows.length });

            if (section === "ADD_FRIEND" || section === "PENDING" || section === "PENDING_IGNORED" || section === "SPAM" || section === "SUGGESTIONS") {
                logger.debug("non-friend-list section, returning original rows", { section });
                return filteredRows;
            }

            const applicationId = getSelectedApplicationId();
            logger.debug("current setting snapshot", { applicationId });

            if (!applicationId) {
                logger.debug("no application selected, returning original rows");
                return filteredRows;
            }

            const matchedRows = filteredRows.filter(row => {
                const activityApplicationIds = row.activities?.map(activity => activity.application_id).filter(Boolean);
                const matches = row.activities?.some(activity => activity.application_id === applicationId);

                logger.debug("row activity application ids", {
                    userId: row.userId,
                    activityApplicationIds
                });

                return matches;
            });

            logger.info("filtered rows for ONLINE section", {
                selectedApplicationId: applicationId,
                before: filteredRows.length,
                after: matchedRows.length
            });

            return matchedRows;
        };

        logger.info("Patched FriendsRows.filter");
    },

    stop() {
        logger.info("Stopping plugin");

        if (patchedPrototype && originalFilter) {
            patchedPrototype.filter = originalFilter;
            logger.info("Restored original FriendsRows.filter");
        } else {
            logger.debug("No active patch to restore");
        }

        originalFilter = null;
        patchedPrototype = null;
        logger.info("Cleared plugin state");
    }
});
