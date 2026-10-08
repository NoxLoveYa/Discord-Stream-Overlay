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
target_link_libraries(streamoverlay_nvenc PRIVATE minhook d3d11 d3dcompiler)
set_target_properties(streamoverlay_nvenc PROPERTIES PREFIX "" SUFFIX ".node")

# A running Discord keeps the installed .node locked: a loaded file can be renamed though, so the old one is moved aside
# and the new one takes effect the next time Discord starts
set(INSTALL_DIR "$ENV{APPDATA}/discord/StreamOverlay/nvenc")
add_custom_command(TARGET streamoverlay_nvenc POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${INSTALL_DIR}"
    COMMAND powershell -NoProfile -Command
        "$d = '${INSTALL_DIR}/streamoverlay_nvenc.node'; if (Test-Path $d) { Move-Item -Force $d ($d + '.' + (Get-Date -Format yyyyMMddHHmmss) + '.old') }; Get-ChildItem '${INSTALL_DIR}' -Filter *.old | ForEach-Object { Remove-Item -Force $_.FullName -ErrorAction SilentlyContinue }"
    COMMAND ${CMAKE_COMMAND} -E copy "$<TARGET_FILE:streamoverlay_nvenc>" "${INSTALL_DIR}/")
