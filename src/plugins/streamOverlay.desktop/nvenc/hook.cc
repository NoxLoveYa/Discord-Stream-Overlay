// Hooks the encoders Discord uses for a screen share, NVENC and Windows' software H.264 encoder, and blends the overlay
// given to setOverlay() into every frame just before it is encoded. Loaded into Discord's renderer by main/nvenc.ts.
// Failures are logged to %TEMP%\streamoverlay-nvenc.log.

#include <windows.h>
#include <d3d11.h>
#include <d3dcompiler.h>
#include <dxgi.h>
#include <mfapi.h>
#include <mfobjects.h>
#include <mftransform.h>
#include <wrl/client.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

#include <ffnvcodec/nvEncodeAPI.h>

#include "MinHook.h"
#include "yuvblend.h"

namespace {

using Microsoft::WRL::ComPtr;

std::mutex g_mutex;
bool g_on = false;
bool g_nvInstalled = false;
bool g_mfInstalled = false;
std::atomic<bool> g_draw{false};
std::atomic<uint64_t> g_unknown{0};  // frames whose texture was never registered
std::atomic<uint64_t> g_encodes{0};   // frames given to an encoder while drawing was on
std::atomic<uint64_t> g_drawn{0};     // of those, the ones the overlay was blended into
std::string g_lastError;              // under g_mutex

std::mutex g_logMutex;

FILE* openLog() {
    wchar_t temp[MAX_PATH];
    GetTempPathW(MAX_PATH, temp);
    const std::wstring path = std::wstring(temp) + L"streamoverlay-nvenc.log";

    WIN32_FILE_ATTRIBUTE_DATA info;
    if (GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &info) && ((static_cast<unsigned long long>(info.nFileSizeHigh) << 32) | info.nFileSizeLow) > (1u << 20))
        MoveFileExW(path.c_str(), (path + L".old").c_str(), MOVEFILE_REPLACE_EXISTING);
    return _wfopen(path.c_str(), L"a");
}

void logf(const char* fmt, ...) {
    static FILE* file = nullptr;
    std::lock_guard lock(g_logMutex);
    if (!file) {
        file = openLog();
        if (!file) return;
    }
    char line[2048];
    va_list args;
    va_start(args, fmt);
    vsnprintf(line, sizeof line, fmt, args);
    va_end(args);
    fprintf(file, "[%llu] [%lu.%lu] %s\n", GetTickCount64(), GetCurrentProcessId(), GetCurrentThreadId(), line);
    fflush(file);
}

std::unordered_map<void*, void*> g_registered;  // registered handle -> Discord's D3D11 texture
std::unordered_map<void*, void*> g_mapped;      // mapped handle -> registered handle

std::string narrow(const wchar_t* wide) {
    if (!wide || !*wide) return {};
    const int size = WideCharToMultiByte(CP_UTF8, 0, wide, -1, nullptr, 0, nullptr, nullptr);
    std::string out(size > 1 ? size - 1 : 0, '\0');
    if (size > 1) WideCharToMultiByte(CP_UTF8, 0, wide, -1, out.data(), size, nullptr, nullptr);
    return out;
}

const char* vendorName(UINT id) {
    switch (id) {
        case 0x10DE: return "NVIDIA";
        case 0x1002: case 0x1022: return "AMD";
        case 0x8086: return "Intel";
        case 0x1414: return "Microsoft";
        default: return "other";
    }
}

std::string adapterLabel(IDXGIAdapter* adapter) {
    DXGI_ADAPTER_DESC d;
    if (!adapter || FAILED(adapter->GetDesc(&d))) return "unknown adapter";
    char luid[64];
    snprintf(luid, sizeof luid, " [%s luid %08lx:%08lx]", vendorName(d.VendorId), static_cast<unsigned long>(d.AdapterLuid.HighPart), static_cast<unsigned long>(d.AdapterLuid.LowPart));
    return narrow(d.Description) + luid;
}

std::string adapterOfDevice(void* device) {
    if (!device) return "no device";

    ComPtr<ID3D11Device> dev;
    ComPtr<IDXGIDevice> dxgi;
    ComPtr<IDXGIAdapter> adapter;
    if (FAILED(static_cast<IUnknown*>(device)->QueryInterface(__uuidof(ID3D11Device), reinterpret_cast<void**>(dev.GetAddressOf()))) ||
        FAILED(dev.As(&dxgi)) || FAILED(dxgi->GetAdapter(&adapter)))
        return "not a D3D11 device";
    return adapterLabel(adapter.Get());
}

std::string describeTexture(ID3D11Texture2D* texture) {
    D3D11_TEXTURE2D_DESC d;
    texture->GetDesc(&d);
    ComPtr<ID3D11Device> dev;
    texture->GetDevice(&dev);
    char text[160];
    snprintf(text, sizeof text, "%ux%u format=%u bind=0x%x misc=0x%x usage=%u", d.Width, d.Height, d.Format, d.BindFlags, d.MiscFlags, d.Usage);
    return std::string(text) + " on " + adapterOfDevice(dev.Get());
}

// Discord's textures belong to its own device: they are opened on ours through the shared handle and drawn on there.

ComPtr<ID3D11Device> g_dev;
ComPtr<ID3D11DeviceContext> g_ctx;
ComPtr<ID3D11Query> g_query;
ComPtr<ID3D11VertexShader> g_vs;
ComPtr<ID3D11PixelShader> g_ps;
ComPtr<ID3D11SamplerState> g_sampler;
ComPtr<ID3D11BlendState> g_blend;
ComPtr<ID3D11Texture2D> g_overlayTex;
ComPtr<ID3D11ShaderResourceView> g_overlaySrv;
uint32_t g_overlayW = 0, g_overlayH = 0;

