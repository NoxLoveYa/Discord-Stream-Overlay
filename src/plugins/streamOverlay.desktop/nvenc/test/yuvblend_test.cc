// Tests of yuvblend.h: `cmake --build build --target yuvblend_test --config Release`, then run build/Release/yuvblend_test.exe

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <random>

#include "../yuvblend.h"

using namespace yuvblend;

static int failures = 0;
#define CHECK(cond, ...) do { if (!(cond)) { failures++; printf("  FAIL %s:%d  ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

struct Img {
    uint32_t w, h, rows;  // rows: lines the luma plane is laid out with
    size_t pitch;
    Layout layout;
    std::vector<uint8_t> data;

    Img(uint32_t w, uint32_t h, Layout layout, uint32_t rows = 0, size_t pitch = 0)
        : w(w), h(h), rows(rows ? rows : h), pitch(pitch ? pitch : w), layout(layout), data(this->pitch * this->rows * 3 / 2, 0) {}

    uint8_t& y(uint32_t x, uint32_t yy) { return data[yy * pitch + x]; }
    uint8_t& u(uint32_t cx, uint32_t cy) {
        if (layout == Layout::NV12) return data[pitch * rows + cy * pitch + 2 * cx];
        const size_t half = pitch / 2, base = pitch * rows;
        return layout == Layout::I420 ? data[base + cy * half + cx] : data[base + half * (rows / 2) + cy * half + cx];
    }
    uint8_t& v(uint32_t cx, uint32_t cy) {
        if (layout == Layout::NV12) return data[pitch * rows + cy * pitch + 2 * cx + 1];
        const size_t half = pitch / 2, base = pitch * rows;
        return layout == Layout::I420 ? data[base + half * (rows / 2) + cy * half + cx] : data[base + cy * half + cx];
    }
    void blend(const Cache& c) { c.blend(layout, data.data(), pitch, rows); }
};

static void fillGray(Img& img, uint8_t y, uint8_t u, uint8_t v) {
    for (uint32_t j = 0; j < img.h; j++) for (uint32_t i = 0; i < img.w; i++) img.y(i, j) = y;
    for (uint32_t j = 0; j < img.h / 2; j++) for (uint32_t i = 0; i < img.w / 2; i++) { img.u(i, j) = u; img.v(i, j) = v; }
}

// premultiplied B8G8R8A8
static void rect(std::vector<uint8_t>& o, uint32_t ow, uint32_t x0, uint32_t y0, uint32_t x1, uint32_t y1, int r, int g, int b, int a) {
    for (uint32_t y = y0; y < y1; y++)
        for (uint32_t x = x0; x < x1; x++) {
            uint8_t* p = &o[(static_cast<size_t>(y) * ow + x) * 4];
            p[0] = static_cast<uint8_t>(b * a / 255); p[1] = static_cast<uint8_t>(g * a / 255); p[2] = static_cast<uint8_t>(r * a / 255); p[3] = static_cast<uint8_t>(a);
        }
}

static void exactValues() {
    printf("1. exact values: 50%% red over gray, NV12, BT.709 limited range\n");
    const uint32_t ow = 640, oh = 360;
    std::vector<uint8_t> overlay(static_cast<size_t>(ow) * oh * 4, 0);
    rect(overlay, ow, 100, 50, 300, 150, 255, 0, 0, 128);

    Frame f{ 320, 180, true, false };
    Cache c;
    c.rebuild(overlay.data(), ow, oh, f);
    CHECK(c.built() && !c.empty(), "cache is built and has something");

    Img img(320, 180, Layout::NV12);
    fillGray(img, 100, 128, 128);
    Img before = img;
    img.blend(c);

    uint8_t ry, ru, rv;
    rgbToYuv(255, 0, 0, true, false, ry, ru, rv);
    // inside (overlay 100..300 x 50..150 is frame 50..150 x 25..75)
    CHECK(img.y(100, 50) == mix(100, ry, 128), "luma inside: %d, wanted %d", img.y(100, 50), mix(100, ry, 128));
    CHECK(img.u(50, 25) == mix(128, ru, 128) && img.v(50, 25) == mix(128, rv, 128), "chroma inside: %d %d, wanted %d %d", img.u(50, 25), img.v(50, 25), mix(128, ru, 128), mix(128, rv, 128));
    CHECK(ry > 16 && ru < 128 && rv > 128, "red is below grey in blue and above in red (%d %d %d)", ry, ru, rv);

    size_t changed = 0;
    for (size_t i = 0; i < img.data.size(); i++) changed += img.data[i] != before.data[i];
    // the rectangle starts on an odd line (25) and ends on one (75): its first and last line of chroma are half covered, which
    // makes 26 lines of chroma instead of 25
    const size_t wanted = 100 * 50 + 2 * 50 * 26;
    printf("   %zu of %zu bytes changed (a rectangle of 100x50 luma + 50x26 chroma pixels = %zu)\n", changed, img.data.size(), wanted);
    CHECK(changed == wanted, "only the rectangle changes");
    CHECK(img.y(49, 50) == 100 && img.y(150, 50) == 100 && img.y(100, 24) == 100 && img.y(100, 75) == 100, "pixels just outside the rectangle are untouched");

    // full alpha replaces, zero alpha leaves
    rect(overlay, ow, 400, 200, 440, 240, 0, 255, 0, 255);
    c.rebuild(overlay.data(), ow, oh, f);
    Img img2(320, 180, Layout::NV12);
    fillGray(img2, 100, 128, 128);
    img2.blend(c);
    uint8_t gy, gu, gv;
    rgbToYuv(0, 255, 0, true, false, gy, gu, gv);
    CHECK(img2.y(210, 110) == gy && img2.u(105, 55) == gu && img2.v(105, 55) == gv, "opaque green replaces: %d wanted %d", img2.y(210, 110), gy);
}

