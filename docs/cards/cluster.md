# Cluster card {#cluster}

One glass card for the whole house: a header with a summary and shared figures, a grid of rooms with a mini dial each, and a control strip for the selected room. Type: `custom:liquid-climate-cluster`.

<img class="light-only" src="/media/cluster-light.png" alt="The cluster card in light glass" loading="lazy">
<img class="dark-only" src="/media/cluster-dark.png" alt="The cluster card in dark glass" loading="lazy">

<LiveCard type="cluster" />

The demo runs on fake data. Changes stay in your browser.

```yaml
type: custom:liquid-climate-cluster
```

With no options it shows every climate entity, grouped under the floors set in Home Assistant.

## Behavior {#cluster-behavior}

- The card takes the full width of its section (`columns: full`, at least 12 columns). On a narrow card the rooms scroll sideways and the next room peeks in at the edge.
- Three columns of rooms when the card is wide, two at medium width, and a horizontal row of compact rooms when narrow (6 columns in a sections view, phones).
- The header reads "Climate" (or `title`; "Comfort" once `domains` or the list holds a water heater or humidifier) with a summary: `2 of 3 heating` when every running unit is actively heating (or cooling) in the same mode, `2 of 3 on` otherwise, `All off`, or `Unavailable` when no unit can be reached. A count of errors, paused and unavailable rooms follows.
- Outside temperature, energy today and cloud calls left follow, each only when a room resolves it. Energy is summed over every distinct sensor of every room in kWh (Wh and MWh are converted, a sensor shared by two rooms counts once). Cloud calls left is the lowest count, since units on one account share the budget.
- Each room shows the target arc in the mode colour, a dot for the room temperature, the fan ring, a slow spinning ring while the fan runs (not with `motion: minimal` or reduced motion), the target, `Inside 21.0°` and a footer such as `Heating, fan 2, 2.9 kWh`. Its icon carries the mode colour only while the unit is doing its job, so an idle unit in heat mode stays neutral.
- Tapping a room selects it. The strip below shows its name and status, the modes that entity supports and the target steppers. Tapping the name opens the full dial in a sheet, for fan, swing and presets. A dual setpoint shows the range, for example 19.0 to 24.0°, instead of steppers, and tapping it opens the dial too.
- Rooms show `Error` (health flags decide, codes are detail, as on the tile), `Paused` while their `pause_entity` is on (or, without one, the window contact of the unit is open), `Unavailable`, `Battery low` or `Off`. A radiator valve adds its opening to the footer, for example `Heating, valve 45%`. See [Radiator valves](/sensors#sensors-valves).
- Every write goes through the same per-entity queue as the dial, tile and badge, so a press on the cluster and one on a tile for the same unit are sent as one call after `write_delay`.

## Options {#cluster-options}

| Option | Default | Description |
|--------|---------|-------------|
| `title` | `Climate` | Header title. `Comfort` when `domains` or `entities` include a water heater or humidifier |
| `source` | | Where the rooms come from: `auto`, `floor`, `area` or `list`. Without it, `entities`, `area` and `floor` decide, so older configs keep working. The editor writes it only when those cannot say, for example a picked list with no rooms yet |
| `entities` | | Rooms in order: climate, water_heater or humidifier entity ids or `{entity, name, temperature_sensor, pause_entity, sensors}` |
| `area` | | Only this area (area id) |
| `floor` | | Only this floor (floor id) |
| `group_by` | `floor` | Without `entities`, `area` or `floor`: `floor` (headings) or `area` (one list) |
| `exclude` | | Climate entities left out of the automatic modes |
| `domains` | `[climate]` | Which kinds of entity the automatic modes pick up: `climate`, `water_heater`, `humidifier`. A list in `entities` takes any of the three |
| `rooms` | | Per-room overrides in the automatic modes, the same objects as in `entities` |
| `sensors` | `auto` | As on the dial, for every room. A room's own `sensors` win per role |
| `controls` | `modes`: all seven; `fan`, `swing`, `swing_horizontal`, `presets`: `true` | As on the dial: `modes` limits the strip, the rest applies to the dial a room opens |
| `write_delay` | `1.5` | Seconds to collect presses before sending, `0` sends immediately. Use `0` or `1` for local devices |
| `write_hold` | `10` | Seconds a sent value stays on screen while the device has not reported it back |
| `show_history` | `true` | History button in the dial sheet of a room. `false` hides it |
| `look` | `glass: theme`, `tint: 0.09`, `blur: 30`, `motion: rich` | `glass`, `blur` and `motion` as for the dial. `tint` has no effect on the cluster, it is passed to the dial sheet of a room |
| `config_version` | `1` | Written by the editor |

## Editor groups {#cluster-editor}

### Title {#cluster-title}

The header title. Empty uses "Climate", or "Comfort" when water heaters or humidifiers can be rooms (in `domains`, or in a chosen list). Option: `title`.

### Source {#cluster-source}

Choices: All, One floor, One area, Choose. Option: `source`. The next sections say what each one does.

### Grouping {#cluster-grouping}

With the source set to All, **Group by** picks Floor (a heading per floor once there is more than one, areas without a floor last under Other) or Area (one list, by area name). Option: `group_by`.

| Config | Rooms |
|--------|-------|
| nothing | Every climate entity, by floor level, then area name, then entity name. A heading per floor once there is more than one. Areas without a floor come last under Other |
| `group_by: area` | Every climate entity in one list, by area name |
| `floor: <floor_id>` | Only the units in areas on that floor |
| `area: <area_id>` | Only the units in that area |
| `entities: [...]` | Exactly these, in this order. `area`, `floor` and `exclude` are ignored |
| `source: list` | The `entities` list, even when it is empty (no rooms) |

A unit's area is the entity's own area, else its device's area. Hidden and disabled entities are left out of the automatic modes. A room is named after its area when it is the only unit there, otherwise after the entity. A unit added to Home Assistant later shows up by itself in the automatic modes.

### Device types {#cluster-domains}

Water heaters and humidifiers are opt-in, so an existing cluster does not change by itself. With the source set to All, One floor or One area, pick Climate, Water heaters and Humidifiers in the editor, or set `domains`. A chosen list takes any of them. A room of another kind shows its own figure: the tank temperature of a water heater, the humidity of a humidifier, with the target in % and its colour (cool, dry for a dehumidifier). Option: `domains`.

```yaml
# Every climate unit and every humidifier, by floor
type: custom:liquid-climate-cluster
domains: [climate, humidifier]
```

### Floor {#cluster-floor}

With the source set to One floor, pick the floor. Option: `floor` (the floor id).

```yaml
# Every unit on one floor, one left out
type: custom:liquid-climate-cluster
floor: ground_floor
exclude:
  - climate.guest_room
```

### Area {#cluster-area}

With the source set to One area, pick the area. Option: `area` (the area id).

```yaml
type: custom:liquid-climate-cluster
area: living_room
title: Living room
```

### Rooms {#cluster-rooms}

Switch rooms on and off, rename them and set a room temperature sensor and a pause entity per room (the Edit button). With the source set to Choose, Up and Down reorder the list. The automatic modes keep their own order. Switching between a chosen list and an automatic mode keeps the overrides. Options: `entities`, `rooms`, `exclude`.

Per-room `name`, `temperature_sensor` and `pause_entity` work as on the dial and the badge.

```yaml
# A fixed list with per-room overrides
type: custom:liquid-climate-cluster
entities:
  - entity: climate.living_room
    name: Living Room
    temperature_sensor: sensor.living_room_temperature
  - entity: climate.bedroom
    pause_entity: binary_sensor.bedroom_window
    sensors:
      health: false
  - climate.office
```

The demo below uses its own sample entities.

<LiveCard type="cluster" :config="{ entities: [{ entity: 'climate.living_room', name: 'Living Room' }, { entity: 'climate.bedroom', pause_entity: 'input_boolean.window' }, 'climate.office'] }" />

```yaml
# Automatic, with an override for one unit
type: custom:liquid-climate-cluster
rooms:
  - entity: climate.living_room
    name: Living Room
```

### Sensors per room {#cluster-sensors}

Per-room `sensors` take the same settings as the dial (`auto`, `false`, an entity id, `{entity, name}` or a list for `energy` and `health`). The card detects sensors per unit at runtime only (device class, unit and translation key, see [Sensors](/sensors)).

The visual editor reads the entity registry when it opens, like the dial editor, and writes the detected `outdoor`, `energy` and `cloud_limit` ids into the rooms' `sensors`, only where they differ from what the card finds by itself. That is how the header figures of integrations without translation keys, such as Daikin Onecta, appear without YAML. Reading the registry needs an administrator. For other users, or when you write the config by hand, set those sensors per room.

The energy total in the header is left out when not every configured energy sensor resolves, so a partial sum is never shown as the total.

The editor does not have fields for sensors and controls of the cluster. It says they are set in YAML and apply to every room.

### History button {#cluster-history}

When you open a room, its dial has a button next to the power button that opens Home Assistant's history page for that room's entity. The sheet closes first. On by default, for every room. Option: `show_history`.

### Write delay {#cluster-write-delay}

Seconds to collect presses before sending. Choices: Instant (`0`), 1 s, 1.5 s, 3 s. Option: `write_delay`.

### Show sent value for {#cluster-write-hold}

Seconds a sent value stays on screen while the entity has not reported it back, for slow battery devices. Choices: 10 s, 30 s, 60 s. Option: `write_hold`, in seconds up to 3600; `0` means no hold.

### Look {#cluster-look}

Glass, mode tint, blur and motion. Options: `look.glass`, `look.tint`, `look.blur`, `look.motion`. Mode tint has no effect on this card, it is passed to the dial sheet of a room. See [Theming](/theming).