// the part of the overlay that changed since it was last taken
struct Box {
    bool set = false;
    uint32_t l = 0, t = 0, r = 0, b = 0;

    void add(uint32_t x, uint32_t y, uint32_t w, uint32_t h) {
        if (!set) {
            l = x; t = y; r = x + w; b = y + h;
            set = true;
            return;
        }
        l = (std::min)(l, x); t = (std::min)(t, y);
        r = (std::max)(r, x + w); b = (std::max)(b, y + h);
    }
};

// the latest overlay (B8G8R8A8, premultiplied): always the whole picture, with what changed in it kept per consumer
std::vector<uint8_t> g_pending;
uint32_t g_pendingW = 0, g_pendingH = 0;
bool g_pendingDirty = false;
bool g_pendingFull = true;
Box g_box;

// the software encoder's copy of the overlay; g_yuvMutex is taken before g_mutex
yuvblend::Cache g_yuv;
std::mutex g_yuvMutex;
bool g_yuvFull = true;
Box g_yuvBox;

struct Opened {
    ComPtr<ID3D11Texture2D> tex;
    ComPtr<ID3D11RenderTargetView> rtv;
};
std::unordered_map<void*, Opened> g_opened;  // Discord's texture -> our view of it

const char* kShader = R"(
struct VSOut { float4 pos : SV_Position; float2 uv : TEXCOORD0; };
VSOut vs(uint id : SV_VertexID) {
    VSOut o;
    float2 uv = float2((id << 1) & 2, id & 2);
    o.pos = float4(uv * float2(2, -2) + float2(-1, 1), 0, 1);
    o.uv = uv;
    return o;
}
Texture2D tex : register(t0);
SamplerState smp : register(s0);
float4 ps(VSOut i) : SV_Target { return tex.Sample(smp, i.uv); }
)";

const char* compile(const char* entry, const char* target, ID3DBlob** out) {
    ComPtr<ID3DBlob> errors;
    if (FAILED(D3DCompile(kShader, strlen(kShader), nullptr, nullptr, nullptr, entry, target, 0, 0, out, &errors))) {
        if (errors) logf("shader error: %s", static_cast<const char*>(errors->GetBufferPointer()));
        return "shader compile failed";
    }
    return nullptr;
}

const char* ensureDevice(ID3D11Texture2D* theirs) {
    if (g_dev) return nullptr;

    ComPtr<ID3D11Device> device;
    theirs->GetDevice(&device);
    ComPtr<IDXGIDevice> dxgi;
    ComPtr<IDXGIAdapter> adapter;
    if (FAILED(device.As(&dxgi)) || FAILED(dxgi->GetAdapter(&adapter))) return "no adapter";

    ComPtr<ID3D11Device> dev;
    ComPtr<ID3D11DeviceContext> ctx;
    if (FAILED(D3D11CreateDevice(adapter.Get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr, 0, nullptr, 0, D3D11_SDK_VERSION, &dev, nullptr, &ctx)))
        return "D3D11CreateDevice failed";

    D3D11_QUERY_DESC query = { D3D11_QUERY_EVENT, 0 };
    if (FAILED(dev->CreateQuery(&query, &g_query))) return "CreateQuery failed";

    ComPtr<ID3DBlob> vs, ps;
    if (const char* error = compile("vs", "vs_4_0", &vs)) return error;
    if (const char* error = compile("ps", "ps_4_0", &ps)) return error;
    if (FAILED(dev->CreateVertexShader(vs->GetBufferPointer(), vs->GetBufferSize(), nullptr, &g_vs))) return "CreateVertexShader failed";
    if (FAILED(dev->CreatePixelShader(ps->GetBufferPointer(), ps->GetBufferSize(), nullptr, &g_ps))) return "CreatePixelShader failed";

    D3D11_SAMPLER_DESC sampler = {};
    sampler.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
    sampler.AddressU = sampler.AddressV = sampler.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
    if (FAILED(dev->CreateSamplerState(&sampler, &g_sampler))) return "CreateSamplerState failed";

    D3D11_BLEND_DESC blend = {};
    auto& target = blend.RenderTarget[0];
    target.BlendEnable = TRUE;
    target.SrcBlend = target.SrcBlendAlpha = D3D11_BLEND_ONE;
    target.DestBlend = target.DestBlendAlpha = D3D11_BLEND_INV_SRC_ALPHA;
    target.BlendOp = target.BlendOpAlpha = D3D11_BLEND_OP_ADD;
    target.RenderTargetWriteMask = D3D11_COLOR_WRITE_ENABLE_ALL;
    if (FAILED(dev->CreateBlendState(&blend, &g_blend))) return "CreateBlendState failed";

    g_dev = dev;
    g_ctx = ctx;
    return nullptr;
}

