// Blends the overlay (B8G8R8A8, premultiplied, any size) into frames in system memory (NV12, I420, YV12), stretching it over the
// frame like the GPU path does. The overlay is converted once to the frame's own format and size and cached, and a changed
// part of it is converted again alone, so that a frame costs only the area the overlay covers. No Windows headers: see
// test/yuvblend_test.cc.

#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <vector>

namespace yuvblend {

enum class Layout { NV12, I420, YV12 };

struct Frame {
    uint32_t width = 0, height = 0;
    bool bt709 = true;
    bool fullRange = false;
};

inline uint8_t clampByte(int v) { return static_cast<uint8_t>(v < 0 ? 0 : v > 255 ? 255 : v); }

inline void rgbToYuv(int r, int g, int b, bool bt709, bool full, uint8_t& y, uint8_t& u, uint8_t& v) {
    int Y, U, V;
    if (full) {
        if (bt709) {
            Y = (54 * r + 183 * g + 19 * b + 128) >> 8;
            U = ((-29 * r - 99 * g + 128 * b + 128) >> 8) + 128;
            V = ((128 * r - 116 * g - 12 * b + 128) >> 8) + 128;
        } else {
            Y = (77 * r + 150 * g + 29 * b + 128) >> 8;
            U = ((-43 * r - 85 * g + 128 * b + 128) >> 8) + 128;
            V = ((128 * r - 107 * g - 21 * b + 128) >> 8) + 128;
        }
    } else if (bt709) {
        Y = ((47 * r + 157 * g + 16 * b + 128) >> 8) + 16;
        U = ((-26 * r - 87 * g + 112 * b + 128) >> 8) + 128;
        V = ((112 * r - 102 * g - 10 * b + 128) >> 8) + 128;
    } else {
        Y = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
        U = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
        V = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
    }
    y = clampByte(Y);
    u = clampByte(U);
    v = clampByte(V);
}

inline uint8_t mix(uint8_t dst, uint8_t src, uint8_t a) { return static_cast<uint8_t>((dst * (255 - a) + src * a + 127) / 255); }

class Cache {
public:
    bool built() const { return built_; }
    bool empty() const { return !any_; }

    bool matches(const Frame& f, uint32_t ow, uint32_t oh) const {
        return built_ && ow == ow_ && oh == oh_ && (f.width & ~1u) == fw_ && (f.height & ~1u) == fh_ && f.bt709 == bt709_ && f.fullRange == full_;
    }

    void clear() {
        built_ = any_ = false;
    }

    void rebuild(const uint8_t* bgra, uint32_t ow, uint32_t oh, const Frame& f) {
        ow_ = ow; oh_ = oh;
        fw_ = f.width & ~1u; fh_ = f.height & ~1u;
        cw_ = fw_ / 2; ch_ = fh_ / 2;
        bt709_ = f.bt709; full_ = f.fullRange;
        built_ = fw_ >= 2 && fh_ >= 2 && ow_ && oh_;
        any_ = false;
        if (!built_) return;

        aY_.assign(static_cast<size_t>(fw_) * fh_, 0);
        yy_.assign(aY_.size(), 0);
        aC_.assign(static_cast<size_t>(cw_) * ch_, 0);
        uu_.assign(aC_.size(), 0);
        vv_.assign(aC_.size(), 0);
        ovLo_.assign(oh_, ow_);
        ovHi_.assign(oh_, 0);
        rowLo_.assign(fh_, 0);
        rowHi_.assign(fh_, 0);
        cRowLo_.assign(ch_, 0);
        cRowHi_.assign(ch_, 0);

        for (uint32_t y = 0; y < oh_; y++) scanOverlayRow(bgra, y);
        fill(bgra, 0, fw_, 0, fh_);
        spans(0, fh_, 0, ch_);
    }

