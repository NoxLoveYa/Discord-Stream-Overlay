# StreamOverlay

Docs: [what it adds](docs/README.md), [how to use it](docs/usage.md), [how it works](docs/how-it-works.md).

Draws HTML/CSS overlays in a transparent, click-through window over the screen you are sharing, so they are captured
into your stream. Windows desktop client only (monitor shares: other windows are not part of a window capture).

## Writing an overlay

An overlay is a subfolder of the overlays folder (pick it in the plugin settings, default
`%APPDATA%\discord\StreamOverlay\overlays`) with an `index.html`. Keep its background transparent.

```
my-overlay/
  index.html
  style.css
  overlay.json     optional
```

The defaults in `defaultOverlays/` (`red-border`, `obnoxious-frame`, `keyboard`, `mouse` and `spotify`; the last three have a
default and a gothic **theme**, see below) are copied into the default folder (see `main/defaults.ts`): a copy you did not edit is updated when the plugin ships a newer version, a copy you edited is left
alone (so edit the copies, or make your own folder), and one you deleted stays deleted. The first time the plugin finds
a copy it cannot tell whether you edited, it keeps it as `.<name>.backup` before updating it. `keyboard` and `mouse` look alike because they are built from the same files in
`defaultOverlays/shared/`, which are copied into each of them (a folder has to be complete on its own):

| | |
|---|---|
| `board.css` | the panel, its position presets (`data-position`) and the shared look (colors, shadow, intro) |
| `keys.css`, `keys.js` | keys and buttons: `[data-key]` elements get `.is-down` while that key is held; the keyboard's `arrangement` setting regroups its keys per game (FPS, MOBA) and hides the rest (`.is-hidden`); in MOBA the live champion's ability icons (Data Dragon CDN) go on QWER, or letters when the `champion` setting is on Letters, and the `summoner-d`/`summoner-f` icons on D/F (summoner PNGs in `keyboard/spells/`, from Data Dragon, bundled by `main/defaults.ts` like the rest) |
| `move.css`, `move.js` | Alt + Caps to move and resize the `.board`, saved on release (it adds the `.resize` handle and the `.hint` to the `.board` itself) |
| `gothic-panel.css`, `gothic-keys.css` | the gothic theme of the window and of the keys (see below) |

### overlay.json

```json
{
    "title": "My overlay",
    "description": "What it shows, in a sentence.",
    "category": "Input",
    "keys": ["W", "SHIFT"],
    "mouse": true,
    "media": true,
    "interactive": ["ALT", "CAPS"],
    "draggable": true,
    "settings": [
        { "id": "theme", "type": "select", "label": "Theme", "group": "Look", "default": "plain", "options": ["plain", "fancy"] },
        { "id": "accent", "type": "color", "label": "Accent", "group": "Look", "when": { "theme": "plain" }, "default": "#8b5cf6" },
        { "id": "fancy-accent", "type": "color", "label": "Accent", "group": "Look", "when": { "theme": "fancy" }, "default": "#e4def0" },
        { "id": "width", "type": "number", "label": "Width", "group": "Layout", "min": 1, "max": 32, "step": 1, "unit": "px", "default": 4 },
        { "id": "glow", "type": "boolean", "label": "Glow", "group": "Layout", "default": true },
        { "id": "corner", "type": "select", "label": "Corner", "default": "left", "options": ["left", "right"] },
        { "id": "font", "type": "font", "label": "Font", "group": "Look", "default": "default", "options": ["default", "Consolas", "Georgia"] },
        { "id": "x", "type": "number", "label": "X", "min": 0, "max": 20000, "default": 0, "hidden": true }
    ]
}
```

- `title`, `description`: shown on the overlay's card in the plugin settings (the folder name is the title when there is
  none).
- `category`: the heading the card is listed under in the Overlays tab (the built-in ones use `Input`, `Media` and `Frames`).
  The headings only show when the overlays are in more than one category; those without one are listed last.