static bool same(const Img& a, const Img& b) { return a.data == b.data; }

static void updateEqualsRebuild(uint32_t ow, uint32_t oh, uint32_t fw, uint32_t fh, unsigned seed) {
    printf("   overlay %ux%u over a frame of %ux%u\n", ow, oh, fw, fh);
    std::mt19937 rng(seed);
    std::vector<uint8_t> overlay(static_cast<size_t>(ow) * oh * 4, 0);
    Frame f{ fw, fh, true, false };
    Cache incremental;
    incremental.rebuild(overlay.data(), ow, oh, f);

    for (int step = 0; step < 40; step++) {
        const uint32_t x0 = rng() % ow, y0 = rng() % oh;
        const uint32_t x1 = std::min<uint32_t>(ow, x0 + 1 + rng() % 120), y1 = std::min<uint32_t>(oh, y0 + 1 + rng() % 60);
        if (rng() % 4 == 0) {
            for (uint32_t y = y0; y < y1; y++) memset(&overlay[(static_cast<size_t>(y) * ow + x0) * 4], 0, (x1 - x0) * 4);  // erase
        } else {
            rect(overlay, ow, x0, y0, x1, y1, rng() % 256, rng() % 256, rng() % 256, 1 + rng() % 255);
        }
        incremental.update(overlay.data(), x0, y0, x1, y1);

        Cache fresh;
        fresh.rebuild(overlay.data(), ow, oh, f);
        Img a(fw, fh, Layout::NV12), b(fw, fh, Layout::NV12);
        for (size_t i = 0; i < a.data.size(); i++) a.data[i] = b.data[i] = static_cast<uint8_t>(rng());
        a.blend(incremental);
        b.blend(fresh);
        if (!same(a, b)) {
            CHECK(false, "after step %d the updated cache differs from a rebuilt one", step);
            return;
        }
        CHECK(incremental.empty() == fresh.empty(), "emptiness agrees at step %d", step);
    }
}

static void layouts() {
    printf("3. the layouts agree, also with padded lines\n");
    const uint32_t ow = 300, oh = 200, fw = 160, fh = 90;
    std::vector<uint8_t> overlay(static_cast<size_t>(ow) * oh * 4, 0);
    rect(overlay, ow, 20, 20, 200, 120, 200, 80, 30, 200);
    Frame f{ fw, fh, false, true };
    Cache c;
    c.rebuild(overlay.data(), ow, oh, f);

    Img nv(fw, fh, Layout::NV12), i4(fw, fh, Layout::I420), yv(fw, fh, Layout::YV12);
    for (uint32_t j = 0; j < fh; j++) for (uint32_t i = 0; i < fw; i++) nv.y(i, j) = i4.y(i, j) = yv.y(i, j) = static_cast<uint8_t>(i * 3 + j);
    for (uint32_t j = 0; j < fh / 2; j++) for (uint32_t i = 0; i < fw / 2; i++) {
        const uint8_t u = static_cast<uint8_t>(i + 7 * j), v = static_cast<uint8_t>(200 - i + j);
        nv.u(i, j) = i4.u(i, j) = yv.u(i, j) = u;
        nv.v(i, j) = i4.v(i, j) = yv.v(i, j) = v;
    }
    nv.blend(c); i4.blend(c); yv.blend(c);
    bool equal = true;
    for (uint32_t j = 0; j < fh; j++) for (uint32_t i = 0; i < fw; i++) equal &= nv.y(i, j) == i4.y(i, j) && i4.y(i, j) == yv.y(i, j);
    for (uint32_t j = 0; j < fh / 2; j++) for (uint32_t i = 0; i < fw / 2; i++) equal &= nv.u(i, j) == i4.u(i, j) && i4.u(i, j) == yv.u(i, j) && nv.v(i, j) == i4.v(i, j) && i4.v(i, j) == yv.v(i, j);
    CHECK(equal, "NV12, I420 and YV12 give the same picture");

    // padded: 90 lines laid out as 96, lines of 192 bytes
    Img padded(fw, fh, Layout::NV12, 96, 192);
    for (uint32_t j = 0; j < fh; j++) for (uint32_t i = 0; i < fw; i++) padded.y(i, j) = static_cast<uint8_t>(i * 3 + j);
    for (uint32_t j = 0; j < fh / 2; j++) for (uint32_t i = 0; i < fw / 2; i++) { padded.u(i, j) = static_cast<uint8_t>(i + 7 * j); padded.v(i, j) = static_cast<uint8_t>(200 - i + j); }
    padded.blend(c);
    bool eq2 = true;
    for (uint32_t j = 0; j < fh; j++) for (uint32_t i = 0; i < fw; i++) eq2 &= padded.y(i, j) == nv.y(i, j);
    for (uint32_t j = 0; j < fh / 2; j++) for (uint32_t i = 0; i < fw / 2; i++) eq2 &= padded.u(i, j) == nv.u(i, j) && padded.v(i, j) == nv.v(i, j);
    CHECK(eq2, "a padded frame gets the same picture");

    // BT.601 and BT.709 are not the same colour
    Frame f601{ fw, fh, false, true }, f709{ fw, fh, true, true };
    Cache c601, c709;
    c601.rebuild(overlay.data(), ow, oh, f601);
    c709.rebuild(overlay.data(), ow, oh, f709);
    Img p(fw, fh, Layout::NV12), q(fw, fh, Layout::NV12);
    fillGray(p, 90, 128, 128); fillGray(q, 90, 128, 128);
    p.blend(c601); q.blend(c709);
    CHECK(!same(p, q), "the matrix makes a difference");
}