// false when there is nothing to draw
bool uploadOverlay() {
    std::lock_guard lock(g_mutex);
    if (g_pendingDirty) {
        g_pendingDirty = false;
        if (!g_pendingW) {
            g_overlayTex.Reset();
            g_overlaySrv.Reset();
            g_overlayW = g_overlayH = 0;
        } else {
            bool whole = g_pendingFull;
            if (!g_overlayTex || g_overlayW != g_pendingW || g_overlayH != g_pendingH) {
                whole = true;
                g_overlayTex.Reset();
                g_overlaySrv.Reset();
                D3D11_TEXTURE2D_DESC desc = {};
                desc.Width = g_pendingW;
                desc.Height = g_pendingH;
                desc.MipLevels = desc.ArraySize = 1;
                desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
                desc.SampleDesc.Count = 1;
                desc.Usage = D3D11_USAGE_DEFAULT;
                desc.BindFlags = D3D11_BIND_SHADER_RESOURCE;
                if (FAILED(g_dev->CreateTexture2D(&desc, nullptr, &g_overlayTex)) || FAILED(g_dev->CreateShaderResourceView(g_overlayTex.Get(), nullptr, &g_overlaySrv))) {
                    g_overlayTex.Reset();
                    g_overlaySrv.Reset();
                    g_overlayW = g_overlayH = 0;
                    logf("overlay texture %ux%u could not be created", g_pendingW, g_pendingH);
                    return false;
                }
                g_overlayW = g_pendingW;
                g_overlayH = g_pendingH;
            }
            if (whole) {
                g_ctx->UpdateSubresource(g_overlayTex.Get(), 0, nullptr, g_pending.data(), g_pendingW * 4, 0);
            } else if (g_box.set) {
                // on an immediate context the source pointer is where the box starts, the pitch is that of the whole picture
                D3D11_BOX box = { g_box.l, g_box.t, 0, g_box.r, g_box.b, 1 };
                g_ctx->UpdateSubresource(g_overlayTex.Get(), 0, &box, g_pending.data() + (static_cast<size_t>(g_box.t) * g_pendingW + g_box.l) * 4, g_pendingW * 4, 0);
            }
            g_pendingFull = false;
            g_box.set = false;
        }
    }
    return g_overlaySrv != nullptr;
}

const char* drawFrame(void* resource) {
    ComPtr<ID3D11Texture2D> theirs;
    if (FAILED(static_cast<IUnknown*>(resource)->QueryInterface(__uuidof(ID3D11Texture2D), reinterpret_cast<void**>(theirs.GetAddressOf()))))
        return "not a texture";

    D3D11_TEXTURE2D_DESC desc;
    theirs->GetDesc(&desc);
    const char* unusable = desc.Format != DXGI_FORMAT_B8G8R8A8_UNORM ? "not a B8G8R8A8 texture"
        : !(desc.MiscFlags & D3D11_RESOURCE_MISC_SHARED) ? "texture is not shared"
        : !(desc.BindFlags & D3D11_BIND_RENDER_TARGET) ? "texture is not a render target" : nullptr;
    if (unusable) {
        logf("cannot draw on the texture the stream is encoded from (%s): %s", unusable, describeTexture(theirs.Get()).c_str());
        return unusable;
    }

    if (const char* error = ensureDevice(theirs.Get())) return error;
    if (!uploadOverlay()) return nullptr;

    ID3D11RenderTargetView* rtv;
    {
        std::lock_guard lock(g_mutex);
        auto it = g_opened.find(resource);
        if (it == g_opened.end()) {
            ComPtr<IDXGIResource> dxgi;
            HANDLE handle = nullptr;
            if (FAILED(theirs.As(&dxgi)) || FAILED(dxgi->GetSharedHandle(&handle)) || !handle) return "no shared handle";

            Opened fresh;
            HRESULT hr = g_dev->OpenSharedResource(handle, __uuidof(ID3D11Texture2D), reinterpret_cast<void**>(fresh.tex.GetAddressOf()));
            if (FAILED(hr)) {
                logf("OpenSharedResource failed: hr=0x%08lx, the texture is %s, the overlay is drawn on %s", static_cast<unsigned long>(hr),
                    describeTexture(theirs.Get()).c_str(), adapterOfDevice(g_dev.Get()).c_str());
                return "OpenSharedResource failed";
            }
            hr = g_dev->CreateRenderTargetView(fresh.tex.Get(), nullptr, &fresh.rtv);
            if (FAILED(hr)) {
                logf("CreateRenderTargetView failed: hr=0x%08lx", static_cast<unsigned long>(hr));
                return "CreateRenderTargetView failed";
            }
            it = g_opened.emplace(resource, std::move(fresh)).first;
        }
        rtv = it->second.rtv.Get();
    }

    D3D11_VIEWPORT viewport = { 0, 0, static_cast<float>(desc.Width), static_cast<float>(desc.Height), 0, 1 };
    const float factor[4] = {};
    ID3D11SamplerState* sampler = g_sampler.Get();
    ID3D11ShaderResourceView* srv = g_overlaySrv.Get();

    g_ctx->OMSetRenderTargets(1, &rtv, nullptr);
    g_ctx->OMSetBlendState(g_blend.Get(), factor, 0xffffffff);
    g_ctx->RSSetViewports(1, &viewport);
    g_ctx->IASetInputLayout(nullptr);
    g_ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    g_ctx->VSSetShader(g_vs.Get(), nullptr, 0);
    g_ctx->PSSetShader(g_ps.Get(), nullptr, 0);
    g_ctx->PSSetSamplers(0, 1, &sampler);
    g_ctx->PSSetShaderResources(0, 1, &srv);
    g_ctx->Draw(3, 0);

    ID3D11ShaderResourceView* noSrv = nullptr;
    g_ctx->PSSetShaderResources(0, 1, &noSrv);
    g_ctx->OMSetRenderTargets(0, nullptr, nullptr);

    g_ctx->End(g_query.Get());
    g_ctx->Flush();
    for (ULONGLONG start = GetTickCount64(); g_ctx->GetData(g_query.Get(), nullptr, 0, 0) != S_OK;) {
        if (GetTickCount64() - start > 20) return "gpu did not finish in 20 ms";
        Sleep(0);
    }
    ++g_drawn;
    return nullptr;
}

