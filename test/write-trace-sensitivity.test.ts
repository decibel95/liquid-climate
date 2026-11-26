// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { Optimistic } from '../src/cards/dial/capabilities';
import type { ServiceCall } from '../src/cards/dial/write-queue';
import fixture from './fixtures/write-trace-0.12.0.json';
import { D2, SCENARIOS, divergence, runScenario, type Entry } from './write-trace-scenarios';

// Sensitivity guard for the write trace. The cards run on a default liquid-core 0.2.0 EntityWriter: Liquid Climate's
// build, stateOf, answered and t, and none of the D-2 overrides (plan section 1). What the cards use is exposed under
// Liquid Climate's names; the mode helpers (rememberMode, powerOnModeOf, ...) stay Liquid Climate's own. The trace must
// then differ from the 0.12.0 fixture in each D-2 scenario, so the fixture can see what the overrides keep.
vi.mock('../src/cards/shared/writer', async (importOriginal) => {
  const lc = await importOriginal<typeof import('../src/cards/shared/writer')>();
  const { EntityWriter, WriterLease: CoreLease, WriterRegistry } = await import('@decibel95/liquid-core/writer');
  const { debounceWrites } = await import('@decibel95/liquid-core/write-queue');
  const { buildCalls } = await import('../src/cards/dial/write-queue');
  const { t } = await import('../src/i18n');
  const { domainOf } = await import('../src/domain');

  class PlainCoreWriter extends EntityWriter<Optimistic, ServiceCall> {
    constructor(entityId: string) {
      super(entityId, {
        build: (change, entity, baseline) => buildCalls(entityId, change, entity as never, baseline),
        schedule: debounceWrites(1500),
        stateOf: (s, k) => (k === 'hvac_mode' ? s.state : s.attributes[k]),
        answered: (s, k, from) => domainOf(s.entity_id) === 'water_heater' && k === 'hvac_mode' && s.state !== from,
        t: (hass, key) => t(hass as never, key),
      });
    }

    /** Seconds, as the cards set it. */
    get delay(): number {
      return this.schedule.ms / 1000;
    }

    set delay(s: number) {
      this.schedule = debounceWrites(s * 1000);
    }

    get modeChanging(): boolean {
      return this.local.hvac_mode !== undefined;
    }

    setMode(mode: string): void {
      lc.rememberMode(this.entityId, mode);
      this.set({ hvac_mode: mode });
    }

    togglePower(currentMode: string): void {
      if (currentMode !== 'off') {
        this.setMode('off');
        return;
      }
      const target = lc.powerOnModeOf(this.entity() as never, lc.rememberedMode(this.entityId));
      if (target) this.setMode(target);
    }
  }

  const registry = new WriterRegistry((id) => new PlainCoreWriter(id));
  class WriterLease extends CoreLease<PlainCoreWriter> {
    constructor(onChange: () => void) {
      super(registry, onChange);
    }
  }
  return {
    ...lc,
    ClimateWriter: PlainCoreWriter,
    WriterLease,
    acquireWriter: (id: string) => registry.acquire(id),
    releaseWriter: (w: PlainCoreWriter) => registry.release(w),
    writerRefs: (id: string) => registry.refs(id),
  };
});

const recorded = fixture.scenarios as unknown as Record<string, Entry[]>;
type Divergence = ReturnType<typeof divergence>;
type Side = Record<string, any> | null;

/*
 * How each scenario parts from the 0.12.0 fixture under the plain core writer. `expected` is the fixture's entry
 * (0.12.0), asserted exactly: it never depends on the core version. `actual` is the plain core writer's entry, asserted
 * only on the facts that make the difference, since the mocked import resolves to whatever core is installed (0.2.0
 * here, 0.3.0 after S7). The S7 builder updates nothing here: core 0.3.0 keeps its default path byte for byte (plan C1,
 * C3). If a check fails under 0.3.0, or an unlisted scenario starts to diverge, core's default behaviour changed: report
 * it, do not absorb it.
 */
