/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { LOCALES, flatten, haLocalize, humanize, num, numAuto, optionName, rawLanguage, resolveLanguage, t } from '../src/i18n';
import { fanShortLabels, modeLabel, modeVerb } from '../src/ui/modes';
import { statusValue } from '../src/ui/status';

const EN = LOCALES.en;
const EM_DASH = String.fromCharCode(0x2014);
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const hassWith = (extra: Record<string, unknown>) => extra as never;

describe('locale files', () => {
  const others = Object.keys(LOCALES).filter((l) => l !== 'en');

  it('ships en, nl, de, fr, es and it', () => {
    expect(Object.keys(LOCALES).sort()).toEqual(['de', 'en', 'es', 'fr', 'it', 'nl']);
  });

  for (const lang of others) {
    describe(lang, () => {
      const L = LOCALES[lang];
      it('has exactly the keys of en.json', () => {
        const missing = Object.keys(EN).filter((k) => !(k in L));
        const extra = Object.keys(L).filter((k) => !(k in EN));
        expect({ missing, extra }).toEqual({ missing: [], extra: [] });
      });
      it('uses the same {placeholders} per key', () => {
        const bad = Object.keys(EN).filter((k) => k in L && placeholders(EN[k]).join() !== placeholders(L[k]).join());
        expect(bad).toEqual([]);
      });
    });
  }

  for (const [lang, L] of Object.entries(LOCALES)) {
    it(`${lang}: no empty values and no em-dash`, () => {
      expect(Object.entries(L).filter(([, v]) => !v.trim()).map(([k]) => k)).toEqual([]);
      expect(Object.entries(L).filter(([, v]) => v.includes(EM_DASH)).map(([k]) => k)).toEqual([]);
    });
  }

  it('flatten makes dotted keys', () => {
    expect(flatten({ a: { b: 'x', c: { d: 'y' } }, e: 'z' })).toEqual({ 'a.b': 'x', 'a.c.d': 'y', e: 'z' });
  });
});

describe('keys in the source', () => {
  const files = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const source = Object.values(files).join('\n');
  const groups = Object.keys(EN).map((k) => k.split('.')[0]);
  const used = new Set<string>();
  for (const m of source.matchAll(new RegExp(`'((?:${[...new Set(groups)].join('|')})\\.\\w+)'`, 'g'))) used.add(m[1]);

  it('every key the code asks for exists in en.json', () => {
    expect([...used].filter((k) => !(k in EN))).toEqual([]);
  });

  it('every key of en.json is used (the mode, verb, action and option groups are looked up by value)', () => {
    const dynamic = /^(mode|modeVerb|modeLong|hvacAction|option|waterHeaterMode|waterHeaterModeShort|humidifierMode)\./;
    expect(Object.keys(EN).filter((k) => !dynamic.test(k) && !used.has(k))).toEqual([]);
  });
});

describe('language resolution', () => {
  it('prefers hass.locale.language, then hass.language, then en', () => {
    expect(resolveLanguage({ locale: { language: 'nl' }, language: 'de' })).toBe('nl');
    expect(resolveLanguage({ language: 'de' })).toBe('de');
    expect(resolveLanguage({})).toBe('en');
    expect(resolveLanguage(undefined)).toBe('en');
    expect(resolveLanguage(null)).toBe('en');
  });
  it('falls back from a region to the language, ignoring case and _ or -', () => {
    expect(resolveLanguage({ language: 'nl-BE' })).toBe('nl');
    expect(resolveLanguage({ language: 'NL_be' })).toBe('nl');
    expect(resolveLanguage({ locale: { language: 'de-AT' } })).toBe('de');
    expect(resolveLanguage({ language: 'fr_CA' })).toBe('fr');
  });
  it('an unsupported language is English (pt-BR has no pt)', () => {
    expect(resolveLanguage({ language: 'pt-BR' })).toBe('en');
    expect(resolveLanguage({ language: 'ja' })).toBe('en');
  });
  it('rawLanguage keeps the tag as written', () => {
    expect(rawLanguage({ language: 'nl-BE' })).toBe('nl-BE');
  });
});