// safeDraw and safeMfBlend use __try, so their bodies cannot hold C++ objects needing unwinding: the work is in helpers
void drawingFailed(const char* error) {
    g_draw = false;
    {
        std::lock_guard lock(g_mutex);
        g_lastError = error;
    }
    logf("drawing switched off: %s", error);
}

void safeDraw(void* resource) {
    const char* error = nullptr;
    __try {
        error = drawFrame(resource);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        error = "exception while drawing";
    }
    if (error) drawingFailed(error);
}

PNVENCREGISTERRESOURCE oRegister;
PNVENCUNREGISTERRESOURCE oUnregister;
PNVENCMAPINPUTRESOURCE oMap;
PNVENCUNMAPINPUTRESOURCE oUnmap;
PNVENCENCODEPICTURE oEncode;
NVENCSTATUS NVENCAPI hkRegister(void* encoder, NV_ENC_REGISTER_RESOURCE* p) {
    NVENCSTATUS st = oRegister(encoder, p);
    if (st == NV_ENC_SUCCESS && p && p->resourceType == NV_ENC_INPUT_RESOURCE_TYPE_DIRECTX) {
        std::lock_guard lock(g_mutex);
        g_registered[p->registeredResource] = p->resourceToRegister;
    }
    return st;
}

NVENCSTATUS NVENCAPI hkUnregister(void* encoder, NV_ENC_REGISTERED_PTR registered) {
    {
        std::lock_guard lock(g_mutex);
        auto it = g_registered.find(registered);
        if (it != g_registered.end()) {
            g_opened.erase(it->second);
            g_registered.erase(it);
        }
    }
    return oUnregister(encoder, registered);
}

NVENCSTATUS NVENCAPI hkMap(void* encoder, NV_ENC_MAP_INPUT_RESOURCE* p) {
    NVENCSTATUS st = oMap(encoder, p);
    if (st == NV_ENC_SUCCESS && p) {
        std::lock_guard lock(g_mutex);
        g_mapped[p->mappedResource] = p->registeredResource;
    }
    return st;
}

NVENCSTATUS NVENCAPI hkUnmap(void* encoder, NV_ENC_INPUT_PTR mapped) {
    {
        std::lock_guard lock(g_mutex);
        g_mapped.erase(mapped);
    }
    return oUnmap(encoder, mapped);
}

NVENCSTATUS NVENCAPI hkEncode(void* encoder, NV_ENC_PIC_PARAMS* p) {
    if (p && g_draw) {
        ++g_encodes;
        void* texture = nullptr;
        {
            std::lock_guard lock(g_mutex);
            auto mapped = g_mapped.find(p->inputBuffer);
            auto reg = g_registered.find(mapped != g_mapped.end() ? mapped->second : p->inputBuffer);
            if (reg != g_registered.end()) texture = reg->second;
        }
        if (texture) safeDraw(texture);
        else if (++g_unknown == 1) logf("an encoded frame was never registered: the stream started before the hook, restart it");
    }
    return oEncode(encoder, p);
}

const CLSID kH264EncoderMft = { 0x6ca50344, 0x051a, 0x4ded, { 0x97, 0x79, 0xa4, 0x33, 0x05, 0x16, 0x5e, 0x35 } };

using PProcessInput = HRESULT(STDMETHODCALLTYPE*)(IMFTransform*, DWORD, IMFSample*, DWORD);
using PCreateSample = HRESULT(WINAPI*)(IMFSample**);
using PCreate2DBuffer = HRESULT(WINAPI*)(DWORD, DWORD, DWORD, BOOL, IMFMediaBuffer**);

PProcessInput oProcessInput;
// looked up at run time: Windows N editions have no Media Foundation, and the addon must still load there
PCreateSample pCreateSample;
PCreate2DBuffer pCreate2DBuffer;

std::string g_mfProblem;  // under g_mutex

// logged once for every change
void mfProblem(const std::string& problem) {
    std::lock_guard lock(g_mutex);
    g_lastError = problem;
    if (problem == g_mfProblem) return;
    g_mfProblem = problem;
    logf("software encoder: cannot draw on the frames: %s", problem.c_str());
}

std::string fourcc(const GUID& subtype) {
    char text[40];
    const char* c = reinterpret_cast<const char*>(&subtype.Data1);
    if (isalnum(static_cast<unsigned char>(c[0])) && isalnum(static_cast<unsigned char>(c[1])) && isalnum(static_cast<unsigned char>(c[2])) && isalnum(static_cast<unsigned char>(c[3])))
        snprintf(text, sizeof text, "%c%c%c%c", c[0], c[1], c[2], c[3]);
    else
        snprintf(text, sizeof text, "{%08lx-...}", static_cast<unsigned long>(subtype.Data1));
    return text;
}

// A media buffer locked for the length of a scope, with the layout of the frame in it
struct LockedFrame {
    ComPtr<IMF2DBuffer> flat;
    ComPtr<IMF2DBuffer2> sized;
    ComPtr<IMFMediaBuffer> raw;
    BYTE* scan0 = nullptr;
    BYTE* start = nullptr;
    size_t pitch = 0;
    DWORD length = 0;

