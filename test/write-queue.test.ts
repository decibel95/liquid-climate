import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WriteQueue, debounceWrites } from '@decibel95/liquid-core';
import { buildCalls, type ServiceCall } from '../src/cards/dial/write-queue';
import type { Optimistic } from '../src/cards/dial/capabilities';
import type { HassEntity } from '../src/types';
import { keuken } from './fixtures';

const ID = 'climate.keuken_airco';
const entity = () => keuken.states[ID];

function makeQueue(delay = 1.5, baseline: () => Optimistic = () => ({}), entityFn: () => HassEntity = entity) {
  const sent: ServiceCall[][] = [];
  const q = new WriteQueue<Optimistic, ServiceCall>({
    send: (calls) => {
      sent.push(calls);
    },
    build: (change, stateObj, inflight) => buildCalls(ID, change, stateObj, inflight),
    schedule: debounceWrites(delay * 1000),
    getEntity: entityFn,
    getBaseline: baseline,
  });
  return { q, sent };
}

describe('buildCalls', () => {
  it('emits nothing when values equal the entity state', () => {
    expect(buildCalls(ID, { temperature: 19.5, fan_mode: '2' }, entity())).toEqual([]);
  });

  it('orders mode first, then setpoint, fan, swing, horizontal swing, preset', () => {
    const calls = buildCalls(
      ID,
      {
        preset_mode: 'boost',
        swing_horizontal_mode: 'swing',
        swing_mode: 'swing',
        fan_mode: '4',
        temperature: 22,
        hvac_mode: 'cool',
      },
      entity(),
    );
    expect(calls.map((c) => c.service)).toEqual([
      'set_hvac_mode',
      'set_temperature',
      'set_fan_mode',
      'set_swing_mode',
      'set_swing_horizontal_mode',
      'set_preset_mode',
    ]);
    expect(calls[0].data).toEqual({ entity_id: ID, hvac_mode: 'cool' });
    expect(calls[1].data).toEqual({ entity_id: ID, temperature: 22 });
  });

  it('drops the setpoint when the final mode has none', () => {
    const calls = buildCalls(ID, { temperature: 25, hvac_mode: 'dry' }, entity());
    expect(calls.map((c) => c.service)).toEqual(['set_hvac_mode']);
  });

  it('sends both ends of a range together', () => {
    const dual = {
      entity_id: 'climate.d',
      state: 'heat_cool',
      attributes: { target_temp_low: 19, target_temp_high: 24 },
    };
    const calls = buildCalls('climate.d', { target_temp_high: 25 }, dual);
    expect(calls).toEqual([
      { service: 'set_temperature', data: { entity_id: 'climate.d', target_temp_low: 19, target_temp_high: 25 } },
    ]);
  });
});

describe('buildCalls against in-flight values', () => {
  const off = { ...entity(), state: 'off' };

  it('keeps a setpoint when cool is already in flight but the entity still reports off', () => {
    // Without the baseline the final mode reads as off and the setpoint is dropped.
    expect(buildCalls(ID, { temperature: 22 }, off)).toEqual([]);
    expect(buildCalls(ID, { temperature: 22 }, off, { hvac_mode: 'cool' })).toEqual([
      { service: 'set_temperature', data: { entity_id: ID, temperature: 22 } },
    ]);
  });

  it('does not resend a mode that is already in flight', () => {
    expect(buildCalls(ID, { hvac_mode: 'cool' }, off, { hvac_mode: 'cool' })).toEqual([]);
  });

  it('sends 21 when 22 is in flight and the entity still shows 21', () => {
    const at21 = { ...entity(), attributes: { ...entity().attributes, temperature: 21 } };
    // Old code compared with the entity (21) and dropped the change back to 21.
    expect(buildCalls(ID, { temperature: 21 }, at21, { temperature: 22 })).toEqual([
      { service: 'set_temperature', data: { entity_id: ID, temperature: 21 } },
    ]);
  });
});

