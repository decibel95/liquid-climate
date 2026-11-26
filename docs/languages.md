# Languages {#languages}

The cards and their editors follow the language of your Home Assistant profile. Config keys and YAML stay English.

<LiveCard type="dial" lang="nl" />

The demo runs on fake data. Changes stay in your browser. Use the language control above the card to switch.

## Supported languages {#languages-supported}

| Language | Status |
|----------|--------|
| English (`en`) | Base language and fallback |
| Dutch (`nl`) | Reviewed by a native speaker, corrections welcome |
| German (`de`), French (`fr`), Spanish (`es`), Italian (`it`), Polish (`pl`) | Machine translated, PRs welcome |

## How the language is picked {#languages-pick}

- The language comes from your Home Assistant user profile.
- An unsupported language (for example `pt-BR`, when there is no `pt`) falls back to English.
- A regional one such as `nl-BE` uses `nl`.
- Numbers follow your number format setting.

## What is translated {#languages-scope}

Mode, fan, swing, preset and hvac action names come from Home Assistant's own translations when it has them (`hass.localize`), so they match the rest of your dashboard. When Home Assistant has no name for a value, the card uses its own in your language: for example Heat/Cool for `heat_cool`, Fixed for the `stop` swing mode. The narrow mode buttons on the dial always use short names of the card (`heat_cool` reads Auto there, or Heat/Cool when `auto` is a button too). The rest is the card's own copy: labels, editor fields, messages and the status menu.

Configuration errors (shown when the YAML is invalid) and the names in the card picker stay English on purpose. Home Assistant gives the card no language at that point, and they are meant for the person writing the config.

## Compare the languages {#languages-demo}

<div style="display: flex; flex-wrap: wrap; gap: 16px;">
  <LiveCard type="tile" lang="de" :controls="false" />
  <LiveCard type="tile" lang="fr" :controls="false" />
  <LiveCard type="tile" lang="es" :controls="false" />
  <LiveCard type="tile" lang="it" :controls="false" />
  <LiveCard type="tile" lang="pl" :controls="false" />
</div>

## Contribute a translation {#languages-contribute}

Adding a language takes one JSON file and one import line. Fixing a string is one edit. The steps are in `CONTRIBUTING-translations.md` in the repository root. Run `npm test` after a change: it checks that every language has exactly the keys of `en.json` and the same placeholders per key.
