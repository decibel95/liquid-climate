# Dial card {#dial}

Full control for one climate unit. Type: `custom:liquid-climate-card`.

<img class="light-only" src="/media/dial-light.png" alt="The dial card in light glass" loading="lazy">
<img class="dark-only" src="/media/dial-dark.png" alt="The dial card in dark glass" loading="lazy">

<LiveCard type="dial" />

The demo runs on fake data. Changes stay in your browser.

## How it works {#dial-how}

- The inner ring sets the temperature. The outer segmented ring sets the fan speed. Both are draggable.
- Controls the entity does not support are hidden, whatever the config says.
- Dual setpoint entities (`target_temp_low` and `target_temp_high`) get two knobs.
- Humidity, outdoor temperature, energy, cloud rate limit and unit health are found by themselves, see [Sensors](/sensors).
- Changes are collected for `write_delay` seconds and sent as the minimum number of service calls.

<img src="/media/dial-drag.webp" alt="Dragging the temperature ring on the dial" loading="lazy">

### Dual setpoint {#dial-dual}

An entity with `target_temp_low` and `target_temp_high` shows two knobs on one arc.

<LiveCard type="dial" :config="{ entity: 'climate.studio' }" />

### Fahrenheit {#dial-fahrenheit}

Units and steps follow the entity.

<LiveCard type="dial" :config="{ entity: 'climate.fahrenheit' }" />

### Keyboard {#dial-keyboard}

Focus the dial and use the arrow keys to step the setpoint, Home and End for the limits, Page Up and Page Down for the fan speed. On a dual setpoint each knob is its own slider. On the dial itself plain arrows move the lower knob and Shift plus an arrow the upper knob.

## Options {#dial-options}

Only `entity` is required.

| Option | Default | Description |
|--------|---------|-------------|
| `entity` | required | Climate entity |
| `name` | entity name | Name on the dial |
| `temperature_sensor` | | Room temperature shown instead of the entity's own reading |
| `sensors.humidity` | `auto` | `auto`, `false` (hide), an entity id or `{entity, name}` |
| `sensors.outdoor` | `auto` | As above |
| `sensors.energy` | `auto` | As above, or a list of them. Today's energy, heating plus cooling |
| `sensors.cloud_limit` | `auto` | As above |
| `sensors.health` | `auto` | As above, or a list of them |
| `controls.modes` | `[off, heat, cool, heat_cool, auto, dry, fan_only]` | Modes shown as buttons |
| `controls.fan` | `true` | Fan ring |
| `controls.swing` | `true` | Vertical swing |
| `controls.swing_horizontal` | `true` | Horizontal swing |
| `controls.presets` | `true` | Presets |
| `write_delay` | `1.5` | Seconds to collect changes before sending, `0` sends immediately |
| `status_entities` | `[]` | Rows under the dial, see [Status rows](/status-rows) |
| `look.glass` | `theme` | `theme` (dark or light by the HA mode), `dark` or `light` |
| `look.tint` | `0.09` | Mode tint opacity |
| `look.blur` | `30` | Backdrop blur in px |
| `look.motion` | `rich` | `rich`, `subtle` or `minimal` |
| `config_version` | `1` | Written by the editor, lets later releases migrate old configs |

A full example:

```yaml
type: custom:liquid-climate-card
entity: climate.living_room
name: Living Room
temperature_sensor: sensor.living_room_temperature
sensors:
  humidity: auto
  outdoor: auto
  energy: auto
  cloud_limit: auto
  health: auto
controls:
  modes: [off, heat, cool, heat_cool, auto, dry, fan_only]
  fan: true
  swing: true
  swing_horizontal: true
  presets: true
write_delay: 1.5
status_entities:
  - entity: input_boolean.living_room_pause
    name: Window pause
    icon: mdi:window-open
look:
  glass: theme
  tint: 0.09
  blur: 30
  motion: rich
config_version: 1
```

## Editor groups {#dial-editor}

The visual editor has four tabs. Each group below links to its option.

### Climate entity {#dial-entity}

Setup tab. Pick the climate entity. Option: `entity`.

### Name {#dial-name}

Setup tab. Leave it empty to use the entity name. Option: `name`.

### Room temperature sensor {#dial-room-sensor}

Setup tab. Some units report whole degrees only. Pick a separate temperature sensor to show a more precise room temperature. When the unit reports whole degrees and a temperature sensor sits in the same area, the editor offers it with **Use it**. Option: `temperature_sensor`.

For Daikin Onecta the Setup tab also notes that changes are sent after `write_delay`.

### Sensors {#dial-sensors}

Sensors tab. Shows what was found for humidity, outdoor temperature, energy today, cloud call limit and unit health. **Change** picks another entity and sets a display name. The switch hides a role. Option: `sensors`, see [Sensors](/sensors).

```yaml
sensors:
  humidity: { entity: sensor.kitchen_humidity, name: Kitchen humidity }
  outdoor: { entity: auto, name: Garden }
  energy: [sensor.unit_heating_today, sensor.unit_cooling_today]
  cloud_limit: false
  health:
    - { entity: binary_sensor.unit_error, name: Indoor unit }
    - sensor.unit_error_code
```

### Modes {#dial-modes}

Controls tab. Pick the modes shown as buttons. Modes the entity does not support never show. Option: `controls.modes`.

<img src="/media/mode-switch.webp" alt="Switching the mode on the dial" loading="lazy">

```yaml
controls:
  modes: [off, heat, cool]
```

### Fan, swing and presets {#dial-controls}

Controls tab. Four switches: Fan ring, Vertical swing, Horizontal swing and Presets. Each is hidden when the entity has no such modes. Options: `controls.fan`, `controls.swing`, `controls.swing_horizontal`, `controls.presets`.

### Write delay {#dial-write-delay}

Controls tab. Changes are collected for this many seconds and sent as the minimum number of service calls, so one drag is one call. Choices: Instant (`0`), 1 s, 1.5 s (default), 3 s. Option: `write_delay`.

The dial, the tile, the badge, the cluster and any other Liquid Climate card on the same entity share one write queue per entity. Their changes go out together.

### Status rows {#dial-status-rows}

Controls tab. Rows under the dial, each with an entity, a name and an icon. Option: `status_entities`. Rows can open a menu with an Actions list and a Show menu switch, see [Status rows](/status-rows).

### Look {#dial-look}

Look tab. Glass, mode tint, blur and motion. Options: `look.glass`, `look.tint`, `look.blur`, `look.motion`. See [Theming](/theming).

| Setting | Values |
|---------|--------|
| Glass | Auto (`theme`), Dark, Light |
| Mode tint | 0 to 30 percent |
| Blur | 8 to 60 px |
| Motion | Rich, Subtle, Minimal |

`prefers-reduced-motion` always turns the particle and spin animations off.

## Modes, chips and the sheet {#dial-sheet}

The mode buttons show the modes the entity supports. Vertical swing, horizontal swing and presets show as chips under the dial. Tapping a chip steps to the next value. Mode, fan, swing and preset names come from Home Assistant's own translations when it has them.

The [tile](/cards/tile), the [badge](/cards/badge) and the [cluster](/cards/cluster) open this same dial in a sheet, with the dial options of their own config.

<img src="/media/sheet-open.webp" alt="The dial opened as a sheet" loading="lazy">
