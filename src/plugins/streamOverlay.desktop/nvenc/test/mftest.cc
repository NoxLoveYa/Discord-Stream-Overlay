// A node addon that feeds frames to Windows' software H.264 encoder (Media Foundation), the way Discord does when it has no
// hardware encoder, to try the hook of hook.cc in a node process:
//
//   const hook = load("streamoverlay_nvenc.node"); hook.start(); hook.drawOn(); hook.setOverlay(...)
//   const result = JSON.parse(load("mftest.node").encode("out.h264", 640, 360, 30, "nv12"))
//
// then the stream is decoded with ffmpeg and the pixels are looked at. `result.sourceUnchanged` says whether the hook left the
// frame it was given as it was.

#include <windows.h>
#include <mfapi.h>
#include <mferror.h>
#include <mftransform.h>
#include <wrl/client.h>

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

using Microsoft::WRL::ComPtr;

namespace {

const CLSID kH264Encoder = { 0x6ca50344, 0x051a, 0x4ded, { 0x97, 0x79, 0xa4, 0x33, 0x05, 0x16, 0x5e, 0x35 } };

using napi_env = void*;
using napi_value = void*;
using napi_callback_info = void*;
using napi_callback = napi_value (*)(napi_env, napi_callback_info);

int (*napi_create_function)(napi_env, const char*, size_t, napi_callback, void*, napi_value*);
int (*napi_set_named_property)(napi_env, napi_value, const char*, napi_value);
int (*napi_create_string_utf8)(napi_env, const char*, size_t, napi_value*);
int (*napi_get_cb_info)(napi_env, napi_callback_info, size_t*, napi_value*, napi_value*, void**);
int (*napi_get_value_string_utf8)(napi_env, napi_value, char*, size_t, size_t*);
int (*napi_get_value_uint32)(napi_env, napi_value, uint32_t*);

napi_value toJs(napi_env env, const std::string& s) {
    napi_value v = nullptr;
    napi_create_string_utf8(env, s.c_str(), s.size(), &v);
    return v;
}

std::string fail(const char* what, HRESULT hr) {
    char text[200];
    snprintf(text, sizeof text, "{\"ok\":false,\"error\":\"%s: 0x%08lx\"}", what, static_cast<unsigned long>(hr));
    return text;
}

#define TRY(call) do { HRESULT _hr = (call); if (FAILED(_hr)) return fail(#call, _hr); } while (0)

// mode: nv12, iyuv, yv12; "2d" after it asks for 2D media buffers (lines padded the way the system likes them)
std::string encode(const std::string& path, uint32_t w, uint32_t h, uint32_t frames, const std::string& mode) {
    const bool twoD = mode.find("2d") != std::string::npos;
    const GUID subtype = mode.rfind("iyuv", 0) == 0 ? MFVideoFormat_IYUV : mode.rfind("yv12", 0) == 0 ? MFVideoFormat_YV12 : MFVideoFormat_NV12;
    const bool nv12 = subtype == MFVideoFormat_NV12;

    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    TRY(MFStartup(MF_VERSION));

    ComPtr<IMFTransform> mft;
    TRY(CoCreateInstance(kH264Encoder, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&mft)));

    ComPtr<IMFMediaType> out;
    TRY(MFCreateMediaType(&out));
    out->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    out->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
    out->SetUINT32(MF_MT_AVG_BITRATE, 6'000'000);
    MFSetAttributeSize(out.Get(), MF_MT_FRAME_SIZE, w, h);
    MFSetAttributeRatio(out.Get(), MF_MT_FRAME_RATE, 30, 1);
    MFSetAttributeRatio(out.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    out->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
    out->SetUINT32(MF_MT_MPEG2_PROFILE, 100);
    TRY(mft->SetOutputType(0, out.Get(), 0));

    ComPtr<IMFMediaType> in;
    TRY(MFCreateMediaType(&in));
    in->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    in->SetGUID(MF_MT_SUBTYPE, subtype);
    MFSetAttributeSize(in.Get(), MF_MT_FRAME_SIZE, w, h);
    MFSetAttributeRatio(in.Get(), MF_MT_FRAME_RATE, 30, 1);
    MFSetAttributeRatio(in.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    in->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
    TRY(mft->SetInputType(0, in.Get(), 0));

    TRY(mft->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0));
    TRY(mft->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0));

