// Hooks Discord's NVENC encoder. While drawing is on, every frame is blended with the bitmap given to setOverlay() just
// before it is encoded, so the overlay is in the stream and not on the screen. Failures go to %TEMP%\streamoverlay-nvenc.log.
// Loaded into Discord's renderer process by the preload script of main/nvenc.ts.

#include <windows.h>
#include <tlhelp32.h>
#include <d3d11.h>
#include <d3dcompiler.h>
#include <dxgi.h>
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

namespace {

using Microsoft::WRL::ComPtr;

std::mutex g_mutex;
bool g_on = false;
bool g_installed = false;
std::atomic<bool> g_draw{false};
std::atomic<uint64_t> g_unknown{0};  // frames whose texture was never seen being registered
std::atomic<uint64_t> g_encodes{0};  // frames NVENC was given while drawing was on
std::atomic<uint64_t> g_drawn{0};    // of those, the ones the overlay was blended into
std::string g_lastError;             // why drawing was switched off (under g_mutex)

std::mutex g_logMutex;

// A log that grew past 1 MB is kept as .old (once) and a new one is started
FILE* openLog() {
    wchar_t temp[MAX_PATH];
    GetTempPathW(MAX_PATH, temp);
    const std::wstring path = std::wstring(temp) + L"streamoverlay-nvenc.log";

    WIN32_FILE_ATTRIBUTE_DATA info;
    if (GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &info) && ((static_cast<unsigned long long>(info.nFileSizeHigh) << 32) | info.nFileSizeLow) > (1u << 20))
        MoveFileExW(path.c_str(), (path + L".old").c_str(), MOVEFILE_REPLACE_EXISTING);
    return _wfopen(path.c_str(), L"a");
}

// [ticks] [process.thread] message
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

// NVENC is given a mapped handle per frame; the texture behind it was registered earlier
std::unordered_map<void*, void*> g_registered;  // registered handle -> Discord's D3D11 texture
std::unordered_map<void*, void*> g_mapped;      // mapped handle -> registered handle

// ---- what this machine and these streams look like (for the log and for diagnose()) -----------------------------------

// an encoder session: how Discord opened and set it up, and what went through it
struct Session {
    int deviceType = -1;
    uint32_t apiVersion = 0;
    std::string adapter;
    std::string codec;
    uint32_t width = 0, height = 0, fpsNum = 0, fpsDen = 0;
    uint64_t encodes = 0, drawn = 0, unknown = 0;
};
std::unordered_map<void*, Session> g_sessions;  // encoder handle -> its session (under g_mutex)

std::string narrow(const wchar_t* wide) {
    if (!wide || !*wide) return {};
    const int size = WideCharToMultiByte(CP_UTF8, 0, wide, -1, nullptr, 0, nullptr, nullptr);
    std::string out(size > 1 ? size - 1 : 0, '\0');
    if (size > 1) WideCharToMultiByte(CP_UTF8, 0, wide, -1, out.data(), size, nullptr, nullptr);
    return out;
}

