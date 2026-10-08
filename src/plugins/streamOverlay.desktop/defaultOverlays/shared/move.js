/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Moves and resizes .board while MOVE_KEYS are held, and saves where it ended up (see the README).
(() => {
    const MOVE_KEYS = ["ALT", "CAPS"]; // "interactive" in overlay.json
    const MIN_SCALE = 0.6; // min / max of the "scale" setting in overlay.json
    const MAX_SCALE = 2;

    const root = document.documentElement;
    const board = document.querySelector(".board");
    const hint = document.querySelector(".hint");
    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

    let armed = false;
    let drag = null;
    let hintHeight = 0;
    let wantsMouse = false;

    // Overlays are stacked over the whole screen: the host only lets the mouse through to the one that has something to grab
    function updateCapture() {
        const on = root.classList.contains("hovered") || drag !== null;
        if (on === wantsMouse) return;
        wantsMouse = on;
        parent.postMessage({ type: "streamoverlay:capture", on }, "*");
    }

    function setVars(el, x, y, scale) {
        el.style.setProperty("--x", `${x}px`);
        el.style.setProperty("--y", `${y}px`);
        el.style.setProperty("--scale", scale);
    }

    // the hint sits above the board when it does not fit below (its size is constant, its gap scales with the board)
    function setFlip(bottom, scale) {
        hint.classList.toggle("flip", bottom + hintHeight + 12 * scale + 8 > innerHeight);
    }

    function placeHint() {
        const rect = board.getBoundingClientRect();
        hintHeight = hint.offsetHeight;
        setFlip(rect.bottom, rect.width / board.offsetWidth);
    }

    function setArmed(on) {
        if (on === armed) return;
        armed = on;
        root.classList.toggle("armed", on);
        placeHint();
        if (!on) endDrag();
    }

    // Dragging follows the pointer live: one update per frame, on variables of the board itself (so only it is restyled),
    // from sizes measured when the drag started. Nothing is saved before the release.
    function frame(d = drag) {
        if (!d) return;
        d.frame = 0;

        if (d.resize) {
            const fromX = (d.pointer.x - d.left) / d.width;
            const fromY = (d.bottom - d.pointer.y) / d.height;
            d.scale = clamp((fromX + fromY) / 2, MIN_SCALE, MAX_SCALE);
            d.x = d.left;
            d.y = Math.max(0, d.bottom - d.height * d.scale);
        } else {
            d.x = clamp(d.pointer.x - d.grabX, 0, innerWidth - d.width * d.scale);
            d.y = clamp(d.pointer.y - d.grabY, 0, innerHeight - d.height * d.scale);
        }

        setVars(board, d.x, d.y, d.scale);
        setFlip(d.y + d.height * d.scale, d.scale);
    }

    // the board's own variables hide the page's, so they only exist while dragging
    function clearBoardVars() {
        for (const name of ["--x", "--y", "--scale"]) board.style.removeProperty(name);
    }

    function endDrag() {
        if (!drag) return;
        const d = drag;
        drag = null;
        cancelAnimationFrame(d.frame);
        updateCapture();

        if (!d.moved) {
            clearBoardVars();
            if (d.previousPosition === undefined) delete root.dataset.position;
            else root.dataset.position = d.previousPosition;
            return;
        }

        frame(d);
        const values = { position: "custom", x: Math.round(d.x), y: Math.round(d.y), scale: +d.scale.toFixed(3) };
        setVars(root, values.x, values.y, values.scale);
        clearBoardVars();
        parent.postMessage({ type: "streamoverlay:save", values }, "*");
    }

    // the window ignores the mouse until the combo is held, so the cursor position is relayed instead of real hover events
    function setHovered(x, y) {
        const rect = board.getBoundingClientRect();
        const hovered = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        if (hovered === root.classList.contains("hovered")) return;

        root.classList.toggle("hovered", hovered);
        if (hovered) placeHint();
        updateCapture();
    }

    addEventListener("message", ({ source, data }) => {
        if (source !== parent) return;

        if (data?.type === "streamoverlay:keys") setArmed(MOVE_KEYS.every(key => data.down.includes(key)));
        else if (data?.type === "streamoverlay:pointer") setHovered(data.x, data.y);
    });

    board.addEventListener("pointerdown", e => {
        if (!armed || e.button !== 0) return;

        const rect = board.getBoundingClientRect();
        const width = board.offsetWidth;
        hintHeight = hint.offsetHeight;
        // the exact scale: the one derived from the (sub-pixel) rectangle would drift
        const scale = parseFloat(getComputedStyle(board).scale) || rect.width / width;

        drag = {
            id: e.pointerId,
            resize: !!e.target.closest(".resize"),
            pointer: { x: e.clientX, y: e.clientY },
            grabX: e.clientX - rect.left,
            grabY: e.clientY - rect.top,
            left: rect.left,
            bottom: rect.bottom,
            width,
            height: board.offsetHeight,
            scale,
            x: rect.left,
            y: rect.top,
            moved: false,
            frame: 0,
            previousPosition: root.dataset.position
        };

        root.dataset.position = "custom";
        setVars(board, rect.left, rect.top, scale);
        board.setPointerCapture(e.pointerId);
        updateCapture();
        e.preventDefault();
    });

    board.addEventListener("pointermove", e => {
        if (!drag || e.pointerId !== drag.id) return;

        drag.pointer = { x: e.clientX, y: e.clientY };
        drag.moved = true;
        drag.frame ||= requestAnimationFrame(() => frame());
    });

    board.addEventListener("pointerup", endDrag);
    board.addEventListener("pointercancel", endDrag);
})();