    LockedFrame() = default;
    LockedFrame(const LockedFrame&) = delete;
    LockedFrame& operator=(const LockedFrame&) = delete;
    ~LockedFrame() { unlock(); }

    bool lock2D(IMFMediaBuffer* buffer, MF2DBuffer_LockFlags flags) {
        LONG stride = 0;
        if (SUCCEEDED(buffer->QueryInterface(IID_PPV_ARGS(&sized))) && SUCCEEDED(sized->Lock2DSize(flags, &scan0, &stride, &start, &length))) {
            flat = sized;
        } else if (SUCCEEDED(buffer->QueryInterface(IID_PPV_ARGS(&flat))) && SUCCEEDED(flat->Lock2D(&scan0, &stride))) {
            start = scan0;
            buffer->GetCurrentLength(&length);
        } else {
            flat.Reset();
            sized.Reset();
            return false;
        }
        pitch = stride > 0 ? static_cast<size_t>(stride) : 0;
        return true;
    }

    bool lockRaw(IMFMediaBuffer* buffer, UINT32 stride) {
        BYTE* data = nullptr;
        if (FAILED(buffer->Lock(&data, nullptr, &length))) return false;
        raw = buffer;
        scan0 = start = data;
        pitch = stride;
        return true;
    }

    void unlock() {
        if (flat) flat->Unlock2D();
        else if (raw) raw->Unlock();
        flat.Reset();
        sized.Reset();
        raw.Reset();
    }

    // How many lines the luma plane is laid out with (the chroma plane or planes follow it), or 0 when the buffer does not
    // look like a frame of this size: the height, or the height rounded up as the system likes to pad it.
    uint32_t lumaRows(uint32_t w, uint32_t h) const {
        if (pitch < w || scan0 < start) return 0;

        uint32_t rows = 0;
        for (uint32_t candidate : { h, (h + 1) & ~1u, (h + 15) & ~15u }) {
            if (pitch * candidate * 3 / 2 == length) {
                rows = candidate;
                break;
            }
        }
        if (!rows && pitch * h * 3 / 2 <= length) rows = h;

        const size_t offset = static_cast<size_t>(scan0 - start);
        return rows && offset <= length && offset + pitch * rows * 3 / 2 <= length ? rows : 0;
    }
};

// plane by plane, line by line: the pitch of the two buffers differs
void copyFrame(yuvblend::Layout layout, const LockedFrame& from, uint32_t fromRows, LockedFrame& to, uint32_t toRows, uint32_t w, uint32_t h) {
    const uint32_t cw = (w + 1) / 2, ch = (h + 1) / 2;
    for (uint32_t y = 0; y < h; y++) memcpy(to.scan0 + y * to.pitch, from.scan0 + y * from.pitch, w);

    const BYTE* srcChroma = from.scan0 + from.pitch * fromRows;
    BYTE* dstChroma = to.scan0 + to.pitch * toRows;
    if (layout == yuvblend::Layout::NV12) {
        for (uint32_t y = 0; y < ch; y++) memcpy(dstChroma + y * to.pitch, srcChroma + y * from.pitch, static_cast<size_t>(cw) * 2);
        return;
    }
    for (uint32_t plane = 0; plane < 2; plane++) {
        const BYTE* srcPlane = srcChroma + (from.pitch / 2) * (fromRows / 2) * plane;
        BYTE* dstPlane = dstChroma + (to.pitch / 2) * (toRows / 2) * plane;
        for (uint32_t y = 0; y < ch; y++) memcpy(dstPlane + y * (to.pitch / 2), srcPlane + y * (from.pitch / 2), cw);
    }
}