- `settings`: a control per entry on the overlay's page in the plugin settings (`hidden` ones are only set by the
  overlay itself). Types are `color`, `number`, `boolean`, `select` and `font` (a font picker over its `options`,
  plus the user's custom fonts from the Fonts tab; the value is the family, `"default"` keeps the old look).
  Each value reaches the page as:
  - a CSS variable on `<html>`: `--id` (numbers get their `unit`, booleans are `1` / `0`); colors also get `--id-rgb`
    (`"139 92 246"`), which allows `rgb(var(--accent-rgb) / 50%)`
  - a `data-id` attribute on `<html>`, for selectors like `html[data-corner="right"]`
  - a `streamoverlay:settings` event on `window` (`detail` holds every value)
  - `group` puts a setting on a tab of the overlay's page (`Look`, `Layout`...), in the order the groups first appear; settings
    without one are on the first tab. `when` shows a setting only while another setting has a value (`{ "theme": "fancy" }`,
    or `{ "flap": true }` for a switch): the value of a setting that is not shown is still sent to the page.
- `keys`: key states the page may receive. Only these are read, only while the overlay is visible, and an overlay only
  ever gets the keys it listed. Allowed names are in `main/keys.ts` (letters, digits, `SHIFT`, `CTRL`, `ALT`, `CAPS`,
  `SPACE`, `TAB`, `ENTER`, `ESC`, arrows, and the mouse buttons `LMB`, `RMB`, `MMB`).
- `mouse`: the page receives how far the mouse moved and the wheel turned (never where the cursor is, or what is under
  it). Read from raw input, so it also works in games that lock the cursor.
- `media`: the page receives the track that is playing in Spotify (title, artists, cover, position), as long as Spotify is
  linked to the Discord account. Nothing else about what you listen to is read.
- `lol`: the page receives the local League of Legends player's champion and summoner spells while a game is live
  (`null` outside one). Read straight from the game client on this machine: no login, and nothing leaves it.
- `interactive`: while all these keys are held the window takes the mouse instead of passing clicks through.
- `draggable`: the overlay moves itself with those keys (`move.js`), so the Layout tab of the settings lets you drag it.
  Defaults to true when `interactive` is set; `"draggable": false` keeps an overlay out of it.

Everything in `overlay.json` is validated (`main/manifest.ts`, `main/values.ts`): invalid entries are dropped, invalid
values fall back to the default.

### Fonts

The **Fonts** tab picks the default font of every overlay and manages the custom fonts: imported font files
(`.woff2`, `.woff`, `.ttf`, `.otf`, up to 5 MB, copied into `%APPDATA%\discord\StreamOverlay\fonts`) and system
fonts by name. The keyboard, the mouse and the Spotify card have their own **Font** setting (Look tab) which
overrides the default; like any setting it is saved per preset, so a game gets its own font through a global preset
bound to it on the Apps tab. A font that is not picked follows the gothic theme (blackletter) or the default stack:
picking one overrides it everywhere, deleting the choice hands back to the theme. An imported file is served to the
overlay with `@font-face`; a custom that was deleted afterwards falls back to a readable font until another is picked.

The keyboard, the mouse and the Spotify card also tune the text itself: **Font weight** (Regular to Bold, one value
per theme, like the accent colors), **Letter spacing** (key labels and Spotify title), and **Text size** (a multiplier
for every label, in the Look tab). Like any setting they are saved per preset, so a game gets its own
typography through the Apps tab.

### Themes

An overlay with more than one look has a `select` setting named `theme`, which reaches the page as `html[data-theme="..."]`.
The keyboard, the mouse and the Spotify card are built that way: their own CSS is the default theme and is not touched, and every
other theme is one shared file (`defaultOverlays/shared/theme-<name>.css`, copied into all three) with rules inside
`:where(html[data-theme="<name>"]) { ... }` (native CSS nesting). `:where()` weighs nothing,
so a rule weighs what it would without the scope and the order of the style sheets decides ties as before; variables that have
to beat `:root` use `html[data-theme="<name>"] { ... }` instead. The Default and Gothic themes take their colors from
settings of their own (`letter-accent` and `g-letter-accent`), each shown only with its theme (`when`) and with its own
default, and the CSS draws with an intermediate variable (`--key-accent-rgb`, `--click-rgb`, `--card-accent-rgb`) that
each theme points at its own colors. Each overlay picks its theme independently.

Besides Default and Gothic there are seven custom themes, each with its own shapes, background and fixed palette
(the accent settings stay on the Default and Gothic themes): Neon Nights (dark cyberpunk, pink/cyan), Porcelain Light
(the only bright one, ivory glass), Retro Terminal (green phosphor CRT, square keys, mono font while none is picked),
Sakura Pastel (plum and pink, very round), Molten Lava (basalt and ember orange, angular), Royal Gold (black and gold
hairlines) and Ocean Abyss (deep navy, cyan, generously round). The gothic keyboard, mouse and Spotify card used to be
overlays of their own (`obnoxious-keyboard`...): `migrate.ts` moves what was
saved for them (what is on, settings, presets, global presets) to the theme when the plugin starts.

### Messages

Sent to the page (`window.addEventListener("message", ...)`, ignore anything whose `source` is not `parent`):

| `type` | payload | when |
|---|---|---|
| `streamoverlay:keys` | `down: string[]` | the state of the requested keys changed (also sent once the page loads) |
| `streamoverlay:pointer` | `x`, `y` | the cursor moved, in page coordinates (interactive overlays only) |
| `streamoverlay:media` | `state` | the track changed, started, paused or was sought (`"media": true` only; also sent once the page loads). `state` is `null` when nothing plays, else `{ id, title, artists: string[], album, cover, duration, position, playing, at }` (milliseconds; `position` was true at `at`, a `Date.now()`, and moves on from there while `playing`). `cover` is an `https://*.scdn.co/` address or `""`. The names come from Spotify: show them as text, never as HTML |
| `streamoverlay:mouse` | `dx`, `dy`, `wheel` | the mouse moved / the wheel turned since the last message, at most every 16 ms (`"mouse": true` only). `dx`, `dy` are mouse counts, `wheel` is 120 per notch, positive is up |
| `streamoverlay:lol` | `state` | the live LoL player changed (`"lol": true` only; also sent once the page loads). `state` is `null` outside a game, else `{ champion, spells: string[4], summonerD, summonerF }`: the Data Dragon champion id, its QWER ability icon addresses (Data Dragon CDN, `""` when unknown) and `"summoner-flash"` ids (`""` when unknown) |

Sent by the page:

- `parent.postMessage({ type: "streamoverlay:save", values: { id: value } }, "*")` stores values in the settings (only
  declared ids are accepted, validated). The keyboard and mouse overlays use it to remember where they were dragged to.
- `parent.postMessage({ type: "streamoverlay:capture", on: true }, "*")`, for interactive overlays: overlays are stacked
  over the whole screen, so the window only passes the mouse to an overlay while it says it has something to grab
  (`move.js` does this while the cursor is over the board or a drag is going on). Send `on: false` when it lets go.

### The settings page

The page has four tabs: **Overlays** (a card per overlay, whose switch turns it on or off and which opens the overlay's
own page; and the folder tools), **Layout** (the overlays as they are drawn over the screen, where the draggable ones can
be moved and resized), **Presets** (the global presets) and **Apps** (presets by app). The page of an overlay
has two tabs, **Settings** and **Presets**. A preset of an overlay keeps all its settings, including where it was
dragged to and its size. The global presets keep which overlays are on and the settings of all of them (an overlay added
after a global preset was saved is left as it is when that preset is applied). Presets are stored in the plugin settings
(`overlayPresets`, `globalPresets`). The tabs are Discord's own tab bar (`components/Tabs.tsx`).

Both kinds are managed the same way (`components/PresetManager.tsx`): "Save current" names the current state, a card
per preset applies it when clicked and previews it (the colors of an overlay, the overlays that are on), and each card
can be updated with the current state, renamed, duplicated or deleted. A line says whether the current state is a
preset ("In use") or has unsaved changes, and applying, updating and deleting can be undone from the notice that
follows them instead of asking first.

### Presets by app

On the Apps tab, an app (a program, like `game.exe`) can be bound to a global preset: it is applied while the
program is in focus. "Detect" fills in the next program that comes into focus. When the program is no longer in focus
the previous state is put back (the setting "Go back when the app is no longer in focus", on by default), unless it
was changed in the meantime, and going from one bound program to another goes back to what was there before the first.

What it looks at: only the file name of the program of the window in focus (`main/focus.ts`: `GetForegroundWindow`, then
the name of that process, opened with a right that cannot read or change it). Never window titles or contents. A program
has to stay in focus for 0.6 s to count, and Discord's own windows and windows whose program cannot be told (some
protected games, the lock screen) change nothing. Nothing runs while there are no bindings switched on and the Apps
tab is closed. Microsoft Store apps all appear as `ApplicationFrameHost.exe`. The bindings are stored in the plugin
settings (`appBindings`, `appRevert`).

