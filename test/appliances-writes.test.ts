import { describe, expect, it, vi } from 'vitest';
import { WriteQueue, debounceWrites } from '@decibel95/liquid-core';
import { buildCalls, type ServiceCall } from '../src/cards/dial/write-queue';
import type { Optimistic } from '../src/cards/dial/capabilities';
import { createDemo } from '../src/demo/service';
import { APPLIANCE_IDS as ID, appliances } from './fixtures';
import type { HassEntity } from '../src/types';

const entity = (id: string, patch: Partial<HassEntity> = {}, attrs: Record<string, unknown> = {}): HassEntity => {
  const s = appliances().states[id];
  return { ...s, ...patch, attributes: { ...s.attributes, ...attrs } };
};
const brief = (calls: ServiceCall[]) => calls.map((c) => `${c.domain}.${c.service}`);

describe('buildCalls: water heater', () => {
  const WH = ID.waterHeater;
  it('set_temperature, set_operation_mode and set_away_mode, each once, values equal to the entity dropped', () => {
    expect(buildCalls(WH, { temperature: 48.3, hvac_mode: 'eco', away_mode: 'off' }, entity(WH))).toEqual([]);
    const calls = buildCalls(WH, { temperature: 50, hvac_mode: 'gas', away_mode: 'on' }, entity(WH));
    expect(brief(calls)).toEqual(['water_heater.set_operation_mode', 'water_heater.set_temperature', 'water_heater.set_away_mode']);
    expect(calls.map((c) => c.data)).toEqual([
      { entity_id: WH, operation_mode: 'gas' },
      { entity_id: WH, temperature: 50 },
      { entity_id: WH, away_mode: true },
    ]);
  });

  it('off: turn_off with ON_OFF, else the operation mode off; the setpoint is dropped', () => {
    expect(brief(buildCalls(WH, { hvac_mode: 'off', temperature: 50 }, entity(WH)))).toEqual(['water_heater.turn_off']);
    const noOnOff = entity(WH, {}, { supported_features: 7 });
    expect(buildCalls(WH, { hvac_mode: 'off' }, noOnOff)).toEqual([
      { domain: 'water_heater', service: 'set_operation_mode', data: { entity_id: WH, operation_mode: 'off' }, sets: { hvac_mode: 'off' } },
    ]);
  });

  it('on from off: turn_on then the mode with ON_OFF, only the mode without', () => {
    expect(brief(buildCalls(WH, { hvac_mode: 'electric' }, entity(WH, { state: 'off' })))).toEqual(['water_heater.turn_on', 'water_heater.set_operation_mode']);
    expect(brief(buildCalls(WH, { hvac_mode: 'electric' }, entity(WH, { state: 'off' }, { supported_features: 7 })))).toEqual(['water_heater.set_operation_mode']);
    // Only turn_on, no operation modes at all: turn_on alone.
    const bare = entity(WH, { state: 'off' }, { supported_features: 1 | 8, operation_list: undefined });
    expect(brief(buildCalls(WH, { hvac_mode: 'on' }, bare))).toEqual(['water_heater.turn_on']);
  });

  it('an in-flight value counts as already set', () => {
    expect(buildCalls(WH, { temperature: 50 }, entity(WH), { temperature: 50 })).toEqual([]);
    expect(buildCalls(WH, { hvac_mode: 'gas' }, entity(WH), { hvac_mode: 'gas' })).toEqual([]);
  });
});

describe('buildCalls: humidifier', () => {
  it('set_humidity and set_mode, values equal to the entity dropped', () => {
    expect(buildCalls(ID.hygrostat, { humidity: 50, mode: 'home' }, entity(ID.hygrostat))).toEqual([]);
    expect(buildCalls(ID.hygrostat, { humidity: 55, mode: 'eco' }, entity(ID.hygrostat))).toEqual([
      { domain: 'humidifier', service: 'set_mode', data: { entity_id: ID.hygrostat, mode: 'eco' } },
      { domain: 'humidifier', service: 'set_humidity', data: { entity_id: ID.hygrostat, humidity: 55 } },
    ]);
  });

  it('turn_off drops the rest; turn_on goes first', () => {
    expect(brief(buildCalls(ID.humidifier, { hvac_mode: 'off', humidity: 70 }, entity(ID.humidifier)))).toEqual(['humidifier.turn_off']);
    const off = entity(ID.hygrostat, { state: 'off' });
    expect(brief(buildCalls(ID.hygrostat, { hvac_mode: 'on', mode: 'eco', humidity: 40 }, off))).toEqual(['humidifier.turn_on', 'humidifier.set_mode', 'humidifier.set_humidity']);
    // Still off: nothing to send for the setpoint.
    expect(buildCalls(ID.hygrostat, { humidity: 40 }, off)).toEqual([]);
  });
});

