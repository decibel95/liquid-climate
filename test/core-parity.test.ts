// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parityValues } from './core-parity-snapshot';
import fixture from './fixtures/lc-0.12.0-parity.json';

// Patch B moves shared code to @decibel95/liquid-core. This fixture was captured from the unmodified 0.12.0 code (see
// its `source` field); every value the cards draw with must stay equal to it after each migration step.
describe('core parity with Liquid Climate 0.12.0', () => {
  const now = parityValues() as Record<string, unknown>;
  const values = fixture.values as Record<string, unknown>;

  it('covers every captured group', () => {
    expect(Object.keys(now).sort()).toEqual(Object.keys(values).sort());
    expect(Object.keys(fixture.values.ICONS)).toHaveLength(25);
  });

  for (const key of Object.keys(values)) {
    it(`${key} equals the 0.12.0 value`, () => {
      expect(now[key]).toEqual(values[key]);
    });
  }
});