static void edgeCases() {
    printf("4. edges\n");
    Frame f{ 64, 48, true, false };
    Cache c;
    std::vector<uint8_t> none(32 * 24 * 4, 0);
    c.rebuild(none.data(), 32, 24, f);
    CHECK(c.built() && c.empty(), "a transparent overlay has nothing to draw");
    Img img(64, 48, Layout::NV12);
    fillGray(img, 77, 100, 150);
    Img before = img;
    img.blend(c);
    CHECK(same(img, before), "and changes nothing");

    // an overlay smaller than the frame (2 px over 64): every frame pixel has a source
    std::vector<uint8_t> tiny(2 * 2 * 4, 0);
    rect(tiny, 2, 0, 0, 1, 1, 255, 255, 255, 255);
    c.rebuild(tiny.data(), 2, 2, f);
    img = before;
    img.blend(c);
    CHECK(img.y(0, 0) == 235 && img.y(31, 23) == 235 && img.y(32, 0) == 77 && img.y(0, 24) == 77, "upscaling: the top left quarter is white (%d %d %d %d)", img.y(0, 0), img.y(31, 23), img.y(32, 0), img.y(0, 24));

    // an odd frame size loses its last line and column, nothing more
    Frame odd{ 63, 47, true, false };
    c.rebuild(none.data(), 32, 24, odd);
    CHECK(c.built(), "odd sizes are rounded down");
    Frame tiny2{ 1, 1, true, false };
    c.rebuild(none.data(), 32, 24, tiny2);
    CHECK(!c.built(), "a 1x1 frame is refused");
    CHECK(!c.matches(f, 32, 24), "and does not match another frame");
}

static void speed() {
    printf("5. speed (2560x1440 overlay with a keyboard-sized part, 1280x720 NV12)\n");
    const uint32_t ow = 2560, oh = 1440;
    std::vector<uint8_t> overlay(static_cast<size_t>(ow) * oh * 4, 0);
    rect(overlay, ow, 900, 1250, 1700, 1420, 40, 40, 60, 200);
    rect(overlay, ow, 40, 40, 700, 160, 30, 215, 96, 230);
    Frame f{ 1280, 720, true, false };
    using clock = std::chrono::steady_clock;
    Cache c;
    auto t0 = clock::now();
    c.rebuild(overlay.data(), ow, oh, f);
    auto t1 = clock::now();
    Img img(1280, 720, Layout::NV12);
    fillGray(img, 100, 128, 128);
    const int n = 200;
    auto t2 = clock::now();
    for (int i = 0; i < n; i++) img.blend(c);
    auto t3 = clock::now();
    c.update(overlay.data(), 1000, 1300, 1100, 1350);
    auto t4 = clock::now();
    const auto us = [](auto a, auto b) { return std::chrono::duration_cast<std::chrono::microseconds>(b - a).count(); };
    printf("   full rebuild %lld us, a frame %lld us, a 100x50 update %lld us\n", static_cast<long long>(us(t0, t1)), static_cast<long long>(us(t2, t3)) / n, static_cast<long long>(us(t3, t4)));
}

int main() {
    exactValues();

    printf("2. an updated cache equals a rebuilt one\n");
    updateEqualsRebuild(640, 360, 320, 180, 1);     // 2:1
    updateEqualsRebuild(1536, 864, 1280, 720, 2);   // 1.2:1, not a whole number
    updateEqualsRebuild(2560, 1440, 1920, 1080, 3); // 4:3
    updateEqualsRebuild(100, 60, 200, 120, 4);      // upscaling
    updateEqualsRebuild(333, 211, 160, 90, 5);      // odd overlay

    layouts();
    edgeCases();
    speed();

    printf(failures ? "\n%d FAILED\n" : "\nall ok\n", failures);
    return failures ? 1 : 0;
}
