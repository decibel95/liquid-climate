# Sensors {#sensors}

The cards find humidity, outdoor temperature, energy, cloud rate limit, unit health and, for radiator valves, battery, valve position and window contact on their own. This is what Daikin Onecta needs: it keeps the climate entity on one device and the sensors on devices linked to it.

<LiveCard type="dial" :config="{ entity: 'climate.living_room' }" />

The demo runs on fake data. Changes stay in your browser. It shows a Daikin style unit with humidity, outdoor, energy and cloud limit sensors.

## The device family {#sensors-family}

The device family is the climate entity's device, every device linked below it with `via_device_id`, and its parent device when the climate entity sits on a child. A hub with several climate children is not included, so siblings never leak in.

Detection never looks at entity ids or names.

## Two tiers {#sensors-tiers}

- **In the visual editor** (administrators): the full entity registry is read over the websocket. Roles are resolved from `device_class`, `unique_id` suffixes and the English `original_name`, with a table for Daikin Onecta. The resolved entity ids are written into the card config on the first edit, so `auto` becomes concrete and the card never needs the registry at runtime.
- **At runtime with `auto`** (YAML users): `device_class`, unit and `translation_key` only. When a role cannot be settled that way, or two entities compete, it stays empty. Set it explicitly with an entity id.

Without administrator rights the editor shows a note that detection is limited. Roles that cannot be settled stay empty. Pick them with **Change**.

## Roles {#sensors-roles}

| Role | Config key | Rule |
|------|------------|------|
| Humidity | `humidity` | The only `sensor` with device class humidity |
| Outdoor temperature | `outdoor` | Temperature sensor marked outdoor (translation key, or unique_id and original_name in the editor) |
| Unit temperature | | Temperature sensor marked room (editor only). Whole-degree readings are flagged |
| Energy | `energy` | Device class energy or an energy unit, kind and period from the translation key or the editor registry. Wh and MWh are converted to kWh |
| Cloud limit | `cloud_limit` | Daikin Onecta remaining daily rate limit (editor registry or explicit entity) |
| Health | `health` | `binary_sensor` with device class problem. On Onecta only error, warning and caution states, plus error code sensors |
| Battery | `battery` | The only `sensor` with device class battery, and/or the only `binary_sensor` with device class battery (the low flag). Shown only when low |
| Valve position | `valve` | The only `sensor` in percent named like a valve opening, or the only `valve` entity (its `current_position`). See [Radiator valves](#sensors-valves) |
| Window | `window` | The only `binary_sensor` with device class window, or, without a window contact, the only one with class opening when the valve role resolves (see [Radiator valves](#sensors-valves)). Pauses the badge and the cluster room |

The unit temperature is not a config role. When a unit reports whole degrees, the editor suggests a room temperature sensor, see [room temperature sensor](/cards/dial#dial-room-sensor).

## Override with `sensors:` {#sensors-override}

Each role takes one of:

| Value | Meaning |
|-------|---------|
| `auto` | Use detection (the default) |
| `false` | Hide the role |
| an entity id | Use this entity |
| `{entity, name}` | Use this entity with a display name. `entity: auto` names the detected sensor |

`energy` and `health` also accept a list of entity ids:

```yaml
sensors:
  energy: [sensor.unit_heating_today, sensor.unit_cooling_today]
```

Any role (and any list item) can carry a display name, used as its label on the dial and in health messages. The visual editor has a name field next to each sensor's entity under Change.

```yaml
sensors:
  humidity: { entity: sensor.kitchen_humidity, name: Kitchen humidity }
  outdoor: { entity: auto, name: Garden }
  health:
    - { entity: binary_sensor.unit_error, name: Indoor unit }
    - sensor.unit_error_code
```

The visual editors save only what differs from the defaults, so the YAML stays short.

## Radiator valves {#sensors-valves}

Radiator valves (TRVs) keep a battery, the valve opening and a window contact on the same device as the climate entity. These three roles follow the same rule as the others: the card only uses a role when exactly one entity qualifies.

<img class="light-only" src="/media/trv-light.png" alt="Two radiator valve dials: the hallway valve idle at its target and the bedroom valve heating, both with the valve opening below the controls" loading="lazy">
<img class="dark-only" src="/media/trv-dark.png" alt="Two radiator valve dials in dark glass: the hallway valve idle at its target and the bedroom valve heating, both with the valve opening below the controls" loading="lazy">

<img src="/media/trv.webp" alt="A radiator valve dial going from idle to heating, then showing a low battery alert and returning to idle" loading="lazy">

With Zigbee2MQTT, the valve opening (Pi heating demand) carries no translation key. Open the editor once as an administrator: it reads its `unique_id` and writes the entity id into the config. The window contact (device class `window`) is found by itself.

**Battery.** Found by device class, so it works at runtime without the editor.

- A numeric battery is low under 20 percent. A battery `binary_sensor` is low when it is `on`.
- When the device has both, the percentage is used for the level and the flag as a second low signal. Either one makes the battery low.
- `unavailable` and `unknown` never count as low.
- The card shows it only when low (the editor's Battery row shows the level even when it is not low): an alert on the dial, the status line on the tile, the value on the badge, the footer of the room in the cluster. It disappears again when the battery is replaced.
- `Battery 45%` as a figure on the dial needs an explicit entity: `sensors.battery: sensor.valve_battery`. With `auto` the figure stays hidden.

**Valve position.** A percent sensor is taken when its `translation_key` matches a valve role (`pi_heating_demand`, `valve_position`, `valve_opening`, `heating_demand`). The editor also reads `unique_id` and the English `original_name`, which is how a Zigbee2MQTT `Pi heating demand` sensor is found, and writes the entity id into the config. A bare `position` is not enough, and humidity, battery, calibration and louver, vane, tilt, swing, fan, cover, blind and motor sensors are never taken. A `valve` entity on the device counts too when it has a numeric `current_position`, which is the value. When a sensor and a `valve` entity both qualify, or two sensors do, nothing is chosen: set `sensors.valve` yourself. It shows as `Valve 45%` on the dial and as `valve 45%` in the cluster room footer.

**Window.** A contact with device class `window` is found by itself. A contact with device class `opening` (which could be a door) is only taken when the device has no `window` contact and the valve setting resolves to an entity (found by itself, set by you, or written by the editor). With `sensors.valve: false` it is not taken, and on any other unit you set it with `sensors.window`. The editor and the cards follow the same rule. Z2M's `window_open` and similar contacts pause the badge and the cluster room, the same Paused state as `pause_entity`. When `pause_entity` is set, it decides and the window contact is ignored. Two window contacts on the device settle nothing. The dial and the tile have no paused state.

A local temperature calibration (offset in degrees) is not a valve and is never shown.

```yaml
sensors:
  battery: sensor.bedroom_valve_battery
  valve: sensor.bedroom_valve_pi_heating_demand
  window: false
```

## Cloud limit {#sensors-cloud-limit}

The cloud limit role shows the remaining daily API calls of a Daikin Onecta account. The value is marked as a warning below 30. See [Cloud limit reached](/troubleshooting#cloud-limit).

## In a cluster {#sensors-cluster}

The [cluster](/cards/cluster#cluster-sensors) takes the same `sensors` settings, for every room and per room.
