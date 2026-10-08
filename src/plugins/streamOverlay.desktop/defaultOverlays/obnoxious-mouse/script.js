/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Mouse movement and wheel, from the "streamoverlay:mouse" messages ({ dx, dy, wheel }: what happened since the last one).
(() => {
    const GAIN = 0.18; // px of push per counted unit of movement, at sensitivity 1
    const RETURN = 0.18; // s: how fast the push fades, so the dot drifts back to the center
    const FOLLOW = [0.03, 0.08, 0.14]; // s: how closely each dot follows the one before it (the first follows the push)
    const NOTCH = 120; // wheel units per notch
    const NOTCH_PX = 14; // how far the roller turns per notch
    const WHEEL_FOLLOW = 0.07; // s: how smoothly the roller catches up with the wheel
    const FULL_SPIN = 420; // px/s of roller speed that lights the wheel completely

    const pad = document.querySelector(".pad");
    const dots = [...pad.querySelectorAll(".dot")];
    const wheel = document.querySelector(".wheel");
    const ribs = wheel.querySelector(".ribs");
    const rib = parseFloat(getComputedStyle(ribs).getPropertyValue("--rib"));
    const reach = pad.offsetWidth / 2 - 22;

    let sensitivity = 1;
    const push = { x: 0, y: 0 };
    const shown = dots.map(() => ({ x: 0, y: 0 }));
    let rolling = 0; // where the wheel wants the roller to be
    let rolled = 0; // where the roller is
    let last = 0;
    let frame = 0;

    function tick(now) {
        frame = 0;
        const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60;
        last = now;

        const decay = Math.exp(-dt / RETURN);
        push.x *= decay;
        push.y *= decay;
        // the distance is squashed, so a fast flick still stays inside the pad
        const length = Math.hypot(push.x, push.y);
        const squash = length ? reach * Math.tanh(length / reach) / length : 0;

        let target = { x: push.x * squash, y: push.y * squash };
        let moving = length > 0.05;
        dots.forEach((dot, i) => {
            const at = shown[i];
            const k = 1 - Math.exp(-dt / FOLLOW[i]);
            at.x += (target.x - at.x) * k;
            at.y += (target.y - at.y) * k;
            dot.style.transform = `translate(${at.x}px, ${at.y}px)`;
            moving ||= Math.hypot(at.x, at.y) > 0.05;
            target = at;
        });

        const step = (rolling - rolled) * (1 - Math.exp(-dt / WHEEL_FOLLOW));
        rolled += step;
        const turning = Math.abs(rolling - rolled) > 0.05;
        const spin = turning ? Math.min(1, Math.abs(step / dt) / FULL_SPIN) : 0;
        ribs.style.transform = `translateY(${-(rolled % rib)}px)`;
        wheel.style.setProperty("--spin", spin.toFixed(3));
        wheel.dataset.dir = spin > 0.05 ? (step > 0 ? "up" : "down") : "";

        if (moving || turning) {
            frame = requestAnimationFrame(tick);
        } else {
            // nothing is moving: stop drawing until the next message, and keep the numbers small
            const whole = Math.trunc(rolled / rib) * rib;
            rolled -= whole;
            rolling -= whole;
            last = 0;
        }
    }

    addEventListener("message", ({ source, data }) => {
        if (source !== parent || data?.type !== "streamoverlay:mouse") return;

        push.x += (Number(data.dx) || 0) * GAIN * sensitivity;
        push.y += (Number(data.dy) || 0) * GAIN * sensitivity;
        rolling += (Number(data.wheel) || 0) / NOTCH * NOTCH_PX;
        frame ||= requestAnimationFrame(tick);
    });

    addEventListener("streamoverlay:settings", ({ detail }) => {
        sensitivity = detail.sensitivity ?? 1;
    });
})();
