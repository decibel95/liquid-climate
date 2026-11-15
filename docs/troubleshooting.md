# Troubleshooting {#troubleshooting}

## Card not found {#card-not-found}

Symptoms: the card shows "Custom element doesn't exist: liquid-climate-card", or an empty box where the card should be.

1. Check the resource. Settings, Dashboards, three dots, Resources. There must be an entry for `/local/liquid-climate.js` (or the HACS path) of type **JavaScript module**.
2. Check the file. It must be at `/config/www/liquid-climate.js` for the `/local/liquid-climate.js` URL.
3. Hard refresh the browser (Ctrl+F5, or Cmd+Shift+R). The Home Assistant app on a phone: clear the app cache in the app settings.
4. Beat the cache. Home Assistant caches `/local/` files for a long time. Add a version to the resource URL and save, for example `/local/liquid-climate.js?v=0.9.0`. Change the number each time you replace the file.
5. Check the card type. The four types are `custom:liquid-climate-card`, `custom:liquid-climate-tile`, `custom:liquid-climate-badge` and `custom:liquid-climate-cluster`.
6. Open the browser console. A load error there names the cause.

## Sensor not detected {#sensor-not-detected}

The card shows a sensor only when it can settle the role with certainty. When two entities compete, or nothing matches, the role stays empty. The card never guesses.

1. Open the card editor, Sensors tab. It shows what was found per role, and from which device.
2. If the editor says detection is limited, you are not an administrator. Roles that cannot be settled stay empty.
3. Check the device family. Sensors must sit on the climate device, or on a device linked to it with `via_device_id`. Check the sensor's device in Home Assistant.
4. Set the sensor yourself, in the editor with **Change**, or in YAML:

```yaml
sensors:
  humidity: sensor.living_room_humidity
  outdoor: sensor.living_room_outdoor_temperature
```

See [Sensors](/sensors) for the rules per role.

## Cloud limit reached {#cloud-limit}

Daikin Onecta is a cloud integration with about 200 API calls per day per account. Every write costs budget. Once the budget is used up, the cloud stops accepting calls until the limit resets.

- The cloud limit sensor shows the calls left. It is marked as a warning below 30. On the cluster, the header shows the lowest count of all rooms, since units on one account share the budget.
- `write_delay` collects changes (default 1.5 seconds) and sends the minimum number of service calls, so one drag is one call. Raise it to 3 seconds to save more calls. See [write delay](/cards/dial#dial-write-delay).
- The dial, tile, badge and cluster share one write queue per entity.
- Status row menus write only when you pick a value.

## Copy diagnostics {#copy-diagnostics}

All four editors (dial, tile, badge and cluster) have a **Copy diagnostics** button in their footer. It copies JSON with the card and Home Assistant versions, the language, the browser and the dark mode setting, the card config (without defaults, and without anything that looks like a token, password or key), how each sensor role was resolved (detected, set by you or hidden) and what the climate entity supports (modes, fan, swing and preset options, temperature range and step, unit). For a cluster it lists every room. Entity states, temperatures, history, users and location are not included, and neither are entity and device names from Home Assistant. Names you set in the card config (`name`, `title`) are.

The button reads Copied when it worked and Copy failed when the browser blocked the clipboard. Then try again from a page served over HTTPS, or copy the config from the YAML editor by hand.

Paste the result into a bug report. Check it first for anything private: it holds your entity ids.

## Report a bug {#report-a-bug}

1. Update to the latest version and hard refresh.
2. Copy the diagnostics, see above.
3. Note your Home Assistant version, the integration of the climate entity and the browser.
4. Say what you expected and what happened. A screenshot or a short screen recording helps.
5. Open an issue in the project repository.
