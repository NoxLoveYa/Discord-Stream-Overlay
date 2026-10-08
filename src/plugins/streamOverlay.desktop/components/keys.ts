/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { KeyboardEvent } from "react";

// Escape is stopped here so that it only cancels the field, not whatever is open behind it
export const submitOrCancel = (submit: () => void, cancel: () => void) => (e: KeyboardEvent) => {
    if (e.key === "Enter") submit();
    else if (e.key === "Escape") {
        e.stopPropagation();
        cancel();
    }
};