    // the rectangle [l, r) x [t, b) of the overlay changed: convert only what it touches
    void update(const uint8_t* bgra, uint32_t l, uint32_t t, uint32_t r, uint32_t b) {
        if (!built_ || l >= r || t >= b || r > ow_ || b > oh_) return;

        for (uint32_t y = t; y < b; y++) scanOverlayRow(bgra, y);

        // one pixel more on each side: the area of a frame pixel in the overlay can reach into its neighbours
        const uint32_t x0 = static_cast<uint32_t>((std::max<int64_t>)(0, static_cast<int64_t>(static_cast<uint64_t>(l) * fw_ / ow_) - 1));
        const uint32_t x1 = static_cast<uint32_t>((std::min<uint64_t>)(fw_, (static_cast<uint64_t>(r) * fw_ + ow_ - 1) / ow_ + 1));
        const uint32_t y0 = static_cast<uint32_t>((std::max<int64_t>)(0, static_cast<int64_t>(static_cast<uint64_t>(t) * fh_ / oh_) - 1));
        const uint32_t y1 = static_cast<uint32_t>((std::min<uint64_t>)(fh_, (static_cast<uint64_t>(b) * fh_ + oh_ - 1) / oh_ + 1));
        fill(bgra, x0, x1, y0, y1);
        spans(y0, y1, y0 / 2, (std::min<uint32_t>)(ch_, (y1 + 1) / 2));
    }

    // scan0: the first line of the frame; lumaRows: how many lines the luma plane is laid out with (the chroma follows it)
    void blend(Layout layout, uint8_t* scan0, size_t pitch, uint32_t lumaRows) const {
        if (!built_ || !any_) return;

        for (uint32_t y = 0; y < fh_; y++) {
            const uint32_t lo = rowLo_[y], hi = rowHi_[y];
            if (lo >= hi) continue;
            uint8_t* d = scan0 + y * pitch;
            const uint8_t* a = &aY_[static_cast<size_t>(y) * fw_];
            const uint8_t* s = &yy_[static_cast<size_t>(y) * fw_];
            for (uint32_t x = lo; x < hi; x++)
                if (a[x]) d[x] = mix(d[x], s[x], a[x]);
        }

        uint8_t* chroma = scan0 + pitch * lumaRows;
        const size_t halfPitch = pitch / 2;
        uint8_t* u = chroma;
        uint8_t* v = chroma + halfPitch * (lumaRows / 2);
        if (layout == Layout::YV12) std::swap(u, v);

        for (uint32_t y = 0; y < ch_; y++) {
            const uint32_t lo = cRowLo_[y], hi = cRowHi_[y];
            if (lo >= hi) continue;
            const uint8_t* a = &aC_[static_cast<size_t>(y) * cw_];
            const uint8_t* su = &uu_[static_cast<size_t>(y) * cw_];
            const uint8_t* sv = &vv_[static_cast<size_t>(y) * cw_];

            if (layout == Layout::NV12) {
                uint8_t* d = chroma + y * pitch;
                for (uint32_t x = lo; x < hi; x++) {
                    if (!a[x]) continue;
                    d[2 * x] = mix(d[2 * x], su[x], a[x]);
                    d[2 * x + 1] = mix(d[2 * x + 1], sv[x], a[x]);
                }
            } else {
                uint8_t* du = u + y * halfPitch;
                uint8_t* dv = v + y * halfPitch;
                for (uint32_t x = lo; x < hi; x++) {
                    if (!a[x]) continue;
                    du[x] = mix(du[x], su[x], a[x]);
                    dv[x] = mix(dv[x], sv[x], a[x]);
                }
            }
        }
    }

private:
    struct Px { uint32_t a = 0; int r = 0, g = 0, b = 0; };

