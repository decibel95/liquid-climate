# Changelog

All notable changes to Liquid Climate. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

<!-- #region entries -->
## 0.10.3

The current version.

### Changed
- Liquid Climate is in the HACS default catalog. Install docs and the README now start with searching in the Marketplace or HACS, with the custom repository link as a fallback.

## 0.10.2

### Changed
- Cards pick dark glass when the view theme's background colour is dark, even when Home Assistant itself is in light mode (per-view forced-dark themes). The `look.glass: dark` workaround is no longer needed.

## 0.10.1

### Added
- HACS validation workflow (`hacs/action`), needed for the HACS default list.

### Changed
- Install docs cover the Marketplace built into Home Assistant 2026.11 and the classic HACS flow.
- `hacs.json` drops the unused `render_readme` key.

## 0.10.0

### Added
- **Radiator valves** (TRVs, Zigbee2MQTT, Better Thermostat, generic thermostat) work as first-class units on all four cards.
- **Battery**: a `sensor` or `binary_sensor` with device class battery on the device is found by itself and shown as an attention item (dial alert, tile status line, badge, cluster room) only when low: under 20 percent, or the low flag is on. `sensors.battery` takes `auto`, `false` or an entity id, and an explicit entity also adds a `Battery 45%` figure on the dial.
- **Valve position**: the valve opening or heating demand (a percent sensor such as Pi heating demand, or a `valve` entity) shows as a `Valve 45%` figure on the dial and in the cluster room footer. `sensors.valve` takes `auto`, `false` or an entity id.
- **Window open**: a `binary_sensor` with device class window on the device (device class opening only when there is no window contact and the valve role resolves, the same in the editor and the cards) pauses the badge and the cluster room, like `pause_entity`, which still wins when set. `sensors.window` takes `auto`, `false` or an entity id.
- **`write_hold`** (default 10 seconds; the editor offers 10, 30 or 60, YAML takes 0 to 3600) on the dial, tile and cluster: how long a sent value stays on screen while a slow battery device has not reported it back. The editor has a Show sent value for choice.

### Changed
- **Dial header** follows `hvac_action` like the tile: an idle unit reads `Idle, target 20.0°` instead of `Heating to 20.0°`, and the target arc turns softer while idle. This applies to every climate entity that reports `hvac_action`.
- Diagnostics list the battery, valve and window roles.
- New strings are machine translated except Dutch.

## 0.9.0

### Added
- **Status row menu**: pick a value (`input_select`, `select`, `input_boolean`, `switch`), run scripts, toggle automations and open the entity or automation editor from a row under the dial. New row options `actions` and `menu`.
- **Languages**: English, Dutch, German, French, Spanish and Italian, following the Home Assistant profile. Dutch is reviewed, the others are machine translated. Mode, fan, swing and preset names fall back to translated names of the card when Home Assistant has none.
- **Docs site** (VitePress) with live demos of every card, a configuration reference and troubleshooting.
- **Media** for the README and docs: stills, animations and a demo video, rendered from the real cards (`npm run media`).
- **Copy diagnostics** button in the footer of all four editors: versions, config without secrets, how each sensor role was resolved and what the climate entity supports.
- **Help links** (?) in the editors that open the matching docs section.
- GitHub issue forms, a pull request template, CI and release workflows.
- Tests against the Home Assistant demo integration climate entities.

### Changed
- The fake Home Assistant of the dev harness is a shared demo module (`src/demo/`), also used by the docs.

## 0.3.0

It ships four cards, each with a visual editor.

### Added
- **Dial**: inner ring for the temperature, outer segmented ring for the fan, dual setpoint knobs, modes, swing, presets, status rows with an inline menu (values, scripts, automations, edit links).
- **Tile**: a compact row with power button and steppers. It opens the dial as a sheet.
- **Badge**: a status pill with a pause entity, an icon only mode and HA badge sizing.
- **Cluster**: every unit in one card, grouped by floor or area, with shared header figures.
- Sensor detection over the device family, with display names and per-room overrides.
- One write queue per entity, with `write_delay` batching.
- Six languages: en, nl, de, fr, es, it.
- Glass that follows the HA theme, with opaque bases for contrast and reduced motion support.
<!-- #endregion entries -->