std::string jsonEscape(const std::string& in) {
    std::string out;
    for (unsigned char c : in) {
        if (c == '"') out += "\\\"";
        else if (c == '\\') out += "\\\\";
        else if (c < 0x20) out += ' ';
        else out += static_cast<char>(c);
    }
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

// the graphics card a D3D11 device is on
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

std::string describeResource(void* resource) {
    ComPtr<ID3D11Texture2D> texture;
    if (!resource || FAILED(static_cast<IUnknown*>(resource)->QueryInterface(__uuidof(ID3D11Texture2D), reinterpret_cast<void**>(texture.GetAddressOf()))))
        return "not a D3D11 texture";
    return describeTexture(texture.Get());
}

const char* deviceTypeName(int type) {
    switch (type) {
        case NV_ENC_DEVICE_TYPE_DIRECTX: return "directx";
        case NV_ENC_DEVICE_TYPE_CUDA: return "cuda";
        case NV_ENC_DEVICE_TYPE_OPENGL: return "opengl";
        default: return "unknown";
    }
}

const char* resourceTypeName(int type) {
    switch (type) {
        case NV_ENC_INPUT_RESOURCE_TYPE_DIRECTX: return "d3d11";
        case NV_ENC_INPUT_RESOURCE_TYPE_CUDADEVICEPTR: return "cuda pointer";
        case NV_ENC_INPUT_RESOURCE_TYPE_CUDAARRAY: return "cuda array";
        case NV_ENC_INPUT_RESOURCE_TYPE_OPENGL_TEX: return "opengl";
        default: return "unknown";
    }
}

const char* codecName(const GUID& guid) {
    if (memcmp(&guid, &NV_ENC_CODEC_H264_GUID, sizeof(GUID)) == 0) return "H264";
    if (memcmp(&guid, &NV_ENC_CODEC_HEVC_GUID, sizeof(GUID)) == 0) return "HEVC";
    if (memcmp(&guid, &NV_ENC_CODEC_AV1_GUID, sizeof(GUID)) == 0) return "AV1";
    return "other";
}

// every graphics card Windows knows, and how many screens are on it: a laptop whose screen is on the integrated card has an
// NVIDIA card with none
std::string adaptersJson() {
    ComPtr<IDXGIFactory1> factory;
    if (FAILED(CreateDXGIFactory1(__uuidof(IDXGIFactory1), reinterpret_cast<void**>(factory.GetAddressOf())))) return "[]";

    std::string out = "[";
    ComPtr<IDXGIAdapter1> adapter;
    for (UINT i = 0; factory->EnumAdapters1(i, &adapter) != DXGI_ERROR_NOT_FOUND; i++, adapter.Reset()) {
        DXGI_ADAPTER_DESC1 d;
        if (FAILED(adapter->GetDesc1(&d))) continue;

        UINT outputs = 0;
        ComPtr<IDXGIOutput> output;
        while (adapter->EnumOutputs(outputs, &output) != DXGI_ERROR_NOT_FOUND) {
            outputs++;
            output.Reset();
        }

        char text[200];
        snprintf(text, sizeof text, "\",\"vendor\":\"%s\",\"vendorId\":%u,\"deviceId\":%u,\"luid\":\"%08lx:%08lx\",\"vramMB\":%llu,\"outputs\":%u,\"software\":%s}",
            vendorName(d.VendorId), d.VendorId, d.DeviceId, static_cast<unsigned long>(d.AdapterLuid.HighPart), static_cast<unsigned long>(d.AdapterLuid.LowPart),
            static_cast<unsigned long long>(d.DedicatedVideoMemory >> 20), outputs, (d.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) ? "true" : "false");
        if (out.size() > 1) out += ",";
        out += "{\"name\":\"" + jsonEscape(narrow(d.Description)) + text;
    }
    return out + "]";
}

// the modules of this process that say how video is encoded here (AMD's amfrt64.dll, CUDA, Media Foundation, software codecs...)
std::string modulesJson() {
    static const char* const keys[] = {
        "nvenc", "nvcuda", "nvcuvid", "cuda", "nvapi", "amf", "atidx", "amdxc", "aticfx", "atiumd", "igfx", "igd1", "igdumd", "mfx", "vpl",
        "openh264", "x264", "x265", "vpx", "aom", "dav1d", "avcodec", "ffmpeg", "mfplat", "mfreadwrite", "webrtc", "discord_video", "discord_voice", "encoder"
    };

    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, GetCurrentProcessId());
    if (snapshot == INVALID_HANDLE_VALUE) return "[]";

    std::string out = "[";
    MODULEENTRY32W entry;
    entry.dwSize = sizeof entry;
    int count = 0;
    for (BOOL ok = Module32FirstW(snapshot, &entry); ok && count < 120; ok = Module32NextW(snapshot, &entry)) {
        std::string name = narrow(entry.szModule);
        std::string lower = name;
        std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        for (const char* key : keys) {
            if (lower.find(key) == std::string::npos) continue;
            if (count++) out += ",";
            out += "\"" + jsonEscape(name) + "\"";
            break;
        }
    }
    CloseHandle(snapshot);
    return out + "]";
}