describe('WriteQueue with an in-flight baseline', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('flushes cool, then a setpoint made before the entity caught up, as two batches', async () => {
    const off = { ...entity(), state: 'off' };
    let inflight: Optimistic = {};
    const { q, sent } = makeQueue(1.5, () => inflight, () => off);
    q.onFlushed = (c) => (inflight = { ...inflight, ...c });
    q.set({ hvac_mode: 'cool' });
    await vi.advanceTimersByTimeAsync(1500);
    q.set({ temperature: 22 });
    await vi.advanceTimersByTimeAsync(1500);
    expect(sent.map((c) => c.map((x) => x.service))).toEqual([['set_hvac_mode'], ['set_temperature']]);
  });

  it('does not report no-op changes as sent', async () => {
    const { q } = makeQueue();
    const flushed: unknown[] = [];
    q.onFlushed = (c) => flushed.push(c);
    q.set({ temperature: 19.5 });
    await vi.advanceTimersByTimeAsync(1500);
    expect(flushed).toEqual([]);
  });

  it('cancel also clears a hold, so the next interaction is sent', async () => {
    const { q, sent } = makeQueue();
    q.hold();
    q.set({ temperature: 24 });
    q.cancel();
    q.set({ temperature: 23 });
    await vi.advanceTimersByTimeAsync(1500);
    expect(sent).toHaveLength(1);
  });
});

describe('WriteQueue debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends nothing before the delay and one call after it', async () => {
    const { q, sent } = makeQueue();
    q.set({ temperature: 21 });
    await vi.advanceTimersByTimeAsync(1499);
    expect(sent).toEqual([]);
    expect(q.isPending).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toEqual([[{ service: 'set_temperature', data: { entity_id: ID, temperature: 21 } }]]);
    expect(q.isPending).toBe(false);
  });

  it('restarts the timer on every interaction and coalesces a drag into one call', async () => {
    const { q, sent } = makeQueue();
    for (const t of [20, 20.5, 21, 21.5, 22]) {
      q.set({ temperature: t });
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual([{ service: 'set_temperature', data: { entity_id: ID, temperature: 22 } }]);
  });

  it('merges different controls into the minimum set of calls', async () => {
    const { q, sent } = makeQueue();
    q.set({ hvac_mode: 'cool' });
    await vi.advanceTimersByTimeAsync(400);
    q.set({ temperature: 23 });
    q.set({ temperature: 22.5 });
    await vi.advanceTimersByTimeAsync(400);
    q.set({ fan_mode: '5' });
    q.set({ fan_mode: '3' });
    q.set({ preset_mode: 'boost' });
    await vi.advanceTimersByTimeAsync(1500);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual([
      { service: 'set_hvac_mode', data: { entity_id: ID, hvac_mode: 'cool' } },
      { service: 'set_temperature', data: { entity_id: ID, temperature: 22.5 } },
      { service: 'set_fan_mode', data: { entity_id: ID, fan_mode: '3' } },
      { service: 'set_preset_mode', data: { entity_id: ID, preset_mode: 'boost' } },
    ]);
  });

  it('sends nothing when the user ends back on the original value', async () => {
    const { q, sent } = makeQueue();
    q.set({ temperature: 22 });
    q.set({ temperature: 19.5 });
    await vi.advanceTimersByTimeAsync(1500);
    expect(sent).toEqual([]);
  });

  it('sends a second batch for interactions after the first flush', async () => {
    const { q, sent } = makeQueue();
    q.set({ temperature: 21 });
    await vi.advanceTimersByTimeAsync(1500);
    q.set({ fan_mode: '1' });
    await vi.advanceTimersByTimeAsync(1500);
    expect(sent.map((c) => c.map((x) => x.service))).toEqual([['set_temperature'], ['set_fan_mode']]);
  });

  it('writes immediately with a delay of zero', async () => {
    const { q, sent } = makeQueue(0);
    q.set({ fan_mode: '5' });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([[{ service: 'set_fan_mode', data: { entity_id: ID, fan_mode: '5' } }]]);
  });

  it('reports the flushed change and bumps the generation per interaction', async () => {
    const { q } = makeQueue();
    const flushed: unknown[] = [];
    q.onFlushed = (c) => flushed.push(c);
    q.set({ temperature: 21 });
    q.set({ temperature: 22 });
    expect(q.generation).toBe(2);
    await vi.advanceTimersByTimeAsync(1500);
    expect(flushed).toEqual([{ temperature: 22 }]);
  });

  it('holds the timer during a drag and counts the delay from release', async () => {
    const { q, sent } = makeQueue();
    q.hold();
    q.set({ temperature: 24 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toEqual([]);
    q.release();
    await vi.advanceTimersByTimeAsync(1499);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(1);
  });

  it('cancel drops pending changes', async () => {
    const { q, sent } = makeQueue();
    q.set({ temperature: 25 });
    q.cancel();
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toEqual([]);
    expect(q.isPending).toBe(false);
  });
});