describe('t', () => {
  it('translates, fills {vars}, falls back to en and then to the key', () => {
    expect(t({ language: 'nl' }, 'common.off')).toBe(LOCALES.nl['common.off']);
    expect(t({ language: 'nl' }, 'common.off')).not.toBe(EN['common.off']);
    expect(t(undefined, 'common.entityNotFound', { entity: 'climate.x' })).toBe('Entity climate.x not found');
    expect(t({ language: 'de' }, 'common.entityNotFound', { entity: 'climate.x' })).toContain('climate.x');
    expect(t({ language: 'nl' }, 'no.such.key')).toBe('no.such.key');
  });
  it('a key only English has comes from English', () => {
    LOCALES.xx = { 'only.en': 'x' };
    LOCALES.en['only.en'] = 'English only';
    try {
      expect(t({ language: 'xx' }, 'only.en')).toBe('x');
      delete LOCALES.xx['only.en'];
      expect(t({ language: 'xx' }, 'only.en')).toBe('English only');
    } finally {
      delete LOCALES.xx;
      delete LOCALES.en['only.en'];
    }
  });
  it('only own variables fill a placeholder', () => {
    expect(t(undefined, 'cluster.summaryOn', { n: 2 })).not.toContain('function');
    expect(t(undefined, 'common.entityNotFound', {})).toBe('Entity {entity} not found');
    const key = 'x.constructor';
    LOCALES.en[key] = '{constructor} here';
    try {
      expect(t(undefined, key, {})).toBe('{constructor} here');
    } finally {
      delete LOCALES.en[key];
    }
  });
  it('leaves an unknown {var} as it is', () => {
    expect(t(undefined, 'cluster.summaryOn', { n: 2 })).toBe('2 of {total} on');
  });
});

describe('numbers', () => {
  it('follows the language', () => {
    expect(num({ language: 'en' }, 21.5, 1)).toBe('21.5');
    expect(num({ language: 'nl' }, 21.5, 1)).toBe('21,5');
    expect(num({ locale: { language: 'de' } }, 1234.5, 1)).toBe('1234,5');
    expect(num(undefined, 21, 1)).toBe('21.0');
  });
  it('follows the number format setting', () => {
    expect(num({ language: 'nl', locale: { language: 'nl', number_format: 'comma_decimal' } }, 21.5, 1)).toBe('21.5');
    expect(num({ language: 'en', locale: { language: 'en', number_format: 'decimal_comma' } }, 21.5, 1)).toBe('21,5');
    expect(num({ language: 'en', locale: { language: 'en', number_format: 'space_comma' } }, 21.5, 1)).toBe('21,5');
    expect(num({ locale: { language: 'nl', number_format: 'language' } }, 21.5, 1)).toBe('21,5');
  });
  it('number_format none is plain: dot decimal, no grouping, whatever the language', () => {
    expect(num({ language: 'nl', locale: { language: 'nl', number_format: 'none' } }, 21.5, 1)).toBe('21.5');
    expect(num({ language: 'de', locale: { language: 'de', number_format: 'none' } }, 12345.5, 1)).toBe('12345.5');
  });
  it('clamps the digits to 0..20 instead of throwing', () => {
    expect(num({ language: 'en' }, 21.5, -3)).toBe('22');
    expect(num({ language: 'en' }, 21.5, 99)).toBe(`21.5${'0'.repeat(19)}`);
    expect(num({ language: 'en' }, 21.5, NaN)).toBe('22');
  });
  it('survives a tag Intl rejects', () => {
    expect(num({ language: 'not a tag!' }, 21.5, 1)).toBe('21.5');
  });
  it('numAuto keeps whole numbers whole', () => {
    expect(numAuto({ language: 'nl' }, 21, 1)).toBe('21');
    expect(numAuto({ language: 'nl' }, 21.25, 1)).toBe('21,3');
  });
});