// the sessions as JSON (called with g_mutex held)
std::string sessionsJson() {
    std::string out = "[";
    for (const auto& [encoder, s] : g_sessions) {
        char text[512];
        snprintf(text, sizeof text, "{\"encoder\":\"%p\",\"device\":\"%s\",\"api\":%u,\"codec\":\"%s\",\"width\":%u,\"height\":%u,\"fpsNum\":%u,\"fpsDen\":%u,\"encodes\":%llu,\"drawn\":%llu,\"unknown\":%llu,\"adapter\":\"",
            encoder, deviceTypeName(s.deviceType), s.apiVersion, s.codec.empty() ? "not set up yet" : s.codec.c_str(), s.width, s.height, s.fpsNum, s.fpsDen,
            static_cast<unsigned long long>(s.encodes), static_cast<unsigned long long>(s.drawn), static_cast<unsigned long long>(s.unknown));
        if (out.size() > 1) out += ",";
        out += text + jsonEscape(s.adapter) + "\"}";
    }
    return out + "]";
}

// ---- blending the overlay into the frame ----------------------------------------------------------------------------
// Discord's textures belong to its own device: they are opened on one of ours through the shared handle, drawn on
// there (premultiplied alpha), and the GPU is waited for before NVENC reads the frame.

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

// the latest overlay (B8G8R8A8, premultiplied), copied in from JS and uploaded by the encoding thread. A frame from JS is
// either the whole picture or a rectangle of it: g_pending always holds the whole picture, and the box is what changed
// since the last upload, so that only that part goes to the GPU
std::vector<uint8_t> g_pending;
uint32_t g_pendingW = 0, g_pendingH = 0;
bool g_pendingDirty = false;
bool g_pendingFull = true;
bool g_boxSet = false;
uint32_t g_boxL = 0, g_boxT = 0, g_boxR = 0, g_boxB = 0;

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
    logf("overlay device created on %s", adapterLabel(adapter.Get()).c_str());
    return nullptr;
}

// Moves the pending bitmap into a texture of ours. Returns false when there is nothing to draw.
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
            } else if (g_boxSet) {
                // on an immediate context the source pointer is where the box starts, the pitch is that of the whole picture
                D3D11_BOX box = { g_boxL, g_boxT, 0, g_boxR, g_boxB, 1 };
                g_ctx->UpdateSubresource(g_overlayTex.Get(), 0, &box, g_pending.data() + (static_cast<size_t>(g_boxT) * g_pendingW + g_boxL) * 4, g_pendingW * 4, 0);
            }
            g_pendingFull = false;
            g_boxSet = false;
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
            logf("opened a texture of the stream: %s", describeTexture(theirs.Get()).c_str());
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

// kept apart from safeDraw, which may have no C++ objects needing unwinding (it uses __try)
void drawingFailed(const char* error) {
    g_draw = false;
    {
        std::lock_guard lock(g_mutex);
        g_lastError = error;
    }
    logf("drawing switched off: %s", error);
}

// no C++ objects needing unwinding in here, so __try is allowed
void safeDraw(void* resource) {
    const char* error = nullptr;
    __try {
        error = drawFrame(resource);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        error = "exception while drawing";
    }
    if (error) drawingFailed(error);
}

// ---- the hooks ------------------------------------------------------------------------------------------------------

PNVENCREGISTERRESOURCE oRegister;
PNVENCUNREGISTERRESOURCE oUnregister;
PNVENCMAPINPUTRESOURCE oMap;
PNVENCUNMAPINPUTRESOURCE oUnmap;
PNVENCENCODEPICTURE oEncode;
PNVENCOPENENCODESESSIONEX oOpen;
PNVENCINITIALIZEENCODER oInit;
PNVENCDESTROYENCODER oDestroy;

// what is logged of the first registrations, to see how the stream is fed
std::atomic<int> g_registerLogged{0};

