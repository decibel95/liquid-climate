import { describe, expect, it } from 'vitest';
import { LC_LAYER, LOCALES, t } from '../src/i18n';

describe('liquid-core layer under ours', () => {
  it('no Liquid Climate key starts with core.', () => {
    for (const strings of Object.values(LC_LAYER)) {
      expect(Object.keys(strings).filter((k) => k.startsWith('core.'))).toEqual([]);
    }
  });

  it('every language carries the same core.* keys and placeholders as en', () => {
    const core = (lang: string) => Object.entries(LOCALES[lang]).filter(([k]) => k.startsWith('core.'));
    const holders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    const en = Object.fromEntries(core('en'));
    expect(Object.keys(en).length).toBeGreaterThan(0);
    for (const lang of Object.keys(LC_LAYER)) {
      const mine = Object.fromEntries(core(lang));
      expect(Object.keys(mine).sort(), lang).toEqual(Object.keys(en).sort());
      for (const k of Object.keys(en)) expect(holders(mine[k]), `${lang} ${k}`).toBe(holders(en[k]));
    }
  });

  for (const [lang, strings] of Object.entries(LC_LAYER)) {
    it(`${lang}: every Liquid Climate key resolves to its own value through t`, () => {
      const vars = { name: '{name}', value: '{value}', section: '{section}' };
      const wrong = Object.entries(strings).filter(([k, v]) => t({ language: lang }, k, vars) !== v);
      expect(wrong.map(([k]) => k)).toEqual([]);
    });
  }
});
