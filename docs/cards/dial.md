# Dial card {#dial}

Full control for one climate unit, water heater or humidifier. Type: `custom:liquid-climate-card`.

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
- The header uses `hvac_action` when the entity reports it. A radiator valve that has reached its target reads `Idle, target 20.0°` instead of `Heating to 20.0°`, and the target arc turns softer while it is idle.
- Radiator valves: a low battery shows as an alert, the valve opening as a `Valve 45%` figure. See [Radiator valves](/sensors#sensors-valves).

<img src="/media/dial-drag.webp" alt="Dragging the temperature ring on the dial" loading="lazy">

### Dual setpoint {#dial-dual}

An entity with `target_temp_low` and `target_temp_high` shows two knobs on one arc.

<LiveCard type="dial" :config="{ entity: 'climate.studio' }" />

### Fahrenheit {#dial-fahrenheit}

Units and steps follow the entity.

<LiveCard type="dial" :config="{ entity: 'climate.fahrenheit' }" />

### Water heater {#dial-water-heater}

A `water_heater` entity: the arc sets `temperature` between `min_temp` and `max_temp` in `target_temp_step` steps (0.5 in Celsius, 1 in Fahrenheit when it reports none). The centre shows `current_temperature` when the heater reports it. The operation modes are the mode buttons; `off` is the power button. Power uses `turn_on` and `turn_off` when the heater supports them, else the operation mode `off`. Away mode is a chip when the heater supports it. There is no fan ring. The colour is the heat colour.

<img class="light-only" src="/media/appliances-light.png" alt="A water heater dial with its mode strip (Eco, Elec, Perf, High, Pump, Gas) and an Away chip, next to a humidifier dial at 55%" loading="lazy">
<img class="dark-only" src="/media/appliances-dark.png" alt="A water heater dial with its mode strip (Eco, Elec, Perf, High, Pump, Gas) and an Away chip, next to a humidifier dial at 55%" loading="lazy">

<LiveCard type="dial" :config="{ entity: 'water_heater.demo_water_heater_celsius' }" />

```yaml
type: custom:liquid-climate-card
entity: water_heater.boiler
```

### Humidifier {#dial-humidifier}

A `humidifier` entity: the arc sets `humidity` in % between `min_humidity` and `max_humidity` (0 to 100 by default) in steps of `target_humidity_step` or 1. The centre shows `current_humidity`. The header follows `action` (Humidifying, Drying, Idle) as it follows `hvac_action` on climate. `available_modes` become mode buttons when the entity supports modes. Power is `turn_on` and `turn_off`. There is no fan ring. A humidifier uses the cool colour, a dehumidifier (`device_class: dehumidifier`) the dry colour.

<LiveCard type="dial" :config="{ entity: 'humidifier.hygrostat' }" />

```yaml
type: custom:liquid-climate-card
entity: humidifier.bedroom
```

<img src="/media/appliances.webp" alt="Switching the water heater mode from Eco to Heat pump and back, then dragging the humidifier target from 55 to 60 percent and back" loading="lazy">

The climate-only options (`controls`, the fan, swing and preset rows) have no effect on a water heater or humidifier, and the editor hides them.

### Keyboard {#dial-keyboard}

Focus the dial and use the arrow keys to step the setpoint, Home and End for the limits, Page Up and Page Down for the fan speed. On a dual setpoint each knob is its own slider. On the dial itself plain arrows move the lower knob and Shift plus an arrow the upper knob.

## Options {#dial-options}

Only `entity` is required.

| Option | Default | Description |
|--------|---------|-------------|
| `entity` | required | Climate, water heater or humidifier entity |
| `name` | entity name | Name on the dial |
| `temperature_sensor` | | Room temperature shown instead of the entity's own reading |
| `sensors.humidity` | `auto` | `auto`, `false` (hide), an entity id or `{entity, name}` |
| `sensors.outdoor` | `auto` | As above |
| `sensors.energy` | `auto` | As above, or a list of them. Today's energy, heating plus cooling |
| `sensors.cloud_limit` | `auto` | As above |
| `sensors.health` | `auto` | As above, or a list of them |
| `sensors.battery` | `auto` | As above. Shown as an alert only when low. An explicit entity adds a `Battery 45%` figure |
| `sensors.valve` | `auto` | As above. Valve opening or heating demand, shown as `Valve 45%` |
| `sensors.window` | `auto` | As above. Read by the badge and the cluster, not by the dial |
| `controls.modes` | `[off, heat, cool, heat_cool, auto, dry, fan_only]` | Modes shown as buttons |
| `controls.fan` | `true` | Fan ring |
| `controls.swing` | `true` | Vertical swing |
| `controls.swing_horizontal` | `true` | Horizontal swing |
| `controls.presets` | `true` | Presets |
| `write_delay` | `1.5` | Seconds to collect changes before sending, `0` sends immediately |
| `write_hold` | `10` | Seconds a sent value stays on screen while the device has not reported it back |
| `status_entities` | `[]` | Rows under the dial, see [Status rows](/status-rows) |
| `show_history` | `true` | History button in the header, opens Home Assistant's history page for the entity. `false` hides it |
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
  battery: auto
  valve: auto
  window: auto
controls:
  modes: [off, heat, cool, heat_cool, auto, dry, fan_only]
  fan: true
  swing: true
  swing_horizontal: true
  presets: true
write_delay: 1.5
write_hold: 10
status_entities:
  - entity: input_boolean.living_room_pause
    name: Window pause
    icon: mdi:window-open
show_history: true
look:
  glass: theme
  tint: 0.09
  blur: 30
  motion: rich
config_version: 1
```

## Editor groups {#dial-editor}

The visual editor has four tabs. Each group below links to its option.

### Entity {#dial-entity}

Setup tab. Pick the climate, water heater or humidifier entity. Option: `entity`.

### Name {#dial-name}

Setup tab. Leave it empty to use the entity name. Option: `name`.

### Room temperature sensor {#dial-room-sensor}

Setup tab. Some units report whole degrees only. Pick a separate temperature sensor to show a more precise room temperature. When the unit reports whole degrees and a temperature sensor sits in the same area, the editor offers it with **Use it**. Option: `temperature_sensor`.

For Daikin Onecta the Setup tab also notes that changes are sent after `write_delay`.

### Sensors {#dial-sensors}

Sensors tab. Shows what was found for humidity, outdoor temperature, energy today, cloud call limit and unit health, and battery, valve position and window contact when the device has them. **Change** picks another entity and sets a display name. The switch hides a role. Option: `sensors`, see [Sensors](/sensors).

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

### History button {#dial-history}

Controls tab, after the climate options (every domain has it). A button next to the power button opens Home Assistant's history page for the entity, the same page the history link of Home Assistant's own cards opens. In a sheet, the sheet closes first. On by default. Option: `show_history`.

The button also shows on a dial whose entity is unavailable, or missing from Home Assistant, so you can see its last known history.

```yaml
show_history: false
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

Local devices (Zigbee, Z-Wave, Thread) answer at once, so `0` or 1 s feels best for them. Keep the default or raise it for cloud integrations, where every call counts.

The dial, the tile, the badge, the cluster and any other Liquid Climate card on the same entity share one write queue per entity. Their changes go out together.

### Show sent value for {#dial-write-hold}

Controls tab. After a change is sent, the dial keeps showing the value you set until the entity reports it back, at most this many seconds. A battery valve can take a while to report, and without the hold the dial would snap back to the old value. Choices: 10 s (default), 30 s, 60 s. Option: `write_hold`, in seconds up to 3600; `0` means no hold.

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

The [tile](/cards/tile), the [badge](/cards/badge) and the [cluster](/cards/cluster) open this same dial in a sheet, with the dial options of their own config. The sheet's dial has the history button too (turn off History button in the tile, badge or cluster editor, or add `show_history: false` to its config); it closes the sheet and then opens the history page.

<img src="/media/sheet-open.webp" alt="The dial opened as a sheet" loading="lazy">
