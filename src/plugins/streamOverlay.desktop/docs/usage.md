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

### Finding your way around the settings

- The cards on the **Overlays** tab are listed under headings: **Input** (keyboard, mouse), **Media** (Spotify) and **Frames**.
- An overlay's page has a tab for each group of its settings (the keyboard has **Look** and **Layout**, the mouse also has
  **Movement**, the frame has **Look**, **Wings** and **Details**) and a **Presets** tab. "Reset" on a tab only resets what is on
  that tab: where you moved the overlay to and what is on the other tabs stay.
- The keyboard, the mouse and the Spotify card have a **Theme** setting, each with its own: **Default**, **Gothic**
  and seven customs — **Neon Nights** (dark cyberpunk), **Porcelain Light** (the only bright one), **Retro Terminal**
  (green phosphor CRT, mono font while none is picked), **Sakura Pastel**, **Molten Lava**, **Royal Gold** and
  **Ocean Abyss**. Default and Gothic have their own accent colors, and the page shows the ones of the theme that is
  on; the customs have fixed palettes. Position, size and the other settings are shared, so switching
  the theme does not move anything. (The gothic ones used to be overlays of their own, `obnoxious-keyboard` and so on: what was
  saved for them is moved to the theme the first time the plugin starts.)

### Moving the keyboard and mouse overlays

Open the **Layout** tab of the settings. It shows the screen being shared (your main screen when you are not sharing)
with the overlays that are on, as they are drawn. Drag the keyboard or the mouse overlay to move it, drag its corner to
resize it. The result is saved when you let go and applies to the stream straight away. This works the same with
"stream only" on or off.

Hover the picture and use the button at its top right to make it full screen, which makes placing things easier (Esc or
the same button goes back).

The overlays are rendered at 60 Hz. Behind them is a screenshot of the monitor,
which is what the stream shows without the overlays, taken once when you open the tab at the monitor's own resolution; it is a still, not live video.
If that monitor is the one Discord is on, the screenshot contains the settings window. While the tab is open the overlays are hidden on the real screen, and come
back when you leave the tab.

Only overlays tagged `draggable` can be moved there (the keyboard, the mouse and the Spotify card; see the plugin README).
On screen, outside the settings, **Alt + Caps** still moves them while "stream only" is off.

### Spotify

The **Spotify** overlay is a card with the cover, title, artist and a progress bar of the track that is playing, in the look
of the keyboard and the mouse. It is moved and resized like them. Settings: two accent colors, show the cover, show the
progress, animated bars, hide when nothing is playing, scale and position.

- Spotify has to be **linked to your Discord account** (Settings, Connections). The plugin listens to the player state that
  Discord itself receives from Spotify, so no login or key is involved and nothing about what you listen to leaves your
  machine. It works with any Spotify client Discord can follow.
- The card fills in when the track changes, starts, pauses or is sought: if the music was already playing when the
  overlay was switched on, it says "Nothing playing" until the next of those.
- In the Layout tab it shows a sample track, so that there is something to drag while no music is playing.

### Keyboard arrangements

The keyboard has a **Key arrangement** setting (Keys tab): **Default** (the full keyboard), **FPS** (W over A S D,
then Shift, Ctrl and a full-width Space) and **MOBA** (spells Q W E R and summoners D F on one row, a gap between
them). Only the arranged keys show; every key is still read. **Key background** fades the rectangle behind the keys
(0 removes it, the caps keep floating), and **Board background** fades the window behind them (0 removes the
rectangle entirely). To switch per game, save one preset per arrangement on the keyboard's **Presets** tab
(ex. "FPS", "MOBA", "Default"), save a global preset with it on the **Presets** tab of the main page, and bind the
game to that preset on the **Apps** tab — the arrangement follows the game in focus. Hidden keys include Caps, so
move the overlay from the **Layout** tab while an arrangement is on.

The **MOBA** arrangement shows League of Legends spells. **Auto (in game)** (the default) reads your champion and
summoner spells straight from the game client while a game is live — no login, nothing leaves your machine — and
falls back to the manual picks outside a game. Or pick a **MOBA champion** yourself (Letters, Fiora or Akali) for
QWER and a summoner spell each for **D** and **F** (Flash, Ignite, Teleport, Ghost, Exhaust, Heal, Barrier, Smite) —
the summoners show with Letters too, no champion needed. Fiora, Akali and the summoner icons
come from Data Dragon and are bundled with the plugin (Riot Games assets, see below); any other live-detected
champion loads its ability icons from the Data Dragon CDN instead. Like the arrangement itself,
these choices are saved per preset.

### Fonts

The **Fonts** tab of the settings picks the font of the overlays. **Default font** applies to every overlay that has
no font of its own; the keyboard, the mouse and the Spotify card have their own **Font** setting (Look tab) which
overrides it. That choice is saved per preset like any other, so a game gets its own font by saving a global preset
with it and binding the game to that preset on the Apps tab. A font that is not picked follows the gothic theme
(blackletter) or the default stack: picking one overrides it everywhere, and clearing the choice hands back to the
theme. The picker says what an unset font follows.

