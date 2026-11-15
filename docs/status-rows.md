# Status rows {#status-rows}

`status_entities` adds rows under the dial. Each row shows a name, a value and an optional icon. A row can open an inline menu to change a value or run a script.

<LiveCard type="dial" />

The demo runs on fake data. Changes stay in your browser.

<img src="/media/status-menu.webp" alt="A status row with its menu open" loading="lazy">

## Options {#status-options}

Each item of `status_entities`:

| Option | Default | Description |
|--------|---------|-------------|
| `entity` | required | Entity shown in the row |
| `name` | friendly name | Row label |
| `icon` | | Icon, for example `mdi:window-open` |
| `actions` | | List of `script.*` and `automation.*` entity ids shown in the menu. Other ids are ignored |
| `menu` | automatic | `false` forces the plain more-info tap, `true` forces the menu |

## Plain rows and menu rows {#status-menu-rules}

A plain row (a sensor, a binary sensor) opens more-info when tapped. A row for an `input_select`, `select`, `input_boolean` or `switch`, or any row with `actions`, opens an inline menu under the row instead.

```yaml
status_entities:
  - entity: input_select.heating_mode     # menu: pick the value
    name: Heating mode
    actions:                              # scripts and automations shown in the menu
      - script.apply_heating
      - automation.heating_schedule
  - entity: input_boolean.window_pause    # menu: one on/off switch
  - entity: sensor.outdoor_power
    actions: [script.refresh_power]       # a sensor with actions gets a menu too
  - entity: input_select.fan_profile
    menu: false                           # keep the plain more-info tap
```

- `actions`: `script.*` and `automation.*` entity ids. Other ids are ignored.
- `menu`: `false` forces the more-info tap. Left out, the menu is on for the four domains above or when `actions` is set. `menu: true` only helps when the menu has something of its own to show (a value control, or an existing action). A menu with only Details falls back to the plain more-info tap, so `menu: true` on a sensor without `actions` does nothing.

## What the row shows {#status-values}

The value on the right depends on the entity domain:

| Domain | Value |
|--------|-------|
| `binary_sensor`, `input_boolean`, `switch` | A dot (on or off) with the state text |
| `timer` | Time left as mm:ss while active, the state otherwise |
| `sensor` with a unit | Number and unit |
| anything else | The formatted state |

An unavailable or unknown entity shows `--`.

## The menu {#status-menu}

The menu has four parts, each shown only when it has content:

| Part | Content |
|------|---------|
| Value | A radio list for `input_select` and `select`, one switch for `input_boolean` and `switch`, a switch for an `automation` row, a Run button for a `script` row |
| Scripts | A Run button per script. It reads Running while the script is on |
| Automations | A switch per automation that turns it on or off |
| Footer | Details opens more-info |

Try it with the demo helpers: `input_select.heating_mode` (options Auto, Comfort, Eco, Off), `script.apply_heating`, `automation.heating_schedule` and `input_boolean.window`.

<LiveCard type="dial" :config="{ status_entities: [{ entity: 'input_select.heating_mode', name: 'Heating mode', actions: ['script.apply_heating', 'automation.heating_schedule'] }, { entity: 'input_boolean.window', name: 'Window' }] }" />

### Edit links {#status-admin}

For admin users, every script or automation item has a pencil button next to it that opens its editor. It is not shown for an automation without an `id` attribute.

### Keyboard and motion {#status-keyboard}

The menu works with the keyboard (arrows, Home, End, Escape) and closes on a press outside it. It follows `look.motion` and stays still under reduced motion.

## Missing and failing entities {#status-missing}

- A status row whose entity is not in Home Assistant is hidden. A row that exists but is unavailable stays, with `--`.
- An action id that does not exist is skipped in the menu.
- An existing but unavailable linked entity is shown disabled.
- If a call fails, the row shows "Couldn't update. Try again."

The visual editor warns about missing rows and missing actions.

## In the editor {#status-editor}

On the Controls tab, each row has an entity, a name, an icon, an Actions list and a Show menu switch. See [Dial, status rows](/cards/dial#dial-status-rows).