    // the average of a rectangle of the overlay: its alpha, and its colour with the alpha taken out again
    Px average(const uint8_t* bgra, uint32_t x0, uint32_t y0, uint32_t x1, uint32_t y1) const {
        uint64_t sb = 0, sg = 0, sr = 0, sa = 0;
        for (uint32_t y = y0; y < y1; y++) {
            const uint8_t* p = bgra + (static_cast<size_t>(y) * ow_ + x0) * 4;
            for (uint32_t x = x0; x < x1; x++, p += 4) {
                sb += p[0]; sg += p[1]; sr += p[2]; sa += p[3];
            }
        }
        Px out;
        if (!sa) return out;
        const uint64_t n = static_cast<uint64_t>(x1 - x0) * (y1 - y0);
        out.a = static_cast<uint32_t>((sa + n / 2) / n);
        out.r = (std::min<int>)(255, static_cast<int>((sr * 255 + sa / 2) / sa));
        out.g = (std::min<int>)(255, static_cast<int>((sg * 255 + sa / 2) / sa));
        out.b = (std::min<int>)(255, static_cast<int>((sb * 255 + sa / 2) / sa));
        return out;
    }

    void scanOverlayRow(const uint8_t* bgra, uint32_t y) {
        const uint32_t* p = reinterpret_cast<const uint32_t*>(bgra + static_cast<size_t>(y) * ow_ * 4);
        uint32_t lo = ow_, hi = 0;
        for (uint32_t x = 0; x < ow_; x++) {
            if (p[x]) {
                lo = x;
                break;
            }
        }
        if (lo < ow_) {
            for (uint32_t x = ow_; x-- > lo;) {
                if (p[x]) {
                    hi = x + 1;
                    break;
                }
            }
        }
        ovLo_[y] = lo;
        ovHi_[y] = hi;
    }

    // the columns of the overlay that have anything in the rows [oy0, oy1)
    bool overlayRange(uint32_t oy0, uint32_t oy1, uint32_t& lo, uint32_t& hi) const {
        lo = ow_;
        hi = 0;
        for (uint32_t y = oy0; y < oy1; y++) {
            lo = (std::min)(lo, ovLo_[y]);
            hi = (std::max)(hi, ovHi_[y]);
        }
        return lo < hi;
    }

