import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WriterLease, acquireWriter, forgetModes, powerOnMode, releaseWriter, rememberMode, rememberedMode, writerRefs } from '../src/cards/shared/writer';
import { hassNeedsRender } from '../src/cards/shared/render-gate';
import { allFixtures, makeHass, mergeFixtures } from './fixtures';

describe('power on mode', () => {
  it('returns to the remembered mode when the entity still supports it', () => {
    expect(powerOnMode(['off', 'heat', 'cool'], 'cool')).toBe('cool');
    expect(powerOnMode(['off', 'heat'], 'cool')).toBe('heat');
  });

  it('falls back to heat, cool, heat_cool, auto, fan_only, dry in that order', () => {
    expect(powerOnMode(['off', 'dry', 'cool', 'heat'])).toBe('heat');
    expect(powerOnMode(['off', 'auto', 'heat_cool'])).toBe('heat_cool');
    expect(powerOnMode(['off', 'dry', 'fan_only'])).toBe('fan_only');
  });

  it('uses the first non-off mode when none of the known ones exist, and nothing for off only', () => {
    expect(powerOnMode(['off', 'eco'])).toBe('eco');
    expect(powerOnMode(['off'])).toBeUndefined();
    expect(powerOnMode(undefined)).toBeUndefined();
  });

  it('remembers only real modes, per entity', () => {
    forgetModes();
    rememberMode('climate.a', 'cool');
    rememberMode('climate.a', 'off');
    rememberMode('climate.a', 'unavailable');
    expect(rememberedMode('climate.a')).toBe('cool');
    expect(rememberedMode('climate.b')).toBeUndefined();
  });
});

describe('climate writer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    forgetModes();
  });
  afterEach(() => vi.useRealTimers());

  const make = (entity: string, state?: string) => {
    const f = mergeFixtures(allFixtures);
    if (state) f.states[entity].state = state;
    const calls: { service: string; data: any }[] = [];
    const hass = makeHass(f, '°C', (_d, service, data) => void calls.push({ service, data }));
    const w = acquireWriter(entity);
    held.push(w);
    w.hass = hass;
    return { w, calls, hass };
  };
  const held: ReturnType<typeof acquireWriter>[] = [];
  afterEach(() => held.splice(0).forEach(releaseWriter));

  it('turns an off unit back on to the mode it was last seen in', async () => {
    const { w, calls, hass } = make('climate.slaapkamer_airco');
    w.observe(hass); // seen in cool
    hass.states['climate.slaapkamer_airco'] = { ...hass.states['climate.slaapkamer_airco'], state: 'off' };
    w.observe(hass);
    w.togglePower('off');
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual([{ service: 'set_hvac_mode', data: { entity_id: 'climate.slaapkamer_airco', hvac_mode: 'cool' } }]);
  });

  it('keeps sent values as optimistic until the entity reports them', async () => {
    const { w, hass } = make('climate.keuken_airco');
    w.set({ temperature: 22 });
    await vi.advanceTimersByTimeAsync(1500);
    expect(w.local).toEqual({ temperature: 22 });
    hass.states['climate.keuken_airco'].attributes.temperature = 22;
    w.observe(hass);
    expect(w.local).toEqual({});
  });

  it('is one shared writer per entity, ref-counted, and sends pending changes when the last user leaves', async () => {
    const { calls, hass } = make('climate.keuken_airco');
    const seen: string[] = [];
    const a = new WriterLease(() => seen.push('a'));
    const b = new WriterLease(() => seen.push('b'));
    const wa = a.get('climate.keuken_airco');
    const wb = b.get('climate.keuken_airco');
    expect(wa).toBe(wb);
    expect(writerRefs('climate.keuken_airco')).toBe(3);
    wa.hass = hass;
    wa.set({ temperature: 22 });
    // Both cards hear about the change.
    expect(seen).toContain('a');
    expect(seen).toContain('b');
    expect(wb.queue.pending).toEqual({ temperature: 22 });
    a.release();
    await vi.advanceTimersByTimeAsync(0);
    // A card leaving sends what is pending, so nothing waits on a card that is gone.
    expect(calls).toEqual([{ service: 'set_temperature', data: { entity_id: 'climate.keuken_airco', temperature: 22 } }]);
    b.release();
    expect(writerRefs('climate.keuken_airco')).toBe(1);
  });
});

describe('render gate', () => {
  it('ignores unrelated state changes and reacts to watched ones, registries and theme', () => {
    const hass = makeHass(mergeFixtures(allFixtures));
    const other = { ...hass, states: { ...hass.states, 'climate.no_fan': { ...hass.states['climate.no_fan'], state: 'off' } } };
    expect(hassNeedsRender(hass, other, ['climate.keuken_airco'])).toBe(false);
    expect(hassNeedsRender(hass, other, ['climate.no_fan'])).toBe(true);
    expect(hassNeedsRender(hass, { ...hass, entities: {} }, ['climate.keuken_airco'])).toBe(true);
    expect(hassNeedsRender(hass, { ...hass, themes: { darkMode: true } }, ['climate.keuken_airco'])).toBe(true);
    expect(hassNeedsRender(undefined, hass, [])).toBe(true);
  });
});