describe('write queue batching for the new services', () => {
  const run = async (id: string, state: HassEntity, patches: Record<string, unknown>[]) => {
    vi.useFakeTimers();
    const sent: ServiceCall[][] = [];
    const flushed: unknown[] = [];
    const q = new WriteQueue<Optimistic, ServiceCall>({
      send: (c) => void sent.push(c),
      build: (change, stateObj, inflight) => buildCalls(id, change, stateObj, inflight),
      schedule: debounceWrites(1500),
      getEntity: () => state,
    });
    q.onFlushed = (c) => flushed.push(c);
    for (const p of patches) {
      q.set(p);
      await vi.advanceTimersByTimeAsync(500);
    }
    await vi.advanceTimersByTimeAsync(1600);
    vi.useRealTimers();
    return { sent, flushed };
  };

  it.each([
    ['water_heater.set_temperature', ID.waterHeater, [{ temperature: 49 }, { temperature: 50 }, { temperature: 51 }], { temperature: 51 }],
    ['water_heater.set_operation_mode', ID.waterHeater, [{ hvac_mode: 'gas' }, { hvac_mode: 'electric' }], { hvac_mode: 'electric' }],
    ['water_heater.set_away_mode', ID.waterHeater, [{ away_mode: 'on' }, { away_mode: 'off' }, { away_mode: 'on' }], { away_mode: 'on' }],
    ['water_heater.turn_off', ID.waterHeater, [{ hvac_mode: 'gas' }, { hvac_mode: 'off' }], { hvac_mode: 'off' }],
    ['humidifier.set_humidity', ID.humidifier, [{ humidity: 70 }, { humidity: 75 }], { humidity: 75 }],
    ['humidifier.set_mode', ID.hygrostat, [{ mode: 'eco' }, { mode: 'home' }, { mode: 'eco' }], { mode: 'eco' }],
    ['humidifier.turn_off', ID.humidifier, [{ hvac_mode: 'off' }, { hvac_mode: 'on' }, { hvac_mode: 'off' }], { hvac_mode: 'off' }],
  ] as const)('%s: presses within the delay become one call', async (name, id, patches, flushed) => {
    const r = await run(id, entity(id), patches as unknown as Record<string, unknown>[]);
    expect(r.sent).toHaveLength(1);
    expect(brief(r.sent[0])).toEqual([name]);
    // The optimistic value is the state or attribute the entity reports, and nothing leaks to the service.
    expect(r.flushed).toEqual([flushed]);
    expect(r.sent[0].every((c) => !('sets' in c))).toBe(true);
  });

  it('humidifier.turn_on from off', async () => {
    const r = await run(ID.humidifier, entity(ID.humidifier, { state: 'off' }), [{ hvac_mode: 'on' }]);
    expect(brief(r.sent[0])).toEqual(['humidifier.turn_on']);
  });

  it('water_heater.turn_on from off, then the mode', async () => {
    const r = await run(ID.waterHeater, entity(ID.waterHeater, { state: 'off' }), [{ hvac_mode: 'eco' }]);
    expect(brief(r.sent[0])).toEqual(['water_heater.turn_on', 'water_heater.set_operation_mode']);
    expect(r.flushed).toEqual([{ hvac_mode: 'eco' }]);
  });
});

describe('demo service: water heaters and humidifiers', () => {
  it('holds the demo entities and applies their services', async () => {
    vi.useFakeTimers();
    const demo = createDemo({ delay: 10 });
    for (const id of Object.values(ID)) expect(demo.hass.states[id]).toBeTruthy();
    const call = async (domain: string, service: string, data: Record<string, unknown>) => {
      const p = demo.hass.callService(domain, service, data);
      await vi.advanceTimersByTimeAsync(20);
      await p;
    };
    await call('water_heater', 'set_temperature', { entity_id: ID.waterHeater, temperature: 55 });
    await call('water_heater', 'set_operation_mode', { entity_id: ID.waterHeater, operation_mode: 'gas' });
    await call('water_heater', 'set_away_mode', { entity_id: ID.waterHeater, away_mode: true });
    let s = demo.hass.states[ID.waterHeater];
    expect([s.state, s.attributes.temperature, s.attributes.away_mode, s.attributes.operation_mode]).toEqual(['gas', 55, 'on', 'gas']);
    await call('water_heater', 'turn_off', { entity_id: ID.waterHeater });
    expect(demo.hass.states[ID.waterHeater].state).toBe('off');
    await call('water_heater', 'turn_on', { entity_id: ID.waterHeater });
    expect(demo.hass.states[ID.waterHeater].state).toBe('eco');

    await call('humidifier', 'set_humidity', { entity_id: ID.hygrostat, humidity: 60 });
    await call('humidifier', 'set_mode', { entity_id: ID.hygrostat, mode: 'eco' });
    s = demo.hass.states[ID.hygrostat];
    expect([s.attributes.humidity, s.attributes.mode]).toEqual([60, 'eco']);
    await call('humidifier', 'turn_off', { entity_id: ID.dehumidifier });
    expect([demo.hass.states[ID.dehumidifier].state, demo.hass.states[ID.dehumidifier].attributes.action]).toEqual(['off', 'off']);
    await call('humidifier', 'turn_on', { entity_id: ID.dehumidifier });
    expect([demo.hass.states[ID.dehumidifier].state, demo.hass.states[ID.dehumidifier].attributes.action]).toEqual(['on', 'drying']);
    demo.dispose();
    vi.useRealTimers();
  });

  it('the English demo has them too', () => {
    const demo = createDemo({ english: true });
    expect(demo.hass.states[ID.humidifier]).toBeTruthy();
    demo.dispose();
  });
});