    // converts the frame pixels [x0, x1) x [y0, y1) and the chroma pixels over them
    void fill(const uint8_t* bgra, uint32_t x0, uint32_t x1, uint32_t y0, uint32_t y1) {
        for (uint32_t fy = y0; fy < y1; fy++) {
            const uint32_t oy0 = static_cast<uint32_t>(static_cast<uint64_t>(fy) * oh_ / fh_);
            const uint32_t oy1 = (std::min<uint32_t>)(oh_, (std::max<uint32_t>)(oy0 + 1, static_cast<uint32_t>((static_cast<uint64_t>(fy + 1) * oh_ + fh_ - 1) / fh_)));
            uint32_t lo, hi;
            const bool any = overlayRange(oy0, oy1, lo, hi);
            const uint32_t flo = any ? static_cast<uint32_t>((std::max<int64_t>)(0, static_cast<int64_t>(static_cast<uint64_t>(lo) * fw_ / ow_) - 1)) : 0;
            const uint32_t fhi = any ? static_cast<uint32_t>((std::min<uint64_t>)(fw_, (static_cast<uint64_t>(hi) * fw_ + ow_ - 1) / ow_ + 1)) : 0;

            for (uint32_t fx = x0; fx < x1; fx++) {
                const size_t i = static_cast<size_t>(fy) * fw_ + fx;
                if (!any || fx < flo || fx >= fhi) {
                    aY_[i] = yy_[i] = 0;
                    continue;
                }
                const uint32_t ox0 = static_cast<uint32_t>(static_cast<uint64_t>(fx) * ow_ / fw_);
                const uint32_t ox1 = (std::min<uint32_t>)(ow_, (std::max<uint32_t>)(ox0 + 1, static_cast<uint32_t>((static_cast<uint64_t>(fx + 1) * ow_ + fw_ - 1) / fw_)));
                const Px px = average(bgra, ox0, oy0, ox1, oy1);
                aY_[i] = static_cast<uint8_t>(px.a);
                uint8_t y, u, v;
                rgbToYuv(px.r, px.g, px.b, bt709_, full_, y, u, v);
                yy_[i] = px.a ? y : 0;
            }
        }

        const uint32_t cx0 = x0 / 2, cx1 = (std::min<uint32_t>)(cw_, (x1 + 1) / 2);
        const uint32_t cy0 = y0 / 2, cy1 = (std::min<uint32_t>)(ch_, (y1 + 1) / 2);
        for (uint32_t cy = cy0; cy < cy1; cy++) {
            const uint32_t oy0 = static_cast<uint32_t>(static_cast<uint64_t>(2 * cy) * oh_ / fh_);
            const uint32_t oy1 = (std::min<uint32_t>)(oh_, (std::max<uint32_t>)(oy0 + 1, static_cast<uint32_t>((static_cast<uint64_t>(2 * cy + 2) * oh_ + fh_ - 1) / fh_)));
            uint32_t lo, hi;
            const bool any = overlayRange(oy0, oy1, lo, hi);
            const uint32_t flo = any ? static_cast<uint32_t>((std::max<int64_t>)(0, static_cast<int64_t>(static_cast<uint64_t>(lo) * fw_ / ow_) - 1)) / 2 : 0;
            const uint32_t fhi = any ? static_cast<uint32_t>((std::min<uint64_t>)(fw_, (static_cast<uint64_t>(hi) * fw_ + ow_ - 1) / ow_ + 1) + 1) / 2 : 0;

            for (uint32_t cx = cx0; cx < cx1; cx++) {
                const size_t i = static_cast<size_t>(cy) * cw_ + cx;
                if (!any || cx < flo || cx >= fhi) {
                    aC_[i] = uu_[i] = vv_[i] = 0;
                    continue;
                }
                const uint32_t ox0 = static_cast<uint32_t>(static_cast<uint64_t>(2 * cx) * ow_ / fw_);
                const uint32_t ox1 = (std::min<uint32_t>)(ow_, (std::max<uint32_t>)(ox0 + 1, static_cast<uint32_t>((static_cast<uint64_t>(2 * cx + 2) * ow_ + fw_ - 1) / fw_)));
                const Px px = average(bgra, ox0, oy0, ox1, oy1);
                aC_[i] = static_cast<uint8_t>(px.a);
                uint8_t y, u, v;
                rgbToYuv(px.r, px.g, px.b, bt709_, full_, y, u, v);
                uu_[i] = px.a ? u : 0;
                vv_[i] = px.a ? v : 0;
            }
        }
    }

    // the first and last column with anything in them, for the rows [y0, y1) of the frame and [cy0, cy1) of the chroma
    void spans(uint32_t y0, uint32_t y1, uint32_t cy0, uint32_t cy1) {
        for (uint32_t y = y0; y < y1; y++) rowSpan(&aY_[static_cast<size_t>(y) * fw_], fw_, rowLo_[y], rowHi_[y]);
        for (uint32_t y = cy0; y < cy1; y++) rowSpan(&aC_[static_cast<size_t>(y) * cw_], cw_, cRowLo_[y], cRowHi_[y]);

        any_ = false;
        for (uint32_t y = 0; y < fh_ && !any_; y++) any_ = rowLo_[y] < rowHi_[y];
    }

    static void rowSpan(const uint8_t* a, uint32_t n, uint32_t& lo, uint32_t& hi) {
        lo = n;
        hi = 0;
        for (uint32_t x = 0; x < n; x++) {
            if (a[x]) {
                lo = x;
                break;
            }
        }
        if (lo == n) {
            lo = hi = 0;
            return;
        }
        for (uint32_t x = n; x-- > lo;) {
            if (a[x]) {
                hi = x + 1;
                break;
            }
        }
    }

    bool built_ = false, any_ = false;
    uint32_t ow_ = 0, oh_ = 0, fw_ = 0, fh_ = 0, cw_ = 0, ch_ = 0;
    bool bt709_ = true, full_ = false;
    std::vector<uint8_t> aY_, yy_, aC_, uu_, vv_;
    std::vector<uint32_t> ovLo_, ovHi_, rowLo_, rowHi_, cRowLo_, cRowHi_;
};

}  // namespace yuvblend
