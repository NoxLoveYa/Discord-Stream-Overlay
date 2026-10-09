// Node-API without node_api.h or an import library: the host is Discord.exe, not node.exe, so the functions are looked up in it.

#pragma once

#include <windows.h>

#include <cstddef>
#include <cstdint>
#include <string>

namespace napi {

using napi_env = void*;
using napi_value = void*;
using napi_callback_info = void*;
using napi_callback = napi_value (*)(napi_env, napi_callback_info);

inline int (*napi_create_function)(napi_env, const char*, size_t, napi_callback, void*, napi_value*);
inline int (*napi_set_named_property)(napi_env, napi_value, const char*, napi_value);
inline int (*napi_create_string_utf8)(napi_env, const char*, size_t, napi_value*);
inline int (*napi_get_cb_info)(napi_env, napi_callback_info, size_t*, napi_value*, napi_value*, void**);
inline int (*napi_get_typedarray_info)(napi_env, napi_value, int*, size_t*, void**, napi_value*, size_t*);
inline int (*napi_get_value_string_utf8)(napi_env, napi_value, char*, size_t, size_t*);
inline int (*napi_get_value_uint32)(napi_env, napi_value, uint32_t*);

// false when the host lacks one of them
inline bool load() {
    HMODULE host = GetModuleHandleW(nullptr);
#define RESOLVE(name) name = reinterpret_cast<decltype(name)>(GetProcAddress(host, #name)); if (!name) return false
    RESOLVE(napi_create_function);
    RESOLVE(napi_set_named_property);
    RESOLVE(napi_create_string_utf8);
    RESOLVE(napi_get_cb_info);
    RESOLVE(napi_get_typedarray_info);
    RESOLVE(napi_get_value_string_utf8);
    RESOLVE(napi_get_value_uint32);
#undef RESOLVE
    return true;
}

inline napi_value toJs(napi_env env, const std::string& s) {
    napi_value v = nullptr;
    napi_create_string_utf8(env, s.c_str(), s.size(), &v);
    return v;
}

inline void expose(napi_env env, napi_value exports, const char* name, napi_callback fn) {
    napi_value f = nullptr;
    if (napi_create_function(env, name, SIZE_MAX, fn, nullptr, &f) == 0) napi_set_named_property(env, exports, name, f);
}

}  // namespace napi
