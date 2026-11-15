# Tile card {#tile}

A compact glass row: power button, name and status, target steppers. Type: `custom:liquid-climate-tile`.

<img class="light-only" src="/media/tile-light.png" alt="The tile card in light glass" loading="lazy">
<img class="dark-only" src="/media/tile-dark.png" alt="The tile card in dark glass" loading="lazy">

<LiveCard type="tile" />

The demo runs on fake data. Changes stay in your browser.

```yaml
type: custom:liquid-climate-tile
entity: climate.living_room
```

## Behavior {#tile-behavior}

- The power button turns the unit off, and back on to the last mode it was seen in during this browser session. With nothing seen yet it picks heat, cool, heat_cool, auto, fan_only or dry, the first one the entity supports. It is tinted with the mode colour while on, and the flame flickers only while the unit is actually heating.
- The status line uses `hvac_action` when the entity reports one (Heating, Idle) and the mode otherwise, followed by the room temperature, for example `Heating, 17.3° inside`.
- The steppers move the target by `target_temp_step` within `min_temp` and `max_temp`. They are disabled while off, unavailable or in a mode without a setpoint. Presses are collected for `write_delay` seconds and sent as one call, the same as the dial.
- A dual setpoint shows the range, for example 19.0 to 24.0°, without steppers. Tapping it opens the sheet.
- When a health problem flag is on, the power button turns red with an alert icon and the status line reads `Error`, plus the error code when there is one. Screen readers hear it through a live region.
- `unavailable` and `unknown` both show `Unavailable` with every control disabled.

<LiveCard type="tile" :config="{ entity: 'climate.studio' }" />

## Options {#tile-options}

| Option | Default | Description |
|--------|---------|-------------|
| `entity` | required | Climate entity |
| `name` | entity name | Name on the tile |
| `temperature_sensor` | | Room temperature shown instead of the entity's own reading |
| `tap_action` | `sheet` | Tap on the name: `sheet` (dial), `more-info` or `none` |
| `write_delay` | `1.5` | Seconds to collect presses before sending, `0` sends immediately |
| `sensors.health` | `auto` | As on the dial: `auto`, `false` or entity ids. Decides the error state of the power button and status line |
| `look` | | `glass`, `blur` and `motion` as for the dial. `motion: minimal` stops the flame. `look.tint` has no effect on the tile, it is passed to the dial sheet |
| `config_version` | `1` | Written by the editor |

Every dial option can sit in the tile config too and is passed to the dial it opens. The tile itself only reads `sensors` (for the error state, see `sensors.health`). `controls` (including `controls.modes`) and `status_entities` do not change the tile, the power button always picks from the modes the entity supports. `look.tint` has no effect on the tile.

```yaml
type: custom:liquid-climate-tile
entity: climate.bedroom
name: Bedroom
temperature_sensor: sensor.bedroom_temperature
tap_action: sheet
controls:
  modes: [off, heat, cool]
```

## Editor groups {#tile-editor}

### Climate entity {#tile-entity}

Pick the climate entity. Option: `entity`.

### Name {#tile-name}

Empty uses the entity name. Option: `name`.

### Room temperature sensor {#tile-room-sensor}

A temperature sensor shown instead of the unit's own reading. Option: `temperature_sensor`.

### Tap on the name {#tile-tap-action}

Choices: Open dial (`sheet`), More info (`more-info`), Nothing (`none`). Option: `tap_action`.

Tapping the name with `sheet` opens the dial in a sheet, a modal dialog above the dashboard. Escape, the close button or a click outside closes it. The tile, the dial in its sheet and any other Liquid Climate card on the same entity share one write queue, so their changes go out together.

<img src="/media/sheet-open.webp" alt="Tapping the tile name opens the dial as a sheet" loading="lazy">

### Write delay {#tile-write-delay}

Seconds to collect presses before sending. Choices: Instant (`0`), 1 s, 1.5 s, 3 s. Option: `write_delay`.

### Look {#tile-look}

Glass, mode tint, blur and motion. Options: `look.glass`, `look.tint`, `look.blur`, `look.motion`. Mode tint has no effect on this card, it is passed to the dial sheet. See [Theming](/theming).

The editor notes that dial options in the tile config (sensors, controls, status rows) apply to the dial it opens. Those are set in YAML, see the [dial options](/cards/dial#dial-options).