const CHECKS: Record<string, (d: Divergence) => void> = {
  // D-2 (1): a report still in heat ends the held mode in 0.12.0; the plain writer keeps holding heat.
  d2_return_to_start: (d) => {
    expect(d.calls).toBeNull();
    expect(d.logs).toBeNull();
    expect(d.states!.expected).toEqual(state(4000, 'climate.keuken_airco', {}, false, false, null, 'Heating, 22.0° inside'));
    expect(d.states!.actual).toMatchObject({ t: 4000, state: { local: { hvac_mode: 'heat' }, modeChanging: true } });
  },
  // D-2 (2): the failed fan call drops every held value in 0.12.0; the plain writer keeps the sent setpoint. Log text too.
  d2_failure_drops_all: (d) => {
    expect(d.calls).toBeNull();
    expect(d.logs!.expected).toEqual({ t: 3500, log: 'Liquid Climate: service call failed (Rate limit reached)' });
    expect(d.logs!.actual).not.toBeNull();
    expect(d.states!.expected).toEqual(state(3500, 'climate.keuken_airco', {}, false, false, 'Rate limit reached', 'Heating, 21.0° inside'));
    expect(d.states!.actual).toMatchObject({ t: 3500, state: { local: { temperature: 20 }, error: 'Rate limit reached' } });
  },
  // D-2 (3): `sending` goes false when the first of two overlapping sends settles (4000); the plain writer waits for the last.
  d2_overlapping_sends: (d) => {
    expect(d.calls).toBeNull();
    expect(d.logs).toBeNull();
    expect(d.states!.expected).toEqual(state(4000, 'climate.keuken_airco', { temperature: 20.5 }, false, false, null, 'Heating, 21.0° inside'));
    const actual = d.states!.actual as Side;
    expect(actual!.state.sending).toBe(false);
    expect(actual!.t).toBeGreaterThan(4000);
  },
  // D-2 (4): the tile leaving ends the dial's hold in 0.12.0, so 23 goes out mid-drag (2400); the plain writer sends
  // it only after pointerup (2900).
  d2_standalone_dial_and_tile: (d) => {
    expect(d.logs).toBeNull();
    expect(d.calls!.expected).toEqual(setTemperature(2400, 23));
    const actual = d.calls!.actual as Side;
    expect(actual).toMatchObject({ call: { service: 'set_temperature', data: { temperature: 23 } } });
    expect(actual!.t).toBeGreaterThan(2900);
    expect(d.states).not.toBeNull();
  },
  // Remember-mode (D-2): the plain writer's observe does not remember the mode the entity was seen in (cool), so power
  // on falls back to POWER_ON_ORDER (heat).
  power_remembered: (d) => {
    expect(d.logs).toBeNull();
    expect(d.calls!.expected).toEqual({ t: 3800, call: { domain: 'climate', service: 'set_hvac_mode', data: { entity_id: 'climate.slaapkamer_airco', hvac_mode: 'cool' } } });
    expect(d.calls!.actual).toMatchObject({ call: { service: 'set_hvac_mode', data: { hvac_mode: 'heat' } } });
    expect(d.states).not.toBeNull();
  },
  // Log text (D-2).
  error_and_clear: (d) => {
    expect(d.calls).toBeNull();
    expect(d.states).toBeNull();
    expect(d.logs!.expected).toEqual({ t: 1500, log: 'Liquid Climate: service call failed (Rate limit reached)' });
    expect(d.logs!.actual).not.toBeNull();
  },
  // Log text (D-2).
  cluster_announce_failing: (d) => {
    expect(d.calls).toBeNull();
    expect(d.states).toBeNull();
    expect(d.logs!.expected).toEqual({ t: 2500, log: 'Liquid Climate: service call failed ({"code":"unknown_error"})' });
    expect(d.logs!.actual).not.toBeNull();
  },
};

function state(t: number, entity: string, local: Record<string, unknown>, modeChanging: boolean, sending: boolean, error: string | null, tile: string) {
  return { t, state: { entity, local, modeChanging, sending, error, tile, announce: null } };
}

function setTemperature(t: number, temperature: number) {
  return { t, call: { domain: 'climate', service: 'set_temperature', data: { entity_id: 'climate.keuken_airco', temperature } } };
}

describe('write trace sensitivity: a plain liquid-core writer differs from 0.12.0', () => {
  for (const name of Object.keys(SCENARIOS)) {
    it(name, async () => {
      const got = divergence(await runScenario(name), recorded[name]);
      if (CHECKS[name]) CHECKS[name](got);
      else expect(got).toEqual({ calls: null, logs: null, states: null });
    });
  }

  it('checks every D-2 scenario', () => {
    for (const name of D2) expect(CHECKS[name], name).toBeTypeOf('function');
  });
});
