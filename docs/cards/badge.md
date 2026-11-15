# Badge card {#badge}

A glass pill with the status icon, the name and one value. Type: `custom:liquid-climate-badge`. Works as a view badge (Edit dashboard, Badges) and as a card in a grid.

<img class="light-only" src="/media/badge-light.png" alt="The badge card in light glass" loading="lazy">
<img class="dark-only" src="/media/badge-dark.png" alt="The badge card in dark glass" loading="lazy">

<LiveCard type="badge" />

The demo runs on fake data. Changes stay in your browser.

```yaml
badges:
  - type: custom:liquid-climate-badge
    entity: climate.living_room
    pause_entity: binary_sensor.living_room_window
```

## The value {#badge-value}

The value is the first that applies:

| Value | When | Colour |
|-------|------|--------|
| Error | A health problem flag is on (error codes are only detail, as on the dial) | red |
| Paused | `pause_entity` is `on` | amber |
| `--` | The climate entity is unavailable, unknown or missing | grey |
| Off | The unit is off | grey |
| `21.0°` | Otherwise: the room temperature (`temperature_sensor` wins) | mode colour |

On light glass the amber, red and fan colours are drawn darker so they stay readable.

## Options {#badge-options}

| Option | Default | Description |
|--------|---------|-------------|
| `entity` | required | Climate entity |
| `name` | entity name | Name on the badge |
| `temperature_sensor` | | Room temperature shown instead of the entity's own reading |
| `pause_entity` | | Entity that shows the badge as Paused while `on`, for example a window contact |
| `icon_only` | `false` | Round icon badge |
| `tap_action` | `more-info` | `more-info`, `sheet` (dial) or `none` |
| `sensors.health` | `auto` | As on the dial: `auto`, `false` or entity ids |
| `look` | | `glass`, `blur` and `motion`. `motion: minimal` stops the dot pulsing |
| `config_version` | `1` | Written by the editor |

```yaml
type: custom:liquid-climate-badge
entity: climate.bedroom
icon_only: true
tap_action: sheet
```

## Editor groups {#badge-editor}

### Climate entity {#badge-entity}

Pick the climate entity. Option: `entity`.

### Name {#badge-name}

Empty uses the entity name. Option: `name`.

### Room temperature sensor {#badge-room-sensor}

A temperature sensor shown instead of the unit's own reading. Option: `temperature_sensor`.

### Pause entity {#badge-pause}

While this entity is `on`, the badge shows Paused. Use a window contact, for example. The editor lists `binary_sensor`, `input_boolean` and `switch` entities. Option: `pause_entity`.

<LiveCard type="badge" :config="{ entity: 'climate.living_room', pause_entity: 'input_boolean.window' }" />

In the demo, the pause entity is the helper `input_boolean.window`.

### Icon only {#badge-icon-only}

`icon_only: true` shows a round badge with just the icon. It gets a pulsing dot for Error and Paused only. Screen readers always hear "Name: value".

<LiveCard type="badge" :config="{ entity: 'climate.living_room', icon_only: true }" />

### Tap action {#badge-tap-action}

Choices: More info (`more-info`, the default), Open dial (`sheet`), Nothing (`none`). Option: `tap_action`.

### Look {#badge-look}

Glass, mode tint, blur and motion. Options: `look.glass`, `look.tint`, `look.blur`, `look.motion`. Mode tint has no effect on this card, it is passed to the dial sheet. See [Theming](/theming).

## Size and theme {#badge-size}

The badge has HA's own badge size and type: 36px high, 18px icon, a 10px name over a 12px value. It reads HA's theme variables, so a theme or font scale changes it the same way as the built-in badges: `--ha-badge-size`, `--ha-badge-border-radius`, `--ha-badge-icon-size`, `--ha-badge-font-size`, `--ha-font-size-xs`, `--ha-font-size-s`, `--ha-font-weight-medium`, `--ha-line-height-condensed` and `--ha-space-2`.
