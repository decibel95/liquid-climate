# Sensors {#sensors}

The cards find humidity, outdoor temperature, energy, cloud rate limit and unit health on their own. This is what Daikin Onecta needs: it keeps the climate entity on one device and the sensors on devices linked to it.

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

## Cloud limit {#sensors-cloud-limit}

The cloud limit role shows the remaining daily API calls of a Daikin Onecta account. The value is marked as a warning below 30. See [Cloud limit reached](/troubleshooting#cloud-limit).

## In a cluster {#sensors-cluster}

The [cluster](/cards/cluster#cluster-sensors) takes the same `sensors` settings, for every room and per room.
