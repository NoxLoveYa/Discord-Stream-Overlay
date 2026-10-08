# StreamOverlay

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

The defaults in `defaultOverlays/` are copied into the default folder once (see `main/defaults.ts`); edit the copies.

### overlay.json

```json
{
    "keys": ["W", "SHIFT"],
    "interactive": ["ALT", "CAPS"],
    "settings": [
        { "id": "accent", "type": "color", "label": "Accent", "default": "#8b5cf6" },
        { "id": "width", "type": "number", "label": "Width", "min": 1, "max": 32, "step": 1, "unit": "px", "default": 4 },
        { "id": "glow", "type": "boolean", "label": "Glow", "default": true },
        { "id": "corner", "type": "select", "label": "Corner", "default": "left", "options": ["left", "right"] },
        { "id": "x", "type": "number", "label": "X", "min": 0, "max": 20000, "default": 0, "hidden": true }
    ]
}
```

- `settings`: a control per entry in the plugin settings while the overlay is active (`hidden` ones are only set by the
  overlay itself). Each value reaches the page as:
  - a CSS variable on `<html>`: `--id` (numbers get their `unit`, booleans are `1` / `0`); colors also get `--id-rgb`
    (`"139 92 246"`), which allows `rgb(var(--accent-rgb) / 50%)`
  - a `data-id` attribute on `<html>`, for selectors like `html[data-corner="right"]`
  - a `streamoverlay:settings` event on `window` (`detail` holds every value)
- `keys`: key states the page may receive. Only these are read, only while the overlay is visible. Allowed names are in
  `main/keys.ts` (letters, digits, `SHIFT`, `CTRL`, `ALT`, `CAPS`, `SPACE`, `TAB`, `ENTER`, `ESC`, arrows).
- `interactive`: while all these keys are held the window takes the mouse instead of passing clicks through.

Everything in `overlay.json` is validated (`main/manifest.ts`, `main/values.ts`): invalid entries are dropped, invalid
values fall back to the default.

### Messages

Sent to the page (`window.addEventListener("message", ...)`, ignore anything whose `source` is not `parent`):

| `type` | payload | when |
|---|---|---|
| `streamoverlay:keys` | `down: string[]` | the state of the requested keys changed (also sent once the page loads) |
| `streamoverlay:pointer` | `x`, `y` | the cursor moved, in page coordinates (interactive overlays only) |

Sent by the page: `parent.postMessage({ type: "streamoverlay:save", values: { id: value } }, "*")` stores values in the
settings (only declared ids are accepted, validated). The keyboard overlay uses it to remember where it was dragged to.

### Animations

Finite CSS animations replay when the overlay appears and play in reverse when the share stops (use
`animation-fill-mode: both`). Infinite ones keep running. Overlays without animations close at once.

## Code

| | |
|---|---|
| `index.tsx` | the plugin definition |
| `settings.ts`, `components/` | settings and the settings window (native color/slider controls on purpose: Discord's are filled in lazily) |
| `sync.ts` | keeps the overlay window in line with the stream and the settings; collects what overlays save |
| `menu.tsx` | "Overlay Settings" in the stream menu |
| `types.ts` | types shared by both sides, no runtime code |
| `native.ts` | the IPC surface, a thin layer over `main/` |
| `main/window.ts` | the overlay window: loading, settings, show / hide / reload, saves |
| `main/input.ts` | key states, cursor relay and mouse capture for the window |
| `main/keys.ts` | key whitelist and the PowerShell poller (`GetAsyncKeyState`, exits when Discord does) |
| `main/folder.ts`, `main/defaults.ts` | the overlays folder: listing, validating names, seeding the defaults |
| `main/manifest.ts`, `main/values.ts` | reading and validating `overlay.json`, applying values to a page |
| `main/host.ts` | the page that holds every overlay as an iframe and bridges them to the main process |
| `main/display.ts`, `main/animations.ts` | finding the shared display, the enter / exit animations |
