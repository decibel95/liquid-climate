import { describe, expect, it } from 'vitest';
import { LC_LAYER, LOCALES, t } from '../src/i18n';

describe('liquid-core layer under ours', () => {
  it('no Liquid Climate key starts with core.', () => {
    for (const strings of Object.values(LC_LAYER)) {
      expect(Object.keys(strings).filter((k) => k.startsWith('core.'))).toEqual([]);
    }
  });

  it('the merged map carries core.* keys in every language', () => {
    for (const lang of Object.keys(LC_LAYER)) {
      expect(Object.keys(LOCALES[lang]).some((k) => k.startsWith('core.'))).toBe(true);
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