// ONE LINE every 10 s while drawing: what went through the hook, per session
void logStats() {
    static std::atomic<ULONGLONG> last{0};
    const ULONGLONG now = GetTickCount64();
    ULONGLONG before = last.load();
    if (now - before < 10000 || !last.compare_exchange_strong(before, now)) return;

    std::string sessions;
    {
        std::lock_guard lock(g_mutex);
        for (const auto& [encoder, session] : g_sessions) {
            char text[160];
            snprintf(text, sizeof text, " | %p %s %ux%u encodes=%llu drawn=%llu unknown=%llu", encoder, session.codec.c_str(), session.width, session.height,
                static_cast<unsigned long long>(session.encodes), static_cast<unsigned long long>(session.drawn), static_cast<unsigned long long>(session.unknown));
            sessions += text;
        }
    }
    logf("stats: encodes=%llu drawn=%llu unknown=%llu%s", static_cast<unsigned long long>(g_encodes.load()), static_cast<unsigned long long>(g_drawn.load()),
        static_cast<unsigned long long>(g_unknown.load()), sessions.c_str());
}

NVENCSTATUS NVENCAPI hkOpen(NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS* p, void** encoder) {
    NVENCSTATUS st = oOpen(p, encoder);
    if (p) {
        Session session;
        session.deviceType = p->deviceType;
        session.apiVersion = p->apiVersion;
        if (p->deviceType == NV_ENC_DEVICE_TYPE_DIRECTX) session.adapter = adapterOfDevice(p->device);

        logf("encoder session opened: status=%d device=%s adapter=%s api=0x%x encoder=%p", static_cast<int>(st), deviceTypeName(p->deviceType),
            session.adapter.empty() ? "(not a D3D11 device)" : session.adapter.c_str(), p->apiVersion, encoder ? *encoder : nullptr);
        if (st == NV_ENC_SUCCESS && encoder && *encoder) {
            std::lock_guard lock(g_mutex);
            g_sessions[*encoder] = session;
        }
    }
    return st;
}

NVENCSTATUS NVENCAPI hkInit(void* encoder, NV_ENC_INITIALIZE_PARAMS* p) {
    NVENCSTATUS st = oInit(encoder, p);
    if (p) {
        const char* codec = codecName(p->encodeGUID);
        logf("encoder set up: status=%d encoder=%p codec=%s %ux%u at %u/%u fps", static_cast<int>(st), encoder, codec, p->encodeWidth, p->encodeHeight, p->frameRateNum, p->frameRateDen);
        if (st == NV_ENC_SUCCESS) {
            std::lock_guard lock(g_mutex);
            Session& session = g_sessions[encoder];
            session.codec = codec;
            session.width = p->encodeWidth;
            session.height = p->encodeHeight;
            session.fpsNum = p->frameRateNum;
            session.fpsDen = p->frameRateDen;
        }
    }
    return st;
}

NVENCSTATUS NVENCAPI hkDestroy(void* encoder) {
    {
        std::lock_guard lock(g_mutex);
        const auto it = g_sessions.find(encoder);
        if (it != g_sessions.end()) {
            logf("encoder session closed: encoder=%p %s encodes=%llu drawn=%llu unknown=%llu", encoder, it->second.codec.c_str(),
                static_cast<unsigned long long>(it->second.encodes), static_cast<unsigned long long>(it->second.drawn), static_cast<unsigned long long>(it->second.unknown));
            g_sessions.erase(it);
        }
    }
    return oDestroy(encoder);
}

