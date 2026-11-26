// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/write-trace-0.12.0.json';
import { SCENARIOS, TICK, runScenario, type Entry } from './write-trace-scenarios';

// Patch B moves the writer onto liquid-core. Pixels cannot see what reaches Home Assistant or when, so this trace was
// recorded once from the unmodified 0.12.0 code (see the fixture's `source`) and is never regenerated: every service
// call with its time, every console.error, and the writer, tile and cluster state per 100 ms tick must stay equal.
const recorded = fixture.scenarios as unknown as Record<string, Entry[]>;

describe('write trace equals Liquid Climate 0.12.0', () => {
  it('covers every recorded scenario at the recorded tick', () => {
    expect(Object.keys(SCENARIOS)).toEqual(Object.keys(recorded));
    expect(fixture.tick).toBe(TICK);
  });

  for (const name of Object.keys(SCENARIOS)) {
    it(name, async () => {
      expect(await runScenario(name)).toEqual(recorded[name]);
    });
  }
});
