# StreamOverlay docs

StreamOverlay draws HTML/CSS overlays (a red border, a keyboard, a mouse, what is playing in Spotify, or your own) over the screen you share with
Discord's Go Live, so viewers see them. Windows desktop client only.

| | |
|---|---|
| [usage.md](usage.md) | installing, turning things on, the settings page, "stream only", troubleshooting |
| [how-it-works.md](how-it-works.md) | the architecture: the overlay window, the stream-only pipeline, the native encoder hook |
| [../README.md](../README.md) | writing your own overlay (`overlay.json`, messages, animations) and the code layout |

## What it adds

**Overlays**
- Overlays are small web pages in a folder. Four are provided: `red-border`, `keyboard` (live key states), `mouse`
  (buttons, movement and wheel) and `spotify` (the track that is playing, with its cover and progress).
- They are drawn in a transparent, click-through window over the monitor being shared, and only while a screen share is
  running.
- The keyboard, mouse and Spotify overlays can be moved and resized with Alt + Caps; the position is remembered.

**Settings page**
- A card per overlay with a switch (grouped under Input, Media and Frames), and a page per overlay with its own settings (colors,
  sizes, toggles) split into tabs. The keyboard, mouse and Spotify card come in a default and a gothic theme, and more; the Spotify card can also hang on an edge of the screen (the Banner theme).
- A **Layout** tab: the overlays as they are drawn over the screen (at its full resolution, 60 Hz, over a still of it),
  where the draggable ones can be moved and resized with the mouse, also in full screen.
- **Presets** per overlay and **global presets** (which overlays are on plus all their settings), with save, apply,
  rename, duplicate, update, delete and undo.
- **Presets by app**: bind a global preset to a program (`game.exe`); it is applied while that program is in focus and
  put back afterwards.

**Stream only** (on by default)
- Keeps the overlays off your own screen: they are blended into the video that Discord encodes, so viewers see them and
  you don't. The in-app preview of your stream gets a matching overlay on top.
- Needs NVENC (an NVIDIA GPU) or Windows' software H.264 encoder, and a small native addon built from `nvenc/`. A stream on the encoder of an AMD or Intel card is sent through the software encoder; when the stream still cannot be drawn into, the overlays stay on your screen.