describe("Home Assistant's own translations", () => {
  const climate = 'component.climate.entity_component._';
  const withMap = (map: Record<string, string>, language = 'nl') => hassWith({ language, localize: (k: string) => map[k] ?? '' });

  it('uses localize when it answers', () => {
    const hass = withMap({ [`${climate}.state.heat`]: 'Verwarmen (HA)' });
    expect(modeLabel(hass, 'heat')).toBe('Verwarmen (HA)');
  });
  it('falls back to ours when localize answers with an empty string, is missing or throws', () => {
    expect(modeLabel(withMap({}), 'heat')).toBe(LOCALES.nl['mode.heat']);
    expect(modeLabel(hassWith({ language: 'nl' }), 'heat')).toBe(LOCALES.nl['mode.heat']);
    expect(modeLabel(hassWith({ language: 'nl', localize: () => { throw new Error('x'); } }), 'heat')).toBe(LOCALES.nl['mode.heat']);
    expect(haLocalize(undefined, 'x')).toBe('');
  });
  it('compact labels (the dial buttons) stay ours and short', () => {
    const hass = withMap({ [`${climate}.state.heat`]: 'Verwarmen (HA)', [`${climate}.state.fan_only`]: 'Alleen ventilator (HA)' });
    expect(modeLabel(hass, 'heat', true)).toBe(LOCALES.nl['mode.heat']);
    expect(modeLabel(hass, 'fan_only', true)).toBe(LOCALES.nl['mode.fan_only']);
  });
  it('outside the buttons heat_cool and fan_only use HA, then our long names, so heat_cool and auto differ', () => {
    const hass = withMap({ [`${climate}.state.heat_cool`]: 'Verwarmen/koelen (HA)', [`${climate}.state.fan_only`]: 'Alleen ventilator (HA)' });
    expect(modeLabel(hass, 'heat_cool')).toBe('Verwarmen/koelen (HA)');
    expect(modeLabel(hass, 'fan_only')).toBe('Alleen ventilator (HA)');
    for (const lang of Object.keys(LOCALES)) {
      const own = hassWith({ language: lang });
      expect(modeLabel(own, 'heat_cool'), lang).toBe(LOCALES[lang]['modeLong.heat_cool']);
      expect(modeLabel(own, 'fan_only'), lang).toBe(LOCALES[lang]['modeLong.fan_only']);
      expect(modeLabel(own, 'heat_cool'), lang).not.toBe(modeLabel(own, 'auto'));
    }
  });
  it('an unknown mode shows as it is', () => {
    expect(modeLabel(undefined, 'weird')).toBe('weird');
    expect(modeVerb(undefined, 'weird')).toBe('weird');
    expect(modeVerb({ language: 'nl' }, 'heat')).toBe(LOCALES.nl['modeVerb.heat']);
  });
  it('fan, swing, preset and action values: HA, then ours, then a readable value', () => {
    const key = (kind: string, v: string) => `${climate}.state_attributes.${kind}.state.${v}`;
    const hass = withMap({ [key('fan_mode', 'low')]: 'Laag (HA)' });
    expect(optionName(hass, 'fan_mode', 'low')).toBe('Laag (HA)');
    expect(optionName(hass, 'fan_mode', 'quiet')).toBe(LOCALES.nl['option.quiet']);
    expect(optionName(hass, 'fan_mode', 'ultra_quiet')).toBe('Ultra quiet');
    expect(optionName(hass, 'hvac_action', 'heating')).toBe(LOCALES.nl['hvacAction.heating']);
    expect(optionName(undefined, 'swing_mode', 'windnice')).toBe('Comfort');
  });
  it('formatEntityAttributeValue counts only when it returns something other than the raw value', () => {
    const e = { entity_id: 'climate.x', state: 'heat', attributes: {} };
    const same = hassWith({ language: 'nl', formatEntityAttributeValue: (_s: unknown, _a: string, v: string) => v });
    const done = hassWith({ language: 'nl', formatEntityAttributeValue: () => 'Zacht' });
    expect(optionName(same, 'fan_mode', 'quiet', e)).toBe(LOCALES.nl['option.quiet']);
    expect(optionName(done, 'fan_mode', 'quiet', e)).toBe('Zacht');
  });
  it('humanize', () => {
    expect(humanize('some_value')).toBe('Some value');
  });
});

describe('fan ring letters', () => {
  const VALUES = ['auto', 'low', 'medium', 'high'];
  const names = (hass: unknown) => VALUES.map((v) => optionName(hass as never, 'fan_mode', v));

  for (const lang of Object.keys(LOCALES)) {
    it(`${lang}: unique letters for auto, low, medium, high`, () => {
      const letters = fanShortLabels(VALUES, names({ language: lang }));
      expect(new Set(letters).size, letters.join(',')).toBe(4);
    });
  }
  it('es with the HA names Automático and Alto no longer collides', () => {
    const letters = fanShortLabels(VALUES, ['Automático', 'Bajo', 'Medio', 'Alto']);
    expect(letters).toEqual(['A', 'B', 'M', 'H']);
  });
  it('numbers stay, and two letters are the last resort', () => {
    expect(fanShortLabels(['1', '2', 'auto'], ['1', '2', 'Auto'])).toEqual(['1', '2', 'A']);
    expect(fanShortLabels(['aa', 'ab'], ['Xa', 'Xb'])).toEqual(['Xa', 'Xb']);
  });
});

describe('status values', () => {
  const nl = { language: 'nl' } as never;
  const sensor = (state: string) => ({ entity_id: 'sensor.x', state, attributes: { unit_of_measurement: '%' } });
  it('a plain decimal follows the number format and keeps its decimals', () => {
    expect(statusValue(nl, sensor('51.5'))).toEqual({ kind: 'unit', number: '51,5', unit: '%' });
    expect(statusValue(nl, sensor(' -3 '))).toEqual({ kind: 'unit', number: '-3', unit: '%' });
  });
  it('anything else stays as it is (hex, exponent, Infinity, empty)', () => {
    for (const s of ['0x10', '1e3', 'Infinity', '', '1,5', '1.']) expect(statusValue(nl, sensor(s)), s).toEqual({ kind: 'unit', number: s, unit: '%' });
  });
});
