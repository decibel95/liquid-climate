# Changelog

All notable changes to Liquid Climate. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

<!-- #region entries -->
## 0.13.1

The current version.

### Changed
- The README now links to the other Liquid projects (Liquid Home and the liquid-core design library), shows what is on the roadmap, and invites feature requests. Nothing in the cards changes.

## 0.13.0

### Added
- Polish, contributed by @jkmikke, with a few small fixes on top.

## 0.12.2

### Changed
- The README install instructions are clearer about what to do if the HACS search does not find Liquid Climate.

## 0.12.1

### Changed
- Under the hood, Liquid Climate now shares its building blocks with the Liquid Home cards, so both stay alike on one dashboard. Your cards look and work exactly as before.
- The README is shorter and points to the documentation for the details.

## 0.12.0

### Added
- **History button** on the dial, next to the power button. It opens the Home Assistant history page for that entity. From a tile, badge or cluster, it closes the dial first.
- The button shows by default after updating. To hide it, turn off History button in the Controls tab of the dial editor, or add `show_history: false` to the card.
- The History button switch is also in the tile, badge and cluster editors, for the dial they open.
- The button also shows on a dial that is unavailable or whose entity is missing, so you can see its last known history.
- Liquid Climate now ships the Inter font, so the cards look the same on every device, whatever fonts it has installed. Manual installs: copy the two new files `liquid-inter.woff2` (the font) and `liquid-inter-OFL.txt` (its licence) to `/config/www/` next to `liquid-climate.js`.

### Fixed
- A dial opened for an unavailable or missing device now always has a Close button.

## 0.11.1

### Added
- **Water heaters and humidifiers** (including dehumidifiers) now work on the dial, tile, badge and cluster, right next to your climate devices.
- Water heaters get their operation modes and an Away switch.
- Humidifiers get a target humidity and their modes.
- In a cluster they are opt-in: add `domains` to pick them.

### Changed
- Water heaters and humidifiers look exactly like your climate cards: the same colours (heat, cool and dry), the same line icons and the same calm scale.
- Mode buttons no longer show a hover tooltip.

## 0.11.0

### Added
- **Water heaters and humidifiers** work on all four cards, next to climate. The dial, tile, badge and cluster read the entity's own features and hide what it does not support.
- Water heater: the temperature arc (`min_temp`, `max_temp`, `target_temp_step`, else 0.5 in Celsius and 1 in Fahrenheit), the tank temperature as the current figure, the operation modes as mode buttons, power through `turn_on` and `turn_off` (or the operation mode `off` without them) and an Away chip. No fan ring.
- Humidifier: the target humidity arc in % (`min_humidity`, `max_humidity`, `target_humidity_step`), the current humidity in the centre, `available_modes` as mode buttons, on and off, and the `action` (Humidifying, Drying, Idle) on the status line. No fan ring.
- Each known water heater and humidifier mode has its own Material Design icon, and the water heater mode buttons use short labels of up to 6 letters (Elec, Perf, High, Pump) with the full name in the tooltip and for screen readers.
- Colours: water heater `#ff6a3d`, humidifier `#5b8cff`, dehumidifier `#2fbfa0`, listed in Theming.
- Cluster option `domains` (default `[climate]`): water heaters and humidifiers join the automatic modes only when picked, so existing clusters do not change. An `entities` list takes any of the three. No `config_version` change: the option is additive.
- The cluster's default title is "Comfort" (translated) once water heaters or humidifiers can be rooms; climate-only clusters keep "Climate". A set `title` always wins.
- Mode names for the known operation modes (eco, electric, performance, high_demand, heat_pump, gas) and humidifier modes (normal, eco, away, boost, comfort, home, sleep, auto, baby) in all six languages. Home Assistant's own translation wins; unknown values are made readable.
- Demo and docs: the water heaters and humidifiers of Home Assistant's demo integration.
- Docs: screenshots and an animation of water heater and humidifier dials.
- The editors' Setup sensor field follows the entity: Room temperature sensor for climate, Water temperature sensor for a water heater, Humidity sensor for a humidifier, each suggesting matching sensors. Sensor roles that mean nothing for the domain (room humidity, valve and window for a water heater; humidity, outdoor and valve for a humidifier) are not detected and leave the Sensors tab unless set explicitly.

### Changed
- A water heater or humidifier steps on multiples of its step, so a water heater with limits 43.3 to 60 steps 45, 46, 47. Climate units step from `min_temp` as before.
- The humidity scale (0 to 100) ticks every 2 and labels every 20. Climate scales are unchanged.
- The editors' entity picker lists climate, water heater and humidifier entities and is labelled "Entity"; climate-only controls are hidden for the others.

## 0.10.3

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