### Stream only

The setting "Only draw the overlays on the stream" (on by default) keeps the overlays off your own screen. Windows, with NVENC or Windows' software H.264 encoder (the stream of an AMD or Intel card is sent through the latter).
Discord encodes the shared screen with NVENC (or, when no graphics card can, with Windows' software encoder) inside its renderer process, so a small native addon (`nvenc/`, built with
CMake by `scripts/build/nvenc.mjs`, installed into `%APPDATA%\discord\StreamOverlay\nvenc`) hooks the encoder (MinHook) and, just before each frame is
encoded, blends the overlay over it. The overlays are rendered by an offscreen window (`main/window.ts`) whose pixels
travel to the renderer (`main/nvenc.ts`); a preload script loads the addon there and also draws the overlay over the
`<video>` of the in-app preview, which the encoder hook never touches.

- The hook only knows which texture a frame is by watching Discord set the encoder up, so it is installed when the plugin
  starts: a stream that was already running has to be restarted. If the hook cannot be reached the overlays stay on screen.
- Discord has to be restarted (and the page reloaded once) after the preload script is registered for the first time.
- The overlays cannot be dragged on screen while it is on: move them in the **Layout** tab of the settings.
- The preview overlay goes on a video with the shape of the shared screen that is not a file loaded over http(s) (so not
  the media in chats) and whose tile in the call view is yours: a tile (`data-selenium-video-tile`) of somebody else is left
  alone, so the streams you watch do not get it. A video outside a tile, or in a tile without an id, still gets it, and it
  assumes the picture is letterboxed. Your own camera in a tile of yours has the shape of the screen too and can get it.