    // the picture: flat grey, so that anything drawn on it shows
    const size_t lumaBytes = static_cast<size_t>(w) * h;
    std::vector<uint8_t> master(lumaBytes * 3 / 2);
    memset(master.data(), 100, lumaBytes);
    if (nv12) {
        for (size_t i = lumaBytes; i < master.size(); i++) master[i] = 128;
    } else {
        memset(master.data() + lumaBytes, 128, master.size() - lumaBytes);
    }

    MFT_OUTPUT_STREAM_INFO info = {};
    TRY(mft->GetOutputStreamInfo(0, &info));
    const bool providesSamples = (info.dwFlags & (MFT_OUTPUT_STREAM_PROVIDES_SAMPLES | MFT_OUTPUT_STREAM_CAN_PROVIDE_SAMPLES)) != 0;

    FILE* file = _wfopen(std::wstring(path.begin(), path.end()).c_str(), L"wb");
    if (!file) return "{\"ok\":false,\"error\":\"cannot write the file\"}";
    size_t bytes = 0, packets = 0;

    auto drain = [&]() -> HRESULT {
        for (;;) {
            MFT_OUTPUT_DATA_BUFFER buffer = {};
            ComPtr<IMFSample> own;
            if (!providesSamples) {
                ComPtr<IMFMediaBuffer> mb;
                MFCreateMemoryBuffer(info.cbSize ? info.cbSize : 1 << 20, &mb);
                MFCreateSample(&own);
                own->AddBuffer(mb.Get());
                buffer.pSample = own.Get();
            }
            DWORD status = 0;
            const HRESULT hr = mft->ProcessOutput(0, 1, &buffer, &status);
            if (hr == MF_E_TRANSFORM_NEED_MORE_INPUT) return S_OK;
            if (FAILED(hr)) return hr;

            ComPtr<IMFSample> got;
            got.Attach(providesSamples ? buffer.pSample : nullptr);
            IMFSample* sample = providesSamples ? got.Get() : own.Get();
            if (buffer.pEvents) buffer.pEvents->Release();
            if (!sample) continue;

            ComPtr<IMFMediaBuffer> mb;
            sample->ConvertToContiguousBuffer(&mb);
            BYTE* data = nullptr;
            DWORD length = 0;
            if (mb && SUCCEEDED(mb->Lock(&data, nullptr, &length))) {
                fwrite(data, 1, length, file);
                bytes += length;
                packets++;
                mb->Unlock();
            }
        }
    };

    ComPtr<IMFSample> last;
    for (uint32_t i = 0; i < frames; i++) {
        ComPtr<IMFMediaBuffer> mb;
        if (twoD) {
            TRY(MFCreate2DMediaBuffer(w, h, subtype.Data1, FALSE, &mb));
        } else {
            TRY(MFCreateMemoryBuffer(static_cast<DWORD>(master.size()), &mb));
        }

        // copy the picture in, line by line when the buffer has its own pitch
        ComPtr<IMF2DBuffer> b2;
        if (twoD && SUCCEEDED(mb.As(&b2))) {
            BYTE* scan0 = nullptr;
            LONG pitch = 0;
            TRY(b2->Lock2D(&scan0, &pitch));
            for (uint32_t y = 0; y < h; y++) memcpy(scan0 + static_cast<size_t>(y) * pitch, master.data() + static_cast<size_t>(y) * w, w);
            BYTE* chroma = scan0 + static_cast<size_t>(pitch) * h;
            if (nv12) {
                for (uint32_t y = 0; y < h / 2; y++) memcpy(chroma + static_cast<size_t>(y) * pitch, master.data() + lumaBytes + static_cast<size_t>(y) * w, w);
            } else {
                const size_t half = static_cast<size_t>(pitch) / 2;
                for (uint32_t y = 0; y < h / 2; y++) {
                    memcpy(chroma + y * half, master.data() + lumaBytes + static_cast<size_t>(y) * (w / 2), w / 2);
                    memcpy(chroma + half * (h / 2) + y * half, master.data() + lumaBytes + static_cast<size_t>(h / 2) * (w / 2) + static_cast<size_t>(y) * (w / 2), w / 2);
                }
            }
            b2->Unlock2D();
            mb->SetCurrentLength(static_cast<DWORD>(static_cast<size_t>(pitch) * h * 3 / 2));
        } else {
            BYTE* data = nullptr;
            TRY(mb->Lock(&data, nullptr, nullptr));
            memcpy(data, master.data(), master.size());
            mb->Unlock();
            mb->SetCurrentLength(static_cast<DWORD>(master.size()));
        }

        ComPtr<IMFSample> sample;
        TRY(MFCreateSample(&sample));
        sample->AddBuffer(mb.Get());
        sample->SetSampleTime(static_cast<LONGLONG>(i) * 333333);
        sample->SetSampleDuration(333333);
        TRY(mft->ProcessInput(0, sample.Get(), 0));
        TRY(drain());
        last = sample;
    }
    TRY(mft->ProcessMessage(MFT_MESSAGE_COMMAND_DRAIN, 0));
    TRY(drain());
    fclose(file);

