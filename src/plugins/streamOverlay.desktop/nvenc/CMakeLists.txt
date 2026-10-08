cmake_minimum_required(VERSION 3.24)
project(streamoverlay_nvenc CXX)

include(FetchContent)

# static runtime for MinHook too, so the .node needs nothing but Windows
set(CMAKE_POLICY_DEFAULT_CMP0091 NEW)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded")

FetchContent_Declare(minhook GIT_REPOSITORY https://github.com/TsudaKageyu/minhook.git GIT_TAG v1.3.4)
# only the headers are used, nv-codec-headers has no CMake project
FetchContent_Declare(nvcodec GIT_REPOSITORY https://github.com/FFmpeg/nv-codec-headers.git GIT_TAG n13.0.19.1 SOURCE_SUBDIR none)
FetchContent_MakeAvailable(minhook nvcodec)

set(CMAKE_CXX_STANDARD 20)

add_library(streamoverlay_nvenc SHARED hook.cc)
target_include_directories(streamoverlay_nvenc PRIVATE ${nvcodec_SOURCE_DIR}/include)
# mfuuid is only the GUIDs of Media Foundation: mfplat.dll itself is looked up at run time (Windows N editions have none)
target_link_libraries(streamoverlay_nvenc PRIVATE minhook d3d11 d3dcompiler dxgi mfuuid ole32)
set_target_properties(streamoverlay_nvenc PROPERTIES PREFIX "" SUFFIX ".node")

# tests, not built with the addon: `cmake --build build --config Release --target yuvblend_test` (and mftest, an addon that
# feeds frames to Windows' H.264 encoder, to try the hook for the software encoder in a node process)
add_executable(yuvblend_test EXCLUDE_FROM_ALL test/yuvblend_test.cc)
add_library(mftest SHARED EXCLUDE_FROM_ALL test/mftest.cc)
target_link_libraries(mftest PRIVATE mfplat mfuuid ole32)
set_target_properties(mftest PROPERTIES PREFIX "" SUFFIX ".node")

# Installing the result is up to scripts/build/nvenc.mjs, which also installs the tools this needs