// 1: `result` is the frame to give to the encoder instead; 0: give it the frame as it is (nothing to draw); -1: it cannot be drawn on
int mfBlend(IMFTransform* self, IMFSample* sample, IMFSample** result) {
    *result = nullptr;
    if (!pCreateSample || !pCreate2DBuffer) return -1;

    ComPtr<IMFMediaType> type;
    if (FAILED(self->GetInputCurrentType(0, &type))) return 0;

    GUID subtype = {};
    UINT32 w = 0, h = 0;
    if (FAILED(type->GetGUID(MF_MT_SUBTYPE, &subtype)) || FAILED(MFGetAttributeSize(type.Get(), MF_MT_FRAME_SIZE, &w, &h)) || !w || !h) return 0;

    yuvblend::Layout layout;
    if (subtype == MFVideoFormat_NV12) layout = yuvblend::Layout::NV12;
    else if (subtype == MFVideoFormat_IYUV || subtype == MFVideoFormat_I420) layout = yuvblend::Layout::I420;
    else if (subtype == MFVideoFormat_YV12) layout = yuvblend::Layout::YV12;
    else {
        mfProblem("the encoder is given " + fourcc(subtype) + " frames, which the overlay cannot be drawn on (only NV12, I420, YV12)");
        return -1;
    }

    // BT.709 from 720 lines up unless the type says otherwise
    const UINT32 matrix = MFGetAttributeUINT32(type.Get(), MF_MT_YUV_MATRIX, 0);
    yuvblend::Frame frame;
    frame.width = w;
    frame.height = h;
    frame.bt709 = matrix == MFVideoTransferMatrix_BT709 || (matrix != MFVideoTransferMatrix_BT601 && h >= 720);
    frame.fullRange = MFGetAttributeUINT32(type.Get(), MF_MT_VIDEO_NOMINAL_RANGE, 0) == MFNominalRange_0_255;

    std::lock_guard cacheLock(g_yuvMutex);
    {
        std::lock_guard lock(g_mutex);
        if (!g_pendingW || g_pending.size() < static_cast<size_t>(g_pendingW) * g_pendingH * 4) {
            g_yuv.clear();
            g_yuvFull = true;
            g_yuvBox.set = false;
            return 0;
        }
        if (g_yuvFull || !g_yuv.matches(frame, g_pendingW, g_pendingH))
            g_yuv.rebuild(g_pending.data(), g_pendingW, g_pendingH, frame);
        else if (g_yuvBox.set)
            g_yuv.update(g_pending.data(), g_yuvBox.l, g_yuvBox.t, g_yuvBox.r, g_yuvBox.b);
        g_yuvFull = false;
        g_yuvBox.set = false;
    }
    if (g_yuv.empty()) return 0;

    ComPtr<IMFMediaBuffer> buffer;
    DWORD count = 0;
    sample->GetBufferCount(&count);
    if (count == 1 ? FAILED(sample->GetBufferByIndex(0, &buffer)) : FAILED(sample->ConvertToContiguousBuffer(&buffer))) return 0;

    ComPtr<IMFDXGIBuffer> texture;
    if (SUCCEEDED(buffer.As(&texture))) {
        mfProblem("the frames are Direct3D textures, not memory");
        return -1;
    }

    LockedFrame src;
    if (!src.lock2D(buffer.Get(), MF2DBuffer_LockFlags_Read) && !src.lockRaw(buffer.Get(), MFGetAttributeUINT32(type.Get(), MF_MT_DEFAULT_STRIDE, w))) return 0;
    const uint32_t srcRows = src.lumaRows(w, h);
    if (!srcRows) {
        mfProblem("the layout of the frames is not one that is known: pitch " + std::to_string(src.pitch) + ", length " + std::to_string(src.length) + ", " + std::to_string(w) + "x" + std::to_string(h));
        return -1;
    }

    // the copy is in a buffer made for this format, whose lines have the pitch the system likes
    ComPtr<IMFMediaBuffer> copy;
    LockedFrame dst;
    if (FAILED(pCreate2DBuffer(w, h, subtype.Data1, FALSE, &copy)) || !dst.lock2D(copy.Get(), MF2DBuffer_LockFlags_Write)) return 0;
    const uint32_t dstRows = dst.lumaRows(w, h);
    if (!dstRows) {
        mfProblem("the layout of the copy of a frame is not one that is known: pitch " + std::to_string(dst.pitch) + ", length " + std::to_string(dst.length));
        return -1;
    }

    copyFrame(layout, src, srcRows, dst, dstRows, w, h);
    src.unlock();
    g_yuv.blend(layout, dst.scan0, dst.pitch, dstRows);

    DWORD contiguous = 0;
    dst.flat->GetContiguousLength(&contiguous);
    dst.unlock();
    copy->SetCurrentLength(contiguous);

    ComPtr<IMFSample> out;
    if (FAILED(pCreateSample(&out)) || FAILED(out->AddBuffer(copy.Get()))) return 0;
    sample->CopyAllItems(out.Get());
    LONGLONG time = 0, duration = 0;
    DWORD flags = 0;
    if (SUCCEEDED(sample->GetSampleTime(&time))) out->SetSampleTime(time);
    if (SUCCEEDED(sample->GetSampleDuration(&duration))) out->SetSampleDuration(duration);
    if (SUCCEEDED(sample->GetSampleFlags(&flags))) out->SetSampleFlags(flags);

    *result = out.Detach();
    return 1;
}

void mfFailed(const char* why) { mfProblem(why); }

int safeMfBlend(IMFTransform* self, IMFSample* sample, IMFSample** result) {
    __try {
        return mfBlend(self, sample, result);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        *result = nullptr;
        mfFailed("exception while drawing");
        return -1;
    }
}

HRESULT STDMETHODCALLTYPE hkProcessInput(IMFTransform* self, DWORD stream, IMFSample* sample, DWORD flags) {
    if (sample && g_draw) {
        ++g_encodes;
        IMFSample* drawn = nullptr;
        if (safeMfBlend(self, sample, &drawn) == 1 && drawn) {
            ++g_drawn;
            const HRESULT hr = oProcessInput(self, stream, drawn, flags);
            drawn->Release();
            return hr;
        }
    }
    return oProcessInput(self, stream, sample, flags);
}

template <class F>
bool hook(const char* name, F target, F detour, F* original) {
    if (!target) {
        logf("%s: not in the function list", name);
        return false;
    }
    MH_STATUS st = MH_CreateHook(reinterpret_cast<void*>(target), reinterpret_cast<void*>(detour), reinterpret_cast<void**>(original));
    if (st != MH_OK) {
        logf("%s: create hook failed: %s", name, MH_StatusToString(st));
        return false;
    }
    return true;
}

