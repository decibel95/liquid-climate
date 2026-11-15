# Changelog

All notable changes to Liquid Climate. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

<!-- #region entries -->
## 0.9.0

The current version.

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