    // whether the frame given to the encoder is as it was
    bool unchanged = true;
    if (last) {
        ComPtr<IMFMediaBuffer> mb;
        last->ConvertToContiguousBuffer(&mb);
        ComPtr<IMF2DBuffer> b2;
        if (twoD && SUCCEEDED(mb.As(&b2))) {
            BYTE* scan0 = nullptr;
            LONG pitch = 0;
            if (SUCCEEDED(b2->Lock2D(&scan0, &pitch))) {
                for (uint32_t y = 0; y < h && unchanged; y++) unchanged = memcmp(scan0 + static_cast<size_t>(y) * pitch, master.data() + static_cast<size_t>(y) * w, w) == 0;
                b2->Unlock2D();
            }
        } else {
            BYTE* data = nullptr;
            if (SUCCEEDED(mb->Lock(&data, nullptr, nullptr))) {
                unchanged = memcmp(data, master.data(), master.size()) == 0;
                mb->Unlock();
            }
        }
    }

    MFShutdown();
    char text[200];
    snprintf(text, sizeof text, "{\"ok\":true,\"bytes\":%zu,\"packets\":%zu,\"sourceUnchanged\":%s}", bytes, packets, unchanged ? "true" : "false");
    return text;
}

// encode(path, width, height, frames, mode)
napi_value jsEncode(napi_env env, napi_callback_info info) {
    size_t argc = 5;
    napi_value argv[5] = {};
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != 0 || argc < 5) return toJs(env, "{\"ok\":false,\"error\":\"bad call\"}");

    char path[512] = {}, mode[64] = {};
    size_t n = 0;
    uint32_t w = 0, h = 0, frames = 0;
    if (napi_get_value_string_utf8(env, argv[0], path, sizeof path, &n) != 0 || napi_get_value_uint32(env, argv[1], &w) != 0 ||
        napi_get_value_uint32(env, argv[2], &h) != 0 || napi_get_value_uint32(env, argv[3], &frames) != 0 ||
        napi_get_value_string_utf8(env, argv[4], mode, sizeof mode, &n) != 0)
        return toJs(env, "{\"ok\":false,\"error\":\"bad arguments\"}");
    return toJs(env, encode(path, w, h, frames, mode));
}

}  // namespace

extern "C" __declspec(dllexport) napi_value napi_register_module_v1(napi_env env, napi_value exports) {
    HMODULE host = GetModuleHandleW(nullptr);
#define RESOLVE(name) name = reinterpret_cast<decltype(name)>(GetProcAddress(host, #name)); if (!name) return exports
    RESOLVE(napi_create_function);
    RESOLVE(napi_set_named_property);
    RESOLVE(napi_create_string_utf8);
    RESOLVE(napi_get_cb_info);
    RESOLVE(napi_get_value_string_utf8);
    RESOLVE(napi_get_value_uint32);
#undef RESOLVE
    napi_value f = nullptr;
    if (napi_create_function(env, "encode", SIZE_MAX, jsEncode, nullptr, &f) == 0) napi_set_named_property(env, exports, "encode", f);
    return exports;
}
