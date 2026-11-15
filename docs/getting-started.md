# Getting started {#getting-started}

## Requirements {#requirements}

- Home Assistant 2025.1 or newer.
- At least one `climate` entity.

## Install with HACS {#install-hacs}

Liquid Climate is not in the default catalog yet, so add it as a custom repository by link. The resource `/local/community/liquid-climate/liquid-climate.js` is added automatically.

### Marketplace (Home Assistant 2026.11 and newer) {#install-marketplace}

1. Open Settings, Marketplace and accept the one-time community warning. Custom repositories need a connected GitHub account.
2. Use the [Open in Home Assistant](https://my.home-assistant.io/redirect/hacs_repository/?owner=decibel95&repository=liquid-climate&category=plugin) link, or the Marketplace menu, **Add from link**, with `https://github.com/decibel95/liquid-climate` and category **Dashboard**.
3. Install Liquid Climate.
4. Reload the browser (clear the cache if the card does not appear).

### HACS (older Home Assistant) {#install-hacs-classic}

1. Open HACS, then the menu (three dots), then **Custom repositories**.
2. Enter `https://github.com/decibel95/liquid-climate` and pick the category **Dashboard**.
3. Save, find **Liquid Climate** in HACS and download it.
4. Reload the browser.

## Install manually {#install-manual}

1. Get `liquid-climate.js` from a release, or build it yourself with `npm run build` (the file ends up in `dist/`). Copy it to `/config/www/liquid-climate.js`.
2. Go to Settings, Dashboards, three dots, **Resources**.
3. Add `/local/liquid-climate.js` as a **JavaScript module**.
4. Hard refresh the browser.

Home Assistant caches files under `/local/` for a long time. After you replace the file, add a version to the URL, for example `/local/liquid-climate.js?v=0.10.2`, and hard refresh. See [Troubleshooting](/troubleshooting#card-not-found).

## Add a card in the visual editor {#add-visual}

Edit a dashboard, add a card and pick **Liquid Climate** (or the tile, badge or cluster). Choose your climate entity. The editor saves only what differs from the defaults, so the YAML stays short.

<img class="light-only" src="/media/editor-light.png" alt="The Liquid Climate card editor with the Setup, Sensors, Controls and Look tabs" loading="lazy">
<img class="dark-only" src="/media/editor-dark.png" alt="The Liquid Climate card editor with the Setup, Sensors, Controls and Look tabs" loading="lazy">

The dial editor has four tabs: Setup, Sensors, Controls and Look. The editor footer has a **Copy diagnostics** button, see [Copy diagnostics](/troubleshooting#copy-diagnostics).

## Add a card in YAML {#add-yaml}

Only `entity` is required.

```yaml
type: custom:liquid-climate-card
entity: climate.living_room
```

Badges go in the view badges:

```yaml
badges:
  - type: custom:liquid-climate-badge
    entity: climate.living_room
```

## The four cards {#card-types}

| Card | Type | Use |
|------|------|-----|
| [Dial](/cards/dial) | `custom:liquid-climate-card` | Full control for one unit |
| [Tile](/cards/tile) | `custom:liquid-climate-tile` | Compact row, opens the dial as a sheet |
| [Badge](/cards/badge) | `custom:liquid-climate-badge` | Status pill for view badges or a grid |
| [Cluster](/cards/cluster) | `custom:liquid-climate-cluster` | Every unit in one card, grouped by floor or area |

Controls the entity does not support are hidden, whatever the config says.