- A Discord update can change the voice module and break the hook; failures are written to
  `%TEMP%\streamoverlay-nvenc.log`.

The addon is built by `pnpm install` and `pnpm build` (`scripts/build/nvenc.mjs`): it installs the Visual Studio C++
build tools and CMake with winget when they are missing, builds, and installs the result. It skips itself when the sources
did not change, never fails the install or the build, and `VENCORD_SKIP_NVENC=1` turns it off. See `docs/usage.md`.

`pnpm inject` then runs `scripts/build/overlays.mjs`, which writes the bundled overlays into the data folder of each Discord with
the code of `main/defaults.ts`, so they are there before Discord starts. `pnpm package` builds the Windows installer and installs
Inno Setup with winget when it is missing.

### Animations

Finite CSS animations replay when the overlay appears and play in reverse when the share stops (use
`animation-fill-mode: both`). Infinite ones keep running. Overlays without animations close at once.

## Code

| | |
|---|---|
| `index.tsx` | the plugin definition |
| `settings.ts`, `presets.ts` | the stored settings and helpers to edit them; the preset logic (no React, no store) |
| `apps.ts`, `appPresets.ts` | presets by app: matching a program to its binding (no React, no store); following the program in focus and applying / going back |
| `main/fonts.ts` | the custom fonts: the fonts folder, importing / adding / removing, the @font-face for the overlays |
| `components/FontControl.tsx`, `components/Fonts.tsx` | the font picker (built-ins, customs, adding more) and the Fonts tab |
| `components/` | the settings page: `OverlayPicker` switches between `OverlayGrid` (tabs: cards and folder tools, layout, global presets, presets by app) and `OverlayDetail` (one overlay: tabs for its settings and its presets); Discord's `TextInput`, `Slider` and select; the color picker is built here (like Discord's role color picker) because Discord's own `ColorPicker` is only filled in once Discord has loaded it |
| `encoders.ts` | which encoder the stream uses (read from Discord's voice log) and whether the overlay can be drawn into it, and whether Discord encodes at all (no React, no store, no Electron) |
| `streamState.ts` | what the sync loop knows about "stream only" for the stream that is running |
| `main/voiceLog.ts` | reads Discord's voice log (both files of its rotation): the encoder of the stream, and whether it encodes |
| `health.ts` | whether "stream only" really puts the overlay in the stream (what the hook reports, and the verdict) (no React, no store) |
| `groups.ts`, `migrate.ts` | how an overlay's settings are split into tabs and which are shown (`group`, `when`) and the grouping of the cards; moving what was saved for the old gothic overlays to the theme (no React, no store) |
| `sync.ts` | keeps the overlay window in line with the stream and the settings; collects what overlays save |
| `menu.tsx` | "Overlay Settings" in the stream menu |
| `types.ts` | types shared by both sides, no runtime code |
| `native.ts` | the IPC surface, a thin layer over `main/` |
| `main/window.ts` | the overlay window: loading, settings, show / hide / reload, saves |
| `main/page.ts` | runs a script in an overlay page and ignores the rejection of a page that is navigating or gone |
| `main/input.ts` | key states, mouse movement, cursor relay and mouse capture for the window |
| `main/keys.ts`, `main/powershell.ts` | key whitelist and the PowerShell helper: `GetAsyncKeyState` for keys and buttons, raw input for mouse movement and wheel; exits when Discord does. `powershell.ts` starts a helper and reads its lines (shared with `main/focus.ts`) |
| `main/folder.ts`, `main/defaults.ts` | the overlays folder: listing, validating names, seeding the defaults |
| `main/manifest.ts`, `main/values.ts` | reading and validating `overlay.json`, applying values to a page |
| `main/host.ts` | the page that holds every overlay as an iframe and bridges them to the main process |
| `main/display.ts`, `main/animations.ts` | finding the shared display, the enter / exit animations |
| `softwareStream.ts` | sends the stream through Windows' software encoder when the encoder of the graphics card cannot be drawn into (AMD, Intel): wraps Discord's encoder denylist for the screen share, decided from the engine's encoder list, the setting and the verdict of `sync.ts` |
| `main/nvenc.ts`, `nvenc/` | stream only: the preload script, frame transport and preview overlay; the native hook (NVENC and Windows' software encoder; `yuvblend.h` blends into frames in memory, `napi.h` is the Node-API glue, `test/` has its tests) |
| `main/layout.ts`, `components/Layout.tsx` | the Layout tab: a second offscreen overlay window whose frames the settings page asks for (answered as they are drawn) and whose mouse it feeds |
| `spotify.ts`, `main/media.ts` | the track playing in Spotify: taken from Discord's player state events in the renderer, validated in the main process (`cleanMedia`) and pushed to the overlays that set `"media": true` |
| `main/lol.ts` | the live League of Legends player (champion, spells, summoners) from the game client on this machine, polled only while an overlay with `"lol": true` is shown, with the icons from Data Dragon |
| `components/keys.ts` | the Enter / Escape handler shared by the rename and name fields |
| `painter.ts` | the WebGL setup that draws a BGRA picture on a canvas: used by the Layout tab, and its source is embedded in the preload script of `main/nvenc.ts` for the stream preview (so it has to stay self-contained) |
| `main/focus.ts` | the program in focus: a small PowerShell helper (own process, only while somebody asks) and the object `native.ts` keeps it in |
| `scripts/build/nvenc.mjs`, `scripts/build/overlays.mjs`, `scripts/package/` | outside this folder: builds and installs the native addon, writes the bundled overlays into the Discords' data folders (`pnpm inject` runs it), and builds the Windows installer (`pnpm package`: `package.mjs`, `installer.iss`, `patch.cmd`) |