Custom fonts are added on the same tab: **Add font file…** imports a `.woff2`, `.woff`, `.ttf` or `.otf` file (up to
5 MB, copied into the plugin's fonts folder), **Add system font…** registers a font installed on the machine by name
(ex. `Segoe UI`). A chip next to the picker removes a custom again; an overlay that used it falls back to a readable
font until another is picked.

**Font weight** (Regular to Bold, one value per theme), **Letter spacing** (key labels and Spotify title) and **Text
size** (a multiplier for every label) tune the text itself. They are saved per preset like any
other setting.

### Mouse buttons

Besides the left, right and middle buttons the mouse overlay shows the two macro side buttons as thin barrettes
without labels, **M5** over **M4**, left of the movement sensor. They light up like the rest. The sensor takes
almost the whole width of the board and stays centered under the wheel.

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
- Windows and an **NVIDIA GPU**. Discord must be using NVENC for Go Live (the default on NVIDIA); a software or
  AMD/Intel encoder is not covered.
- A screen share of a monitor.
- The native addon (below), which `pnpm install` and `pnpm build` take care of.

### The addon is built for you
`pnpm install` and `pnpm build` run `scripts/build/nvenc.mjs` (Windows only, nothing happens elsewhere). It:

1. looks for the Visual Studio C++ build tools and CMake, and installs what is missing with **winget** (the build tools
   are several GB and Windows asks for permission; git and internet access are needed too, because CMake downloads
   MinHook and the NVIDIA codec headers);
2. builds `nvenc/hook.cc` into `streamoverlay_nvenc.node`;
3. copies it to `%APPDATA%\discord\StreamOverlay\nvenc\` (and the same for `discordptb` and `discordcanary` when they
   have a data folder). If Discord is running, the old copy is renamed aside (`*.old`) and the new one is used the next
   time Discord starts.

When nothing changed since the last build it only compares a hash of the sources, so it costs nothing. It never fails the
install or the build: if the tools cannot be installed it prints why, and the overlays stay on your screen. Fix that and
run `node scripts/build/nvenc.mjs` by hand. `VENCORD_SKIP_NVENC=1` turns it off.

So on a fresh machine: clone, `pnpm install`, `pnpm build`, `pnpm inject`.

### An installer for other machines
`pnpm package` builds `dist/package/Vencord-StreamOverlay-Setup-<version>.exe` (needs Inno Setup 6: `winget install
JRSoftware.InnoSetup`). It contains this checkout's build, the prebuilt addon and the Vencord patcher, so the machine it
is installed on needs no Node, pnpm or Visual Studio. The setup installs to `%LOCALAPPDATA%\VencordStreamOverlay`, and
for each Discord you tick (Stable, PTB, Canary: the ones that are installed are listed) it patches Discord to load that
copy and puts the addon in that Discord's data folder (a running Discord keeps its old addon until it restarts).
Uninstalling unpatches those Discords again. `patch.cmd` in the install folder does the same as `pnpm inject` by hand
(`patch.cmd -install -branch stable`, `-repair`, `-uninstall`). The installed Vencord keeps its settings in the install
folder, separate from a checkout's. The addon only works on NVIDIA GPUs; the rest works anywhere.

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
- The stream has to go through NVENC for the screen it shares. On a laptop with two graphics cards the screen is usually on the
  integrated one (an NVIDIA card with "no screen connected" in its settings is the sign), so Discord cannot hand those frames to
  NVENC and uses another encoder (AMD's, Intel's, or software). The overlay would then be in neither place, so the plugin
  checks (see "Does it reach the stream?" below) and puts the overlays back on your screen for that stream, with a notice.
- The overlay is rendered at 30 fps and sent frame by frame to Discord's renderer; expect some extra CPU use.
- The preview overlay only goes on your own stream: a video in somebody else's tile of the call view is left alone, so
  the streams you watch do not get it. It goes on a video with the shape of the shared screen, so your own camera (same
  shape, in a tile of yours) can get it too, and it assumes the picture is letterboxed. The console says how many videos
  it is on and how many it skipped ("[StreamOverlay] the preview overlay is on..."), which helps when it picks wrong.
- A Discord update can change the voice module and break the hook. If viewers stop seeing the overlay after an update,
  see below.
- It reaches into Discord's media pipeline, which is further than Vencord's usual patches. Discord could treat it as
  tampering and anti-cheat software may dislike it. Use it at your own risk.

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| Overlay stays on your screen with "stream only" on | the addon is missing (`%APPDATA%\discord\StreamOverlay\nvenc\streamoverlay_nvenc.node`: `pnpm build` prints why it could not be built), or the page was not reloaded since Discord started (Ctrl + R) |
| A notice says "Stream only does not work with this stream" | the plugin saw that nothing reached the stream and put the overlays on your screen: the reason is in the notice (the stream is not encoded by NVENC; it began before the hook; drawing was switched off). The next stream is tried again |
| Nothing on screen and nothing on the stream | the share started before the hook: stop and start the share again |
| Viewers see nothing, still nothing after restarting the share | read `%TEMP%\streamoverlay-nvenc.log`: it states why drawing was switched off (not an NVIDIA encoder, texture not shared, GPU timeout, ...) |
| Overlay on the stream but not in your preview | the preview video was not recognised: it must be a non-http(s) `<video>` with the aspect ratio of the shared screen |
| Overlay shows on videos in chat | a video in the chat list or loaded over http(s) is skipped on purpose; update to the latest build |

To see which encoder a stream uses, look in `%APPDATA%\discord\logs\discord-webrtc_0` for "Outbound video stats": `codec: H264 (nvidia: direct3d)` is NVENC, anything else (`amd`, `intel`, `software`...) is not covered.

To go back to normal: turn the setting off. The overlays return to your screen on the next sync (about a second).