// "" when hooked, or why not
std::string installNvenc() {
    HMODULE nv = GetModuleHandleW(L"nvencodeapi64.dll");
    if (!nv) nv = LoadLibraryW(L"nvencodeapi64.dll");
    if (!nv) return "nvencodeapi64.dll is not available (no NVIDIA driver?)";

    auto create = reinterpret_cast<NVENCSTATUS(NVENCAPI*)(NV_ENCODE_API_FUNCTION_LIST*)>(GetProcAddress(nv, "NvEncodeAPICreateInstance"));
    if (!create) return "NvEncodeAPICreateInstance not found";

    NV_ENCODE_API_FUNCTION_LIST list = { NV_ENCODE_API_FUNCTION_LIST_VER };
    NVENCSTATUS st = create(&list);
    if (st != NV_ENC_SUCCESS) return "NvEncodeAPICreateInstance failed: " + std::to_string(st);

    bool all = hook("RegisterResource", list.nvEncRegisterResource, hkRegister, &oRegister);
    all &= hook("UnregisterResource", list.nvEncUnregisterResource, hkUnregister, &oUnregister);
    all &= hook("MapInputResource", list.nvEncMapInputResource, hkMap, &oMap);
    all &= hook("UnmapInputResource", list.nvEncUnmapInputResource, hkUnmap, &oUnmap);
    all &= hook("EncodePicture", list.nvEncEncodePicture, hkEncode, &oEncode);
    if (!all) return "could not hook the encoder";

    g_nvInstalled = true;
    return "";
}

// "" when hooked, or why not. Every instance of the encoder shares its code: one made here, only to read where ProcessInput is,
// is enough to hook them all.
std::string installMediaFoundation() {
    HMODULE mfplat = LoadLibraryW(L"mfplat.dll");
    if (!mfplat) return "Media Foundation is not available (mfplat.dll)";
    pCreateSample = reinterpret_cast<PCreateSample>(GetProcAddress(mfplat, "MFCreateSample"));
    pCreate2DBuffer = reinterpret_cast<PCreate2DBuffer>(GetProcAddress(mfplat, "MFCreate2DMediaBuffer"));
    if (!pCreateSample || !pCreate2DBuffer) return "Media Foundation has no MFCreateSample or MFCreate2DMediaBuffer";

    ComPtr<IMFTransform> mft;
    HRESULT hr = CoCreateInstance(kH264EncoderMft, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&mft));
    if (hr == CO_E_NOTINITIALIZED) {
        CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        hr = CoCreateInstance(kH264EncoderMft, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&mft));
    }
    if (FAILED(hr)) {
        char text[120];
        snprintf(text, sizeof text, "the H.264 encoder of Windows could not be created: 0x%08lx", static_cast<unsigned long>(hr));
        return text;
    }

    constexpr size_t kProcessInput = 24;  // index in the vtable: IUnknown has 3 methods, then IMFTransform's
    auto target = reinterpret_cast<PProcessInput>((*reinterpret_cast<void***>(mft.Get()))[kProcessInput]);

    // pinned so that the hook cannot outlive the code it is in
    HMODULE pinned = nullptr;
    GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN, reinterpret_cast<LPCWSTR>(target), &pinned);

    if (!hook("MFT ProcessInput", target, static_cast<PProcessInput>(hkProcessInput), &oProcessInput)) return "could not hook the H.264 encoder of Windows";
    g_mfInstalled = true;
    return "";
}

std::string start() {
    if (g_on) return "already on";

    MH_STATUS init = MH_Initialize();
    if (init != MH_OK && init != MH_ERROR_ALREADY_INITIALIZED) return std::string("MinHook: ") + MH_StatusToString(init);

    // either encoder is enough
    std::string nvError, mfError;
    if (!g_nvInstalled) {
        nvError = installNvenc();
        if (!nvError.empty()) logf("NVENC: %s", nvError.c_str());
    }
    if (!g_mfInstalled) {
        mfError = installMediaFoundation();
        if (!mfError.empty()) logf("software encoder: %s", mfError.c_str());
    }
    if (!g_nvInstalled && !g_mfInstalled) return nvError.empty() ? mfError : nvError;

    MH_STATUS en = MH_EnableHook(MH_ALL_HOOKS);
    if (en != MH_OK) return std::string("enable failed: ") + MH_StatusToString(en);

    g_on = true;
    return "on";
}

std::string draw(bool on) {
    if (on) {
        g_encodes = 0;
        g_drawn = 0;
        g_unknown = 0;
        std::lock_guard lock(g_mutex);
        g_lastError.clear();
        g_mfProblem.clear();
    }
    g_draw = on;
    return on ? (g_on ? "drawing on" : "the hooks are off: start them first") : "drawing off";
}

// What the hook did since drawing was switched on, as JSON: the plugin checks with it that the overlay reaches the stream.
std::string status() {
    std::string error;
    {
        std::lock_guard lock(g_mutex);
        error = g_lastError;
    }
    return std::string("{\"draw\":") + (g_draw ? "true" : "false") + ",\"encodes\":" + std::to_string(g_encodes.load()) +
        ",\"drawn\":" + std::to_string(g_drawn.load()) + ",\"unknown\":" + std::to_string(g_unknown.load()) +
        ",\"error\":\"" + error + "\"}";
}

void setOverlay(const uint8_t* data, size_t size, uint32_t width, uint32_t height) {
    std::lock_guard lock(g_mutex);
    if (!data || !width || !height || size < static_cast<size_t>(width) * height * 4) {
        g_pendingW = g_pendingH = 0;
    } else {
        g_pending.assign(data, data + static_cast<size_t>(width) * height * 4);
        g_pendingW = width;
        g_pendingH = height;
    }
    g_pendingFull = true;
    g_box.set = false;
    g_pendingDirty = true;
    g_yuvFull = true;
    g_yuvBox.set = false;
}

// false when the rectangle does not fit the last whole picture: a whole one has to be sent first

