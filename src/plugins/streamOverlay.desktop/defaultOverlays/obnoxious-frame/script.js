/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The shapes are in index.html; this gives them their coordinates for the size of the screen and draws the mask of the
// ragged dark edge.
(() => {
    const THREADS = 7; // of a cobweb
    const RINGS = [0.2, 0.36, 0.54, 0.74, 1]; // of a cobweb, as fractions of its reach
    const MASK_WIDTH = 448; // px of the noise mask of the edge, which the browser scales up
    const EDGE_DELAY = 120; // ms to wait after a resize before drawing the mask again

    const root = document.documentElement;
    const $ = id => document.getElementById(id);
    const all = selector => [...document.querySelectorAll(selector)];

    const text = $("text");
    const skulls = all(".skull");
    const stars = all(".plate-star");
    const wingEls = all(".wing"); // left, then right

    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const fade = t => t * t * (3 - 2 * t);
    const num = v => +v.toFixed(1);
    const P = (x, y) => `${num(x)} ${num(y)}`;
    const at = p => P(p[0], p[1]);
    const path = (id, d) => $(id).setAttribute("d", d);
    // the same "random" numbers every time, so that the webs do not change when a setting does
    const rnd = (a, b) => {
        const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
        return s - Math.floor(s);
    };

    const setting = (name, fallback) => {
        const value = parseFloat(getComputedStyle(root).getPropertyValue(name));
        return Number.isFinite(value) ? value : fallback;
    };

    const qpt = (p0, c, p1, t) => [
        (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0],
        (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]
    ];

    // a bone: a curve that is `w0` wide at its start and `w1` at its end
    function taper(p0, c, p1, w0, w1, steps = 14) {
        const a = [];
        const b = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const [x, y] = qpt(p0, c, p1, t);
            const dx = 2 * (1 - t) * (c[0] - p0[0]) + 2 * t * (p1[0] - c[0]);
            const dy = 2 * (1 - t) * (c[1] - p0[1]) + 2 * t * (p1[1] - c[1]);
            const len = Math.hypot(dx, dy) || 1;
            const w = lerp(w0, w1, t) / 2;
            a.push([x - dy / len * w, y + dx / len * w]);
            b.push([x + dy / len * w, y - dx / len * w]);
        }
        return `M${a.map(at).join("L")}L${b.reverse().map(at).join("L")}Z`;
    }

    // a curl that starts at angle `a0` on a circle and winds inwards
    function spiral(cx, cy, R, a0, turns, dir, map) {
        const steps = Math.round(turns * 18);
        let d = "";
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const r = R * (1 - t * 0.9);
            const a = a0 + dir * t * turns * 2 * Math.PI;
            d += (i ? "L" : "M") + at(map([cx + Math.cos(a) * r, cy + Math.sin(a) * r]));
        }
        return d;
    }

    // a thorn on the line: base on it, tip pointing along (nx, ny) and bent `skew` along the line
    const spike = (x, y, ax, ay, nx, ny, w, n, skew = 0) => {
        const to = (a, b) => P(x + ax * a + nx * b, y + ay * a + ny * b);
        return `M${to(-w / 2, 0)}Q${to(-w * 0.15 + skew * 0.3, n * 0.45)} ${to(skew, n)}Q${to(w * 0.3 + skew * 0.3, n * 0.4)} ${to(w / 2, 0)}Z`;
    };

    // threads from a corner, and rings that sag between them
    function web(x0, y0, sx, sy, reach, hang) {
        const dir = i => {
            const a = i / (THREADS - 1) * Math.PI / 2;
            return [sx * Math.cos(a), sy * Math.sin(a)];
        };
        const spot = (i, f, j) => {
            const [dx, dy] = dir(i);
            const r = reach * f * (0.93 + 0.12 * rnd(i, j));
            return [x0 + dx * r, y0 + dy * r];
        };

        let d = "";
        for (let i = 0; i < THREADS; i++) d += `M${P(x0, y0)}L${at(spot(i, 1, 9))}`;
        RINGS.forEach((f, j) => {
            d += `M${at(spot(0, f, j))}`;
            for (let i = 1; i < THREADS; i++) {
                const a = spot(i - 1, f, j);
                const b = spot(i, f, j);
                const c = [lerp((a[0] + b[0]) / 2, x0, 0.2), lerp((a[1] + b[1]) / 2, y0, 0.2)];
                d += `Q${at(c)} ${at(b)}`;
            }
        });
        if (hang) {
            for (const i of [2, 4]) {
                const [x, y] = spot(i, 1, 9);
                d += `M${P(x, y)}q${num(sx * 2)} ${num(hang * 0.5)} ${num(-sx)} ${num(hang)}`;
            }
        }
        return d;
    }

    // an arm along the top, four fingers and a scalloped membrane between their tips
    function wing(s, L, ox, oy, depth, k) {
        const pt = (u, v) => [ox + s * u * L, oy + v * L];
        const S = pt(0, 0.02);
        const arm = pt(0.26, -0.005);
        const Wr = pt(0.5, 0.03);
        const S2 = pt(0, (depth + 6) / L);
        // [tip, bend, width]
        const fingers = [
            [pt(1, 0.1), pt(0.77, 0.005), 3.4],
            [pt(0.9, 0.28), pt(0.77, 0.12), 3.2],
            [pt(0.66, 0.33), pt(0.6, 0.18), 3],
            [pt(0.37, 0.25), pt(0.45, 0.13), 2.6]
        ];
        const sag = (a, b, f) => {
            const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            return [lerp(mid[0], Wr[0], f), lerp(mid[1], Wr[1], f)];
        };

        let membrane = `M${at(S)}Q${at(arm)} ${at(Wr)}Q${at(fingers[0][1])} ${at(fingers[0][0])}`;
        let veins = "";
        const edge = [...fingers.map(f => f[0]), S2];
        for (let i = 0; i < edge.length - 1; i++) {
            const c = sag(edge[i], edge[i + 1], i === edge.length - 2 ? 0.3 : 0.42);
            membrane += `Q${at(c)} ${at(edge[i + 1])}`;
            veins += `M${at(Wr)}L${at(qpt(edge[i], c, edge[i + 1], 0.5))}`;
        }
        membrane += "Z";

        const r = 3.2 * k;
        const bones = taper(S, arm, Wr, 5.5 * k, 3 * k) +
            fingers.map(([tip, bend, w]) => taper(Wr, bend, tip, w * k, 0.7 * k)).join("") +
            `M${P(Wr[0] - r, Wr[1])}a${num(r)} ${num(r)} 0 1 0 ${num(2 * r)} 0a${num(r)} ${num(r)} 0 1 0 ${num(-2 * r)} 0Z`;
        return { membrane, veins, bones };
    }

    function layout() {
        const W = innerWidth;
        const H = innerHeight;
        const m = Math.min(W, H);
        const unit = clamp(m / 1080, 0.8, 1.6);
        const inset = setting("--inset", 14);
        const size = setting("--size", 46);
        const wings = setting("--wings", 1);
        const lw = setting("--width", 1.6);

        const l = inset;
        const r = W - inset;
        const t = inset;
        const b = H - inset;
        const cx = W / 2;
        const rwTop = m * 0.15;
        const rwBottom = m * 0.115;

        const depth = Math.round(size + 10);
        const point = Math.round(depth * 0.9);
        const half = text.offsetWidth / 2 + size * 0.95;
        const hang = (h, y0, d, p) => {
            const y = y0 + d;
            return `L${P(cx - h, y)}C${P(cx - h * 0.5, y)} ${P(cx - h * 0.12, y + p * 0.35)} ${P(cx, y + p)}C${P(cx + h * 0.12, y + p * 0.35)} ${P(cx + h * 0.5, y)} ${P(cx + h, y)}`;
        };
        path("plate", `M${P(cx - half, t)}${hang(half, t, depth, point)}L${P(cx + half, t)}Z`);
        const hi = half - 7;
        path("plate-inner", `M${P(cx - hi, t + 7)}${hang(hi, t + 7, depth - 14, point - 1)}L${P(cx + hi, t + 7)}`);

        const side = text.offsetWidth / 2 + size * 0.5;
        const sc = clamp(size / 40, 0.7, 1.6);
        [-1, 1].forEach((s, i) => stars[i].setAttribute("transform", `translate(${P(cx + s * side, t + depth / 2)}) scale(${num(sc)})`));
        $("name").style.top = `${num(t + depth / 2 + size * 0.04)}px`;

        const winged = wings > 0.02;
        document.querySelector(".wings").style.display = winged ? "" : "none";
        if (winged) {
            const room = cx - half - t - rwTop * 0.9;
            const L = clamp(W * 0.235 * wings, 80, Math.max(80, room));
            const k = clamp(L / 560, 0.7, 1.4) * lw / 1.6;
            [-1, 1].forEach((s, i) => {
                const el = wingEls[i];
                const parts = wing(s, L, cx + s * half, t, depth, k);
                el.querySelector(".membrane").setAttribute("d", parts.membrane);
                el.querySelector(".veins").setAttribute("d", parts.veins);
                el.querySelector(".bones").setAttribute("d", parts.bones);
                el.style.transformOrigin = `${num(cx + s * half)}px ${num(t)}px`;
            });
        }

        path("webs",
            web(l, t, 1, 1, rwTop, 46 * unit) + web(r, t, -1, 1, rwTop, 46 * unit) +
            web(l, b, 1, -1, rwBottom, 0) + web(r, b, -1, -1, rwBottom, 0));

        const yStart = t + rwTop * 0.6;
        const yEnd = b - rwBottom * 0.62;
        const length = Math.max(1, yEnd - yStart);
        const halfWaves = Math.max(2, Math.round(length / (75 * unit)));
        const step = length / halfWaves;
        const xc = l + 26 * unit;
        const R = 9 * unit;
        // every half wave has its own amplitude, so that the vine does not look machined
        const amp = k => 11 * unit * (0.8 + 0.5 * rnd(k, 3));
        const ampAt = y => {
            const f = (y - yStart) / step - 0.5;
            const k = Math.floor(f);
            return lerp(amp(k), amp(k + 1), fade(f - k));
        };

        let stems = "";
        let curls = "";
        let thorns = "";
        let leaves = "";
        for (const mirror of [false, true]) {
            const X = x => mirror ? W - x : x;
            const pt = (x, y) => P(X(x), y);

            for (const phase of [1, -1]) {
                for (let y = yStart, i = 0; y <= yEnd + 0.1; y += 5, i++) {
                    const x = xc + phase * ampAt(y) * Math.sin(Math.PI * (y - yStart) / step);
                    stems += (i ? "L" : "M") + pt(x, y);
                }
            }

            for (let k = 0; k < halfWaves; k++) {
                const y = yStart + (k + 0.5) * step;
                const even = k % 2 === 0;
                const A = amp(k);
                // the curl hangs from whichever stem is on the inside here, the thorn from the other
                const Rk = R * (0.75 + 0.7 * rnd(k, 1));
                curls += spiral(xc + A + Rk, y, Rk, Math.PI, 1.5 + 0.75 * rnd(k, 2), even ? 1 : -1, ([x, yy]) => [X(x), yy]);
                thorns += spike(X(xc - A), y, 0, 1, mirror ? 1 : -1, 0, 4.5 * unit, (11 + 6 * rnd(k, 4)) * unit, (even ? 1 : -1) * 6 * unit);
            }

            for (let k = 0; k <= halfWaves; k++) {
                const y = yStart + k * step;
                const Ll = (12 + 8 * rnd(k, 5)) * unit;
                const Lw = 4.5 * unit;
                leaves += `M${pt(xc, y - Ll)}Q${pt(xc + Lw * 1.4, y)} ${pt(xc, y + Ll)}Q${pt(xc - Lw * 1.4, y)} ${pt(xc, y - Ll)}Z`;
                curls += `M${pt(xc, y - Ll * 0.7)}L${pt(xc, y + Ll * 0.7)}`;
            }

            const xs = l + 80 * unit;
            const yb = b - 14 * unit;
            const Lf = clamp(W * 0.13, 140, 300);
            const a = 9 * unit;
            const flourish = [
                [xs, yb], [xs + 0.12 * Lf, yb - a * 2.2], [xs + 0.24 * Lf, yb + a * 1.2], [xs + 0.36 * Lf, yb - a * 0.2],
                [xs + 0.48 * Lf, yb - a * 1.6], [xs + 0.6 * Lf, yb - a * 2], [xs + 0.72 * Lf, yb - a * 0.6]
            ];
            const end = flourish[6];
            const Rc = 14 * unit;
            curls += `M${pt(...flourish[0])}C${pt(...flourish[1])} ${pt(...flourish[2])} ${pt(...flourish[3])}S${pt(...flourish[5])} ${pt(...end)}`;
            curls += spiral(end[0], end[1] - Rc, Rc, Math.PI / 2, 1.6, -1, ([x, yy]) => [X(x), yy]);
            thorns += spike(X(xs + 0.36 * Lf), yb - a * 0.2, 0, 1, 0, -1, 5 * unit, 12 * unit);
        }
        path("vine", stems);
        path("vine-shade", stems + curls);
        path("curls", curls);
        path("thorns", thorns);
        path("leaves", leaves);

        const skullScale = (0.95 * unit).toFixed(2);
        skulls[0].setAttribute("transform", `translate(${P(l + 46 * unit, b - 46 * unit)}) rotate(-10) scale(${skullScale})`);
        skulls[1].setAttribute("transform", `translate(${P(r - 46 * unit, b - 46 * unit)}) rotate(10) scale(${skullScale})`);
    }

    const hash = (x, y, s) => {
        let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1274126177);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const value = (x, y, s) => {
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const fx = fade(x - xi);
        const fy = fade(y - yi);
        const a = hash(xi, yi, s);
        const b = hash(xi + 1, yi, s);
        const c = hash(xi, yi + 1, s);
        const d = hash(xi + 1, yi + 1, s);
        return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    };
    const fbm = (x, y, s) => {
        let v = 0;
        let amp = 0.5;
        let f = 1;
        for (let o = 0; o < 4; o++, amp /= 2, f *= 2) v += amp * value(x * f, y * f, s + o);
        return v / 0.9375;
    };

    // `shape(d, n)` -> alpha, from the distance to the edge of the screen (in pixels) and the noise there
    function mask(W, H, seed, freq, shape) {
        const w = MASK_WIDTH;
        const h = Math.max(1, Math.round(w * H / W));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const g = canvas.getContext("2d");
        const image = g.createImageData(w, h);
        const k = W / w;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const sx = (x + 0.5) * k;
                const sy = (y + 0.5) * k;
                const dx = Math.min(sx, W - sx);
                const dy = Math.min(sy, H - sy);
                // smaller than the nearest edge in the corners, which thickens them
                const d = dx * dy / (dx + dy);

                // the noise is bent by noise, which makes it wispy
                const u = x / w * freq;
                const v = y / w * freq;
                const n = fbm(u + 1.6 * fbm(u + 4.2, v + 1.3, seed + 9), v + 1.6 * fbm(u - 3.1, v + 7.7, seed + 19), seed);

                const i = (y * w + x) * 4;
                image.data[i] = image.data[i + 1] = image.data[i + 2] = 255;
                image.data[i + 3] = clamp(shape(d, n), 0, 1) * 255;
            }
        }
        g.putImageData(image, 0, 0);
        return `url(${canvas.toDataURL()})`;
    }

    let inkSize = "";
    function edge() {
        const W = innerWidth;
        const H = innerHeight;
        if (`${W}x${H}` === inkSize) return;
        inkSize = `${W}x${H}`;
        const m = Math.min(W, H);

        const ink = (d, n) => {
            const reach = m * 0.045 * (0.1 + 2.2 * (n - 0.2));
            const ragged = clamp((reach - d) / (m * 0.01), 0, 1);
            const soft = clamp(1 - d / (m * 0.09), 0, 1) ** 2 * 0.35;
            return Math.max(ragged, soft);
        };

        root.style.setProperty("--ink-mask", mask(W, H, 3, 9, ink));
        root.setAttribute("data-ink-ready", "");
    }

    let edgeTimer;
    const later = () => {
        clearTimeout(edgeTimer);
        edgeTimer = setTimeout(edge, EDGE_DELAY);
    };

    addEventListener("resize", () => {
        layout();
        later();
    });
    addEventListener("streamoverlay:settings", layout);
    // the name sets the width of the plate: place everything again when the font is there
    document.fonts.addEventListener("loadingdone", layout);
    document.fonts.load('700 46px "ObnoxiousGothic"').then(layout);
    layout();
    later();
})();
