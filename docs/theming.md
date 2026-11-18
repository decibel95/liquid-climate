# Theming {#theming}

All four cards use the same glass and theme variables. card-mod is not required.

## Look options {#theming-look}

Set on the dial, tile, badge and cluster under `look`. `tint` only affects the dial (also when it opens as a sheet from a tile, badge or cluster); the other cards accept it and pass it on to that sheet:

| Option | Default | Description |
|--------|---------|-------------|
| `glass` | `theme` | `theme` picks dark glass when HA is in dark mode, or when the theme has a dark background colour (a dark single-mode theme), and light glass otherwise. `dark` or `light` forces one |
| `tint` | `0.09` | Mode tint opacity of the dial, 0 to 0.3 in the editor. No effect on the tile, badge and cluster themselves |
| `blur` | `30` | Backdrop blur in px, 8 to 60 in the editor |
| `motion` | `rich` | `rich`, `subtle` or `minimal` |

```yaml
type: custom:liquid-climate-card
entity: climate.living_room
look:
  glass: dark
  tint: 0.12
  blur: 40
  motion: subtle
```

Both glass bases are opaque enough to keep text above 4.5:1 contrast on any backdrop.

`prefers-reduced-motion` always turns the particle and spin animations off, and the tile flame, badge dot and sheet animations with them. `motion: minimal` stops the tile flame and the badge dot, and the cluster fan ring.

## Light and dark {#theming-demo}

The same dial in both glass styles. The demo runs on fake data. Changes stay in your browser.

<div style="display: flex; flex-wrap: wrap; gap: 16px;">
  <LiveCard type="dial" theme="light" :controls="false" />
  <LiveCard type="dial" theme="dark" :controls="false" />
</div>

## CSS variables {#theming-variables}

Set these in your HA theme (or on a card with card-mod):

| Variable | Effect |
|----------|--------|
| `--lc-tint` | Mode tint opacity of the dial (and the dial sheet), overrides `look.tint` |
| `--lc-blur` | Backdrop blur, for example `30px`, overrides `look.blur` |
| `--lc-radius` | Card corner radius. Defaults: dial `40px`, tile `26px`, cluster `36px`. The badge does not use it |

A theme example:

```yaml
liquid-glass-warm:
  lc-tint: "0.14"
  lc-blur: 36px
  lc-radius: 28px
```

HA turns each theme key into a CSS variable with the `--` prefix, so `lc-radius` becomes `--lc-radius`.

## Mode colours {#theming-colours}

Mode colours sit only on the setpoint arc, the knob and the active mode (and the tile, badge and cluster icons). They are fixed tokens in the cards, not theme variables:

| Token | Colour | Used for |
|-------|--------|----------|
| `heat` | `#ff9447` | Heat, and a water heater in any mode but off |
| `cool` | `#5ab0ff` | Cool, and a humidifier (also one without a `device_class`) |
| `heat_cool`, `auto` | `#a99cff` | Auto |
| `dry` | `#40d3c8` | Dry, and a humidifier with `device_class: dehumidifier` |
| `fan_only` | `#d5dce6` | Fan |

## HA theme variables the cards follow {#theming-ha}

The cards read these Home Assistant variables, so a theme changes them too:

| Variable | Used for |
|----------|----------|
| `--primary-text-color`, `--secondary-text-color` | Editor text |
| `--primary-color` | Editor accents and focus rings |
| `--divider-color` | Editor dividers |
| `--card-background-color` | Editor surfaces |
| `--ha-badge-size`, `--ha-badge-border-radius`, `--ha-badge-icon-size`, `--ha-badge-font-size` | Badge size |
| `--ha-font-size-xs`, `--ha-font-size-s`, `--ha-font-weight-medium`, `--ha-line-height-condensed`, `--ha-space-2` | Badge type and spacing |

The card faces themselves are drawn from the `look` options and the dark or light mode of Home Assistant. Other `--lc-*` variables exist inside the cards. They are internal and can change between releases.
