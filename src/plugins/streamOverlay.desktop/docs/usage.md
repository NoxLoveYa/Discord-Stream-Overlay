# Using StreamOverlay

## Basics

1. Enable the **StreamOverlay** plugin in Vencord's settings (Windows desktop client).
2. Open the plugin's settings. On the **Overlays** tab, switch on the overlays you want (`red-border` and `keyboard` are
   on by default).
3. Start a screen share (Go Live) of a **monitor**. The overlays appear on that monitor while the share runs and go away
   when it stops. Window and game shares are not covered.
4. "Show the overlays even when not screensharing" (`alwaysShow`) is there for testing: it draws them without a share.

The overlays folder is `%APPDATA%\discord\StreamOverlay\overlays` by default. The default overlays are copied there once;
edit the copies, or add your own folder next to them (see the [plugin README](../README.md)). The Overlays tab has
the folder tools (pick another folder, open it).

### Moving the keyboard and mouse overlays

Open the **Layout** tab of the settings. It shows the screen being shared (your main screen when you are not sharing)
with the overlays that are on, as they are drawn. Drag the keyboard or the mouse overlay to move it, drag its corner to
resize it. The result is saved when you let go and applies to the stream straight away. This works the same with
"stream only" on or off.

The overlays move at the refresh rate of that monitor. Behind them is a screenshot of the monitor, which is what the
stream shows without the overlays, refreshed about once a second (so it is not live video). If that monitor is the one
Discord is on, the screenshot contains the settings window itself, so the picture repeats inside itself; it is best used
with the shared monitor being another one. While the tab is open the overlays are hidden on the real screen, and come
back when you leave the tab.

Only overlays tagged `draggable` can be moved there (the keyboard and the mouse; see the plugin README). On screen,
outside the settings, **Alt + Caps** still moves them while "stream only" is off.

### Presets

- **Per overlay**: on an overlay's page, the **Presets** tab saves its settings, including where it was dragged to.
- **Global**: the **Presets** tab of the main page saves which overlays are on plus the settings of all of them.
- Click a card to apply it. The notice that follows lets you undo; there is no confirmation first.
- **Apps** tab: add a program, choose a global preset, and it is applied while that program is in focus. "Detect" fills
  in the next program that comes into focus. With "Go back when the app is no longer in focus" (on by default) the
  previous state is restored. Only the program's file name is read, never window titles or contents.

## Stream only

Draws the overlays on the stream and its preview but not on your screen.

### Requirements
- Windows, Discord Stable (the paths below use `%APPDATA%\discord`), an **NVIDIA GPU**. Discord must be using NVENC for
  Go Live (the default on NVIDIA); a software or AMD/Intel encoder is not covered.
- A screen share of a monitor.
- The native addon, built once (below).

### Build the addon
You need Visual Studio 2022 Build Tools (C++ workload), CMake and internet access (the build downloads MinHook and the
NVIDIA codec headers). In `src/plugins/streamOverlay.desktop/nvenc/`:

```
cmake -S . -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
```

The build copies `streamoverlay_nvenc.node` to `%APPDATA%\discord\StreamOverlay\nvenc\`. If Discord is running, the old
copy is renamed aside (`*.old`) and the new one is used the next time Discord starts.

Then build Vencord as usual (`pnpm build`) and inject it.

### Turn it on
1. **Quit Discord completely** and start it again.
2. In the plugin settings turn on **"Only draw the overlays on the stream and its preview, not on your own screen"**. The
   plugin hooks the encoder straight away (a `Vencord StreamOverlay encoder hook installed` line shows in DevTools).
3. Press **Ctrl + R** once. The script that runs inside Discord's page only attaches to pages loaded after the plugin
   registered it. Until then the overlays simply stay on your screen and the plugin keeps retrying.
4. **Start the screen share after the hook is in.** A share that was already running when the hook was installed cannot
   be drawn on: stop and start it again.

Viewers now see the overlay; your monitor does not. In Discord, your own stream preview shows the overlay on top.

### Limits
- Overlays cannot be dragged on screen while it is on; use the Layout tab.
- NVIDIA / NVENC only, monitor shares only. If the hook cannot attach, the overlays stay on your screen.
- The overlay is rendered at 30 fps and sent frame by frame to Discord's renderer; expect some extra CPU use.
- The preview overlay goes on any non-http(s) video with the shape of the shared screen, so someone else's stream of
  the same shape could get it too, and it assumes the picture is letterboxed.
- A Discord update can change the voice module and break the hook. If viewers stop seeing the overlay after an update,
  see below.
- It reaches into Discord's media pipeline, which is further than Vencord's usual patches. Discord could treat it as
  tampering and anti-cheat software may dislike it. Use it at your own risk.

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| Overlay stays on your screen with "stream only" on | the addon is missing (`%APPDATA%\discord\StreamOverlay\nvenc\streamoverlay_nvenc.node`), or the page was not reloaded since Discord started (Ctrl + R) |
| Nothing on screen and nothing on the stream | the share started before the hook: stop and start the share again |
| Viewers see nothing, still nothing after restarting the share | read `%TEMP%\streamoverlay-nvenc.log`: it states why drawing was switched off (not an NVIDIA encoder, texture not shared, GPU timeout, ...) |
| Overlay on the stream but not in your preview | the preview video was not recognised: it must be a non-http(s) `<video>` with the aspect ratio of the shared screen |
| Overlay shows on videos in chat | a video in the chat list or loaded over http(s) is skipped on purpose; update to the latest build |
| Build fails with "Permission denied" copying the `.node` | an older build; the current one renames the loaded file aside |

To go back to normal: turn the setting off. The overlays return to your screen on the next sync (about a second).