NVENCSTATUS NVENCAPI hkRegister(void* encoder, NV_ENC_REGISTER_RESOURCE* p) {
    NVENCSTATUS st = oRegister(encoder, p);
    if (p && g_registerLogged++ < 16) {
        // the first ones: the kind of resource (only D3D11 textures can be drawn on), its size and format, and which card it is on
        logf("resource registered: encoder=%p type=%s status=%d buffer format=0x%x size=%ux%u %s", encoder, resourceTypeName(p->resourceType), static_cast<int>(st),
            static_cast<unsigned>(p->bufferFormat), p->width, p->height,
            p->resourceType == NV_ENC_INPUT_RESOURCE_TYPE_DIRECTX ? describeResource(p->resourceToRegister).c_str() : "");
    }
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

            const auto session = g_sessions.find(encoder);
            if (session != g_sessions.end()) {
                ++session->second.encodes;
                if (!texture) ++session->second.unknown;
            }
        }
        if (texture) {
            const uint64_t before = g_drawn.load();
            safeDraw(texture);
            if (g_drawn.load() > before) {
                std::lock_guard lock(g_mutex);
                const auto session = g_sessions.find(encoder);
                if (session != g_sessions.end()) ++session->second.drawn;
            }
        } else if (++g_unknown == 1) {
            logf("an encoded frame was never registered (encoder %p): the stream started before the hook, restart it", encoder);
        }
        logStats();
    }
    return oEncode(encoder, p);
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

std::string start() {
    if (g_on) return "already on";

    HMODULE nv = GetModuleHandleW(L"nvencodeapi64.dll");
    if (!nv) nv = LoadLibraryW(L"nvencodeapi64.dll");
    if (!nv) {
        logf("nvencodeapi64.dll is not available (no NVIDIA driver?). Graphics cards: %s", adaptersJson().c_str());
        return "nvencodeapi64.dll is not available (no NVIDIA driver?)";
    }

    {
        wchar_t path[MAX_PATH] = {};
        GetModuleFileNameW(nv, path, MAX_PATH);
        logf("starting the hook. NVENC library: %s", narrow(path).c_str());
        logf("graphics cards: %s", adaptersJson().c_str());
        logf("video modules in this process: %s", modulesJson().c_str());
    }

    if (!g_installed) {
        auto create = reinterpret_cast<NVENCSTATUS(NVENCAPI*)(NV_ENCODE_API_FUNCTION_LIST*)>(GetProcAddress(nv, "NvEncodeAPICreateInstance"));
        if (!create) return "NvEncodeAPICreateInstance not found";

        NV_ENCODE_API_FUNCTION_LIST list = { NV_ENCODE_API_FUNCTION_LIST_VER };
        NVENCSTATUS st = create(&list);
        if (st != NV_ENC_SUCCESS) return "NvEncodeAPICreateInstance failed: " + std::to_string(st);

        MH_STATUS init = MH_Initialize();
        if (init != MH_OK && init != MH_ERROR_ALREADY_INITIALIZED) return std::string("MinHook: ") + MH_StatusToString(init);

        bool all = hook("RegisterResource", list.nvEncRegisterResource, hkRegister, &oRegister);
        all &= hook("UnregisterResource", list.nvEncUnregisterResource, hkUnregister, &oUnregister);
        all &= hook("MapInputResource", list.nvEncMapInputResource, hkMap, &oMap);
        all &= hook("UnmapInputResource", list.nvEncUnmapInputResource, hkUnmap, &oUnmap);
        all &= hook("EncodePicture", list.nvEncEncodePicture, hkEncode, &oEncode);
        if (!all) return "could not hook the encoder";

        // for the log only
        hook("OpenEncodeSessionEx", list.nvEncOpenEncodeSessionEx, hkOpen, &oOpen);
        hook("InitializeEncoder", list.nvEncInitializeEncoder, hkInit, &oInit);
        hook("DestroyEncoder", list.nvEncDestroyEncoder, hkDestroy, &oDestroy);
        g_installed = true;
    }

    MH_STATUS en = MH_EnableHook(MH_ALL_HOOKS);
    if (en != MH_OK) return std::string("enable failed: ") + MH_StatusToString(en);

    g_on = true;
    return "on";
}

std::string draw(bool on) {
    logf("drawing %s", on ? "on" : "off");
    if (on) {
        logf("video modules in this process: %s", modulesJson().c_str());
        g_encodes = 0;
        g_drawn = 0;
        g_unknown = 0;
        std::lock_guard lock(g_mutex);
        g_lastError.clear();
    }
    g_draw = on;
    return on ? (g_on ? "drawing on" : "the hooks are off: start them first") : "drawing off";
}

