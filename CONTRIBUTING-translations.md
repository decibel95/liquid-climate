# Adding or fixing a translation

The cards ship their own strings in `src/i18n/locales/<language>.json`. They are bundled into the single
`dist/liquid-climate.js`, so there is nothing to fetch at runtime.

## Fix a string

Edit the value in the language file. Keep the `{placeholders}` as they are (`{name}`, `{n}`, `{value}`), you
may move them within the sentence. Run `npm test`, it checks that every language has exactly the keys of `en.json`
and the same placeholders per key.

## Add a language

1. Copy `src/i18n/locales/en.json` to `src/i18n/locales/<code>.json`, with the two letter code of the language
   (for example `pl.json`). Home Assistant's own language codes are used; a regional variant such as `nl-BE`
   falls back to `nl` by itself.
2. Translate the values. Do not change the keys.
3. Add one import line and one entry in `LC_LAYER` in `src/i18n/index.ts` (the shared liquid-core strings come
   with `@decibel95/liquid-core`, nothing to add for them, unless liquid-core does not ship your language yet,
   see the next step):

   ```ts
   import pl from './locales/pl.json';
   // ...
   export const LC_LAYER = { en: flatten(en), /* ... */ pl: flatten(pl) };
   ```
4. If liquid-core does not ship your language yet (it has en, nl, de, fr, es and it), its shared `core.*` strings
   (close, history, off, unavailable, the editor glass and motion labels) need a translation too. Liquid Climate
   carries them in its own layer: see the `pl` entry and `PL_CORE` in `src/i18n/index.ts`.
5. Run `npm run typecheck`, `npm test` and `npm run build`.
6. Look at it: `npm run dev`, then pick the language in the switcher (or open `/dev/?lang=pl`).

## Guidelines

- Keep the copy short and plain, like the English. Many strings sit in narrow places (mode buttons, chips,
  44px rows). Long words are cut with an ellipsis, so prefer a short word.
- Use the terms Home Assistant itself uses in your language (area, floor, entity, automation, script).
- Mode, fan, swing, preset and hvac action names are read from Home Assistant first (`hass.localize`). The
  `mode.*`, `modeVerb.*`, `hvacAction.*` and `option.*` keys are only the fallback, and `mode.*` is also what
  the dial's narrow mode buttons show, so keep those short. `modeLong.*` is the longer name for `heat_cool` and `fan_only` outside those buttons (editor, aria labels) when Home Assistant has none.
- Do not use the em-dash character; use a comma, a colon or parentheses. The tests check this.
- Config keys, entity ids and YAML stay English. Only UI text is translated.
- Configuration errors (`setConfig`) and the card picker names and descriptions stay English on purpose: there is no `hass` at that point, and they are for the person writing the config.
- Proper nouns (Daikin, Onecta) and units (kWh) stay as they are.
