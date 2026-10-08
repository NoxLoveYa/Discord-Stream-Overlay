// Hooks Discord's NVENC encoder. While drawing is on, every frame is blended with the bitmap given to setOverlay() just
// before it is encoded, so the overlay is in the stream and not on the screen. Failures go to %TEMP%\streamoverlay-nvenc.log.
// Loaded into Discord's renderer process by the preload script of main/nvenc.ts.

#include <windows.h>
#include <d3d11.h>
#include <d3dcompiler.h>
#include <dxgi.h>
#include <wrl/client.h>

#include <algorithm>
#include <atomic>
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

void logf(const char* fmt, ...) {
    static FILE* file = nullptr;
    if (!file) {
        wchar_t temp[MAX_PATH];
        GetTempPathW(MAX_PATH, temp);
        file = _wfopen((std::wstring(temp) + L"streamoverlay-nvenc.log").c_str(), L"a");
        if (!file) return;
    }
    char line[512];
    va_list args;
    va_start(args, fmt);
    vsnprintf(line, sizeof line, fmt, args);
    va_end(args);
    fprintf(file, "[%llu] %s\n", GetTickCount64(), line);
    fflush(file);
}

// NVENC is given a mapped handle per frame; the texture behind it was registered earlier
std::unordered_map<void*, void*> g_registered;  // registered handle -> Discord's D3D11 texture
std::unordered_map<void*, void*> g_mapped;      // mapped handle -> registered handle

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
    if (desc.Format != DXGI_FORMAT_B8G8R8A8_UNORM) return "not a B8G8R8A8 texture";
    if (!(desc.MiscFlags & D3D11_RESOURCE_MISC_SHARED)) return "texture is not shared";
    if (!(desc.BindFlags & D3D11_BIND_RENDER_TARGET)) return "texture is not a render target";

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
            if (FAILED(g_dev->OpenSharedResource(handle, __uuidof(ID3D11Texture2D), reinterpret_cast<void**>(fresh.tex.GetAddressOf()))))
                return "OpenSharedResource failed";
            if (FAILED(g_dev->CreateRenderTargetView(fresh.tex.Get(), nullptr, &fresh.rtv))) return "CreateRenderTargetView failed";
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
        if (texture) {
            safeDraw(texture);
        } else if (++g_unknown == 1) {
            logf("an encoded frame was never registered: the stream started before the hook, restart it");
        }
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
    if (!nv) return "nvencodeapi64.dll is not available (no NVIDIA driver?)";

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
        g_installed = true;
    }

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

napi_value jsStart(napi_env env, napi_callback_info) { return toJs(env, start()); }
napi_value jsDrawOn(napi_env env, napi_callback_info) { return toJs(env, draw(true)); }
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
    expose(env, exports, "setOverlay", jsSetOverlay);
    expose(env, exports, "updateOverlay", jsUpdateOverlay);
    return exports;
}

extern "C" __declspec(dllexport) int32_t node_api_module_get_api_version_v1() { return 8; }