bool updateOverlay(const uint8_t* data, size_t size, uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t fullW, uint32_t fullH) {
    std::lock_guard lock(g_mutex);
    if (!w || !h || !g_pendingW || fullW != g_pendingW || fullH != g_pendingH ||
        static_cast<uint64_t>(x) + w > fullW || static_cast<uint64_t>(y) + h > fullH ||
        size < static_cast<size_t>(w) * h * 4 || g_pending.size() != static_cast<size_t>(fullW) * fullH * 4)
        return false;

    for (uint32_t row = 0; row < h; row++)
        memcpy(g_pending.data() + (static_cast<size_t>(y + row) * fullW + x) * 4, data + static_cast<size_t>(row) * w * 4, static_cast<size_t>(w) * 4);

    g_box.add(x, y, w, h);
    g_yuvBox.add(x, y, w, h);
    g_pendingDirty = true;
    return true;
}

// Node-API without node_api.h or an import library: the host is Discord.exe, not node.exe, so the functions are looked up in it
using napi_env = void*;
using napi_value = void*;
using napi_callback_info = void*;
using napi_callback = napi_value (*)(napi_env, napi_callback_info);

int (*napi_create_function)(napi_env, const char*, size_t, napi_callback, void*, napi_value*);
int (*napi_set_named_property)(napi_env, napi_value, const char*, napi_value);
int (*napi_create_string_utf8)(napi_env, const char*, size_t, napi_value*);
int (*napi_get_cb_info)(napi_env, napi_callback_info, size_t*, napi_value*, napi_value*, void**);
int (*napi_get_typedarray_info)(napi_env, napi_value, int*, size_t*, void**, napi_value*, size_t*);
int (*napi_get_value_uint32)(napi_env, napi_value, uint32_t*);

napi_value toJs(napi_env env, const std::string& s) {
    napi_value v = nullptr;
    napi_create_string_utf8(env, s.c_str(), s.size(), &v);
    return v;
}

napi_value jsStart(napi_env env, napi_callback_info) { return toJs(env, start()); }
napi_value jsDrawOn(napi_env env, napi_callback_info) { return toJs(env, draw(true)); }
napi_value jsDrawOff(napi_env env, napi_callback_info) { return toJs(env, draw(false)); }
napi_value jsStatus(napi_env env, napi_callback_info) { return toJs(env, status()); }

// setOverlay(bitmap, width, height): no arguments clears the overlay
napi_value jsSetOverlay(napi_env env, napi_callback_info info) {
    size_t argc = 3;
    napi_value argv[3] = {};
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != 0) return toJs(env, "bad call");

    int type = 0;
    size_t length = 0;
    void* data = nullptr;
    uint32_t width = 0, height = 0;
    if (argc < 3 || napi_get_typedarray_info(env, argv[0], &type, &length, &data, nullptr, nullptr) != 0 ||
        napi_get_value_uint32(env, argv[1], &width) != 0 || napi_get_value_uint32(env, argv[2], &height) != 0) {
        setOverlay(nullptr, 0, 0, 0);
        return toJs(env, "cleared");
    }
    setOverlay(static_cast<const uint8_t*>(data), length, width, height);
    return toJs(env, "ok");
}

// updateOverlay(bitmap, x, y, width, height, fullWidth, fullHeight): "ok", or "resync" when a whole picture is needed first
napi_value jsUpdateOverlay(napi_env env, napi_callback_info info) {
    size_t argc = 7;
    napi_value argv[7] = {};
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != 0 || argc < 7) return toJs(env, "bad call");

    int type = 0;
    size_t length = 0;
    void* data = nullptr;
    uint32_t n[6] = {};
    if (napi_get_typedarray_info(env, argv[0], &type, &length, &data, nullptr, nullptr) != 0) return toJs(env, "bad call");
    for (int i = 0; i < 6; i++)
        if (napi_get_value_uint32(env, argv[i + 1], &n[i]) != 0) return toJs(env, "bad call");

    return toJs(env, updateOverlay(static_cast<const uint8_t*>(data), length, n[0], n[1], n[2], n[3], n[4], n[5]) ? "ok" : "resync");
}

void expose(napi_env env, napi_value exports, const char* name, napi_callback fn) {
    napi_value f = nullptr;
    if (napi_create_function(env, name, SIZE_MAX, fn, nullptr, &f) == 0) napi_set_named_property(env, exports, name, f);
}

}  // namespace

extern "C" __declspec(dllexport) napi_value napi_register_module_v1(napi_env env, napi_value exports) {
    HMODULE host = GetModuleHandleW(nullptr);
#define RESOLVE(name) name = reinterpret_cast<decltype(name)>(GetProcAddress(host, #name)); if (!name) return exports
    RESOLVE(napi_create_function);
    RESOLVE(napi_set_named_property);
    RESOLVE(napi_create_string_utf8);
    RESOLVE(napi_get_cb_info);
    RESOLVE(napi_get_typedarray_info);
    RESOLVE(napi_get_value_uint32);
#undef RESOLVE

    expose(env, exports, "start", jsStart);
    expose(env, exports, "drawOn", jsDrawOn);
    expose(env, exports, "drawOff", jsDrawOff);
    expose(env, exports, "status", jsStatus);
    expose(env, exports, "setOverlay", jsSetOverlay);
    expose(env, exports, "updateOverlay", jsUpdateOverlay);
    return exports;
}

extern "C" __declspec(dllexport) int32_t node_api_module_get_api_version_v1() { return 8; }
