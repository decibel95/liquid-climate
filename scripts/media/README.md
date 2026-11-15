# Media pipeline

Renders the stills, animations and demo video for the README and docs into `docs/public/media/`.
Everything is generated from the real cards on a staging page (`dev/media.html`), nothing is
drawn by hand.

## Run

```
npm install
npm run media              # everything, about 3 minutes
npm run media -- stills    # only the PNG stills
npm run media -- animations [name ...]   # only the animations (dial-drag, mode-switch, sheet-open, status-menu, language)
npm run media -- demo      # only demo.mp4 (the poster comes with the stills)
```

An unknown step or animation name stops with a message and exit code 1.

A full run empties `docs/public/media/` first, starts Vite on a free port, renders, and shuts
everything down again. No manual steps.

## Prerequisites

- Node 20 or newer and `npm install` (installs `playwright` and `ffmpeg-static`).
- A Chromium: `npx playwright install chromium`. If that browser is missing, the script falls back to
  an installed Google Chrome or Microsoft Edge. With none of them it stops with a clear message.
- ffmpeg comes from `ffmpeg-static`. Set `FFMPEG=/path/to/ffmpeg` to use another build
  (it needs libx264 and libwebp_anim).

## Staging page

`dev/media.html` and `dev/media.ts`. No harness chrome, English names and entity ids only (the Dutch
fixture ids are remapped), fixed states, HA's default light and dark theme variables, and a small
`formatEntityState` (On/Off, Aan/Uit, An/Aus and so on) like the HA frontend provides. The mode tint of
the glass is set to 0, so the mode colour stays on the arc, the knob and the active mode.

Query parameters: `scene` (`hero`, `dial`, `tile`, `badge`, `cluster`, `editor`, `cluster-editor`,
`status-menu`, `sheet`), `theme` (`light`, `dark`, `split`), `lang` (`en`, `nl`, `de`, `fr`, `es`, `it`),
`cursor=1` (a pointer for recordings: hidden until `__media.pointer(true)`). The page sets `window.__mediaReady` once fonts and all
cards have rendered. Open it with `npm run dev` at `/dev/media.html?scene=hero`.

## Files

| Module | Role |
| --- | --- |
| `run.mjs` | Entry: clears the output, starts Vite and the browser, runs the steps. |
| `server.mjs` | Starts Vite programmatically on a free port. |
| `browser.mjs` | Launches Chromium (Chrome and Edge as fallback), opens a scene and waits for it. |
| `stills.mjs` | PNG stills at 2x, light and dark, plus the split hero. |
| `input.mjs` | Human-paced pointer moves, clicks and drags, and dial ring coordinates. |
| `capture.mjs` | Frame capture with the DevTools screencast, with timestamps. |
| `animations.mjs` | The interaction scripts and the five animations. |
| `demo.mjs` | The longer video: the same scripts chained on the hero scene. |
| `encode.mjs` | ffmpeg: GIF (palette per clip), animated WebP, H.264 MP4. |

## Output

- `hero-{light,dark,split}.png`, `dial-*`, `tile-*`, `badge-*`, `cluster-*`, `editor-*`,
  `cluster-editor-*`, `status-menu-*` (light and dark, 2x).
- `dial-drag`, `mode-switch`, `sheet-open`, `status-menu`, `language`: animated `.webp` (800 px wide,
  encoded at 30 fps; identical neighbouring frames are merged by the encoder, so the stored frame
  count averages about 25 per second while the timing stays real) and a `.gif` fallback (scaled down
  to 400 to 480 px at 10 to 15 fps to stay near 3 MB).
- `demo.mp4` (1920x1080, 30 fps, H.264 crf 18, no audio) and `demo-poster.png` (the first state of the demo
  scene, rendered as a still, so it has no pointer).

## How capture works

Chromium runs headless at a device scale factor of 2 with motion enabled. The scripts drive the
cards with real mouse events. `Page.startScreencast` delivers a JPEG (quality 100) for each paint with
its timestamp; ffmpeg resamples them to a constant frame rate from those timestamps, so the timing
matches what happened on screen. A small translucent pointer is injected into the page (it fades in at its first target, shrinks on press
and fades out where it ends) because headless Chrome draws no cursor. Each script ends in the
state it started in so the loops close; the status menu script checks that.

Stills pause the endless animations (particles, spin) at their start and wait for transitions to finish,
so re-runs match. The animations keep the motion. The status menu clip is sized for the open menu, so the whole menu
and the card's bottom edge stay in frame. Focus rings are switched off on the staging page
(`dev/media-focus.ts`), because programmatic focus would draw them in the clips. Captured frames go to the
system temp folder and are removed at the end of a run.
