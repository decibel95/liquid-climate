# Pixel baseline

A screenshot of every card state, kept in `baseline/`, and a check that a fresh capture of the same
states is identical to it, pixel for pixel (tolerance 0). It exists to prove that a refactor of the
card code (for example moving it onto a shared library) changes nothing that can be seen.

## Run

```
npm ci
npx playwright install chromium   # once, if the browser is missing
npm run pixel                     # capture fresh into test/pixel/out/fresh and compare with test/pixel/baseline
npm run pixel:update              # capture straight into test/pixel/baseline (after an intended visual change)
```

`npm run pixel` exits 0 and prints `PIXEL OK` only when every baseline file has a fresh file of the same
size with identical pixels, and there is no missing or extra file. Anything else prints the files
concerned and exits 1. Diff images (differing pixels in red on a faded copy) go to `test/pixel/out/diff/`.
`test/pixel/out/` is gitignored.

Options, through `node scripts/pixel/run.mjs <check|update|compare>`:

| Option | Meaning |
| --- | --- |
| `--match <regex>` | Capture and compare only the files whose name matches (a quick check, `check` only). |
| `--concurrency <n>` | Parallel pages, default 4. |
| `--out <dir>` | Where `check` writes the fresh capture, default `test/pixel/out/fresh`. |
| `compare --out <a> --against <b>` | Compare two existing folders, for example two fresh captures. |

Example: `node scripts/pixel/run.mjs check --match '^tile-heat'`.

## How it is made

- `dev/pixel.html` and `dev/pixel.ts` stage one case per page load: a card, an open sheet or an editor, in a
  fixed state, with the English demo fixtures (`src/demo`), the radiator valve fixtures and the appliance
  fixtures. The case list is defined in `dev/pixel.ts` (`VARIANTS`, `SHEET_VARIANTS`, the cluster and editor cases).
- `dev/pixel-freeze.ts` adds `animation: none; transition: none; caret-color: transparent` (all `!important`)
  to the page and to every shadow root. Script made animations are cancelled before the capture.
- `scripts/pixel/capture.mjs` starts Vite (the dev harness) and Playwright Chromium with
  `deviceScaleFactor: 1`, a fixed viewport, `reducedMotion: 'reduce'`, `--force-color-profile=srgb`, UTC and
  `en-US`. It waits for `document.fonts.ready` and the card renders, takes an element screenshot of `#stage`
  (the sheet: the viewport) and writes it as a PNG, decoded and encoded again losslessly at zlib level 9.
- `scripts/pixel/compare.mjs` decodes both PNGs itself (`scripts/pixel/png.mjs`, no dependency) and compares
  every channel of every pixel.
- A page that never gets ready is loaded again, up to twice. Every retry is written to `test/pixel/out/retries.log`
  and counted in a `Retries: N (limit 3)` line; more than 3 retries in one run fail the run. An empty or missing
  folder (0 files compared) fails the comparison.
- `scripts/media/` is not used and not changed (it renders at 2x with motion on, for the docs).

## Matrix

File names: `<card>-<state>__glass-<dark|light>__ground-<ha-light|ha-dark|white|black>.png`. Editors do not
use the glass, so their names have no glass part.

- Cards: dial (`dial-`), tile (`tile-`), badge (`badge-`, `badge-icon-` for the icon-only badge), cluster
  (`cluster-`), sheet (`sheet-`, the dial in its modal dialog, opened from a tile), editors (`editor-`).
- States: every hvac mode with the actions it reports (off, heat heating or idle, cool cooling or idle, heat/cool
  heating, cooling or idle, auto, dry, fan only), unavailable, error, paused (badge), a status row (dial),
  radiator valve (idle, heating, off, window open, low battery), water heater (eco, performance, heat pump,
  off), humidifier, dehumidifier and hygrostat.
- Grounds: HA light (`#fafafa`, light theme variables), HA dark (`#111111`, dark theme variables), white and black
  (with the light and dark theme variables).

The file `baseline/environment.json` records the Playwright, Chromium and font set the baseline was made with.

## Audit of the animation freeze (2026-11-18)

`grep -rn '@keyframes\|animation' src` lists every animation of the cards. None has a visible end state that only
an animation reaches, so `animation: none` is the right freeze and nothing needed `getAnimations().finish()`:

- Endless animations (`lcRise`, `lcFall`, `lcDrip`, `lcDrift` particles, `lcSpin`, `lcOsc`, `lcClimb`, `lcFlick`,
  `lcDot`) have no end state. With `reducedMotion: 'reduce'` the cards already switch most of them off, hide
  the particles and the pointer glow, so these are not in the baseline at all.
- Finite animations: `lcPop` (0.35 s, ends at `scale(1)`, the same as no animation), `lcSheetIn` (ends at
  `opacity 1; transform none`, the same as none) and `lcFill` (the write-delay progress bar, `forwards`, ends at
  `scaleX(1)`, the width of the element without animation; it only exists while a write is pending, which no case does).

A new animation with `animation-fill-mode: forwards` to a state that differs from the plain style must be added to
this audit, and the freeze changed to finish animations for it.

The injected `<style data-pixel-freeze>` is the first child of every shadow root. A grep of `src` for
`firstElementChild`, `firstChild`, `childElementCount`, `:first-child`, `:last-child`, `:only-child`, `nth-child` and
`:empty` finds only `.status .srow:last-child`, `.mrow > .mitem:first-child`, `.merr:empty` and
`.status .row:last-child`. They all select inside the card's own markup and none reads the children of a shadow
root, so the extra node changes nothing. The media page (`dev/media-focus.ts`) relies on the same trick.

## Limits

- The comparison decodes the pixels only. PNG ancillary chunks (colour profile, gamma, text) are not compared; the
  capture re-encodes every PNG without them, and the colour is fixed by `--force-color-profile=srgb`.
- The font stack is `Inter, system-ui, ...` and Inter is not bundled, so text is drawn with whatever font the
  machine resolves for it (see `fonts` in `environment.json`). A baseline is only valid on a machine with the same
  Chromium build and the same fonts. On another machine run `npm run pixel:update` on unchanged code first,
  commit that as the machine's baseline, and only then change the cards.
- The ground is a flat colour, so the glass blur has nothing to blur except the card's own shadow and, in the
  sheet, the card behind the dialog.
- Bundle size at HEAD (`npm run build`, `dist/liquid-climate.js`): 318,255 bytes raw, equal to the v0.11.1 release asset;
  `gzip -9` 84,282 bytes, default `gzip` 85,190 bytes.
- Hover, press and the pointer glow need a pointer: none of them is part of the baseline. The status menu and the
  dropdown menus (open state) are not captured.