// What the hook has done since drawing was last switched on, as JSON: the plugin uses it to see that the overlay really
// reaches the stream (an encoder that is not NVENC, like AMD's or a software one, never goes through here).
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

// Everything the hook knows about this machine and the streams, as JSON: it works without the hooks being on, so it also says
// what is there on a machine where they cannot be.
std::string diagnose() {
    std::string out = std::string("{\"pid\":") + std::to_string(GetCurrentProcessId()) + ",\"hooks\":{\"installed\":" + (g_installed ? "true" : "false") +
        ",\"on\":" + (g_on ? "true" : "false") + ",\"draw\":" + (g_draw ? "true" : "false") + "},\"counters\":{\"encodes\":" + std::to_string(g_encodes.load()) +
        ",\"drawn\":" + std::to_string(g_drawn.load()) + ",\"unknown\":" + std::to_string(g_unknown.load()) + "}";

    std::string sessions;
    std::string error;
    {
        std::lock_guard lock(g_mutex);
        sessions = sessionsJson();
        error = g_lastError;
    }
    out += ",\"lastError\":\"" + jsonEscape(error) + "\",\"adapters\":" + adaptersJson() + ",\"modules\":" + modulesJson() + ",\"sessions\":" + sessions + "}";
    return out;
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
    g_boxSet = false;
    g_pendingDirty = true;
}

// A rectangle of a picture of the size the last whole one had. False when it does not fit that picture: a whole one has
// to be sent first.
bool updateOverlay(const uint8_t* data, size_t size, uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t fullW, uint32_t fullH) {
    std::lock_guard lock(g_mutex);
    if (!w || !h || !g_pendingW || fullW != g_pendingW || fullH != g_pendingH ||
        static_cast<uint64_t>(x) + w > fullW || static_cast<uint64_t>(y) + h > fullH ||
        size < static_cast<size_t>(w) * h * 4 || g_pending.size() != static_cast<size_t>(fullW) * fullH * 4)
        return false;

    for (uint32_t row = 0; row < h; row++)
        memcpy(g_pending.data() + (static_cast<size_t>(y + row) * fullW + x) * 4, data + static_cast<size_t>(row) * w * 4, static_cast<size_t>(w) * 4);

    if (!g_boxSet) {
        g_boxL = x; g_boxT = y; g_boxR = x + w; g_boxB = y + h;
        g_boxSet = true;
    } else {
        g_boxL = (std::min)(g_boxL, x); g_boxT = (std::min)(g_boxT, y);
        g_boxR = (std::max)(g_boxR, x + w); g_boxB = (std::max)(g_boxB, y + h);
    }
    g_pendingDirty = true;
    return true;
}

// Node-API without node_api.h or an import library: the host is Discord.exe, not node.exe, so the few functions needed
// are looked up in the running executable.
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

napi_value jsStart(napi_env env, napi_callback_info) {
    const std::string result = start();
    logf("start: %s", result.c_str());
    return toJs(env, result);
}
napi_value jsDrawOn(napi_env env, napi_callback_info) {
    const std::string result = draw(true);
    logf("drawOn: %s", result.c_str());
    return toJs(env, result);
}
napi_value jsDiagnose(napi_env env, napi_callback_info) { return toJs(env, diagnose()); }
napi_value jsDrawOff(napi_env env, napi_callback_info) { return toJs(env, draw(false)); }
napi_value jsStatus(napi_env env, napi_callback_info) { return toJs(env, status()); }

// setOverlay(bitmap: Uint8Array, width, height): no arguments clears the overlay
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

// updateOverlay(bitmap: Uint8Array, x, y, width, height, fullWidth, fullHeight): "ok", or "resync" when a whole picture is needed first
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
    expose(env, exports, "diagnose", jsDiagnose);
    expose(env, exports, "setOverlay", jsSetOverlay);
    expose(env, exports, "updateOverlay", jsUpdateOverlay);
    return exports;
}

extern "C" __declspec(dllexport) int32_t node_api_module_get_api_version_v1() { return 8; }
