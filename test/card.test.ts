// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/index';
import type { HomeAssistant } from '../src/types';
import { allFixtures, makeHass, mergeFixtures, type Fixture } from './fixtures';
import { materializeConfig } from '../src/detect/materialize';
import { detectSensors } from '../src/detect/roles';
import { defaultConfig } from '../src/config';
import { spinStyle } from '../src/ui/modes';
import { Memo } from '../src/detect/cache';

const K = 'climate.keuken_airco';
type AnyCard = HTMLElement & Record<string, any>;

function setup(entity = K, cfg: Record<string, unknown> = {}, fixture: Fixture = allFixtures, svc?: HomeAssistant['callService']) {
  const calls: { service: string; data: any }[] = [];
  const merged = mergeFixtures(fixture);
  const hass = makeHass(merged, '°C', svc ?? ((_d, service, data) => void calls.push({ service, data: data as any })));
  const card = document.createElement('liquid-climate-card') as unknown as AnyCard;
  // The concrete config an editor would have written.
  const base = materializeConfig(defaultConfig(entity), detectSensors(hass, entity, merged.registry));
  card.setConfig({ ...base, ...cfg, entity });
  card.hass = hass;
  document.body.append(card);
  return { card, hass, calls };
}

const touch = (hass: HomeAssistant, id: string, patch: Record<string, unknown>): HomeAssistant => ({
  ...hass,
  states: { ...hass.states, [id]: { ...hass.states[id], ...patch } as any },
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('shouldUpdate', () => {
  it('re-renders only for the climate entity, its sensors and status entities', async () => {
    const { card, hass } = setup(K, { status_entities: [{ entity: 'climate.nagelsalon_airco', name: 'Next' }] });
    await card.updateComplete;
    const render = vi.spyOn(card as any, 'render');

    // Unrelated entity: no render.
    card.hass = touch(hass, 'climate.no_fan', { state: 'off' });
    await card.updateComplete;
    expect(render).toHaveBeenCalledTimes(0);

    // Unrelated new entity added to the state map: no render.
    card.hass = { ...card.hass, states: { ...card.hass.states, 'sensor.new': { entity_id: 'sensor.new', state: '1', attributes: {} } } };
    await card.updateComplete;
    expect(render).toHaveBeenCalledTimes(0);

    // Detected humidity sensor, status entity, climate entity: each renders.
    card.hass = touch(card.hass, 'sensor.keuken_airco_luchtvochtigheid', { state: '50' });
    await card.updateComplete;
    expect(render).toHaveBeenCalledTimes(1);
    card.hass = touch(card.hass, 'climate.nagelsalon_airco', { state: 'heat' });
    await card.updateComplete;
    expect(render).toHaveBeenCalledTimes(2);
    card.hass = touch(card.hass, K, { state: 'cool' });
    await card.updateComplete;
    expect(render).toHaveBeenCalledTimes(3);
  });

  it('re-renders for a temperature_sensor override and for registry or theme changes', async () => {
    const f = mergeFixtures(allFixtures);
    f.states['sensor.room'] = { entity_id: 'sensor.room', state: '17', attributes: {} };
    const { card } = setup(K, { temperature_sensor: 'sensor.room' }, f);
    await card.updateComplete;
    const render = vi.spyOn(card as any, 'render');
    card.hass = touch(card.hass, 'sensor.room', { state: '18' });
    await card.updateComplete;
    expect(render).toHaveBeenCalledTimes(1);
    card.hass = { ...card.hass, entities: { ...card.hass.entities } };
    await card.updateComplete;
    expect(render).toHaveBeenCalledTimes(2);
    card.hass = { ...card.hass, themes: {} };
    await card.updateComplete;
    expect(render).toHaveBeenCalledTimes(3);
  });
});

describe('detection when states arrive late', () => {
  it('picks up family sensors whose state only arrives after the first render', async () => {
    const f = mergeFixtures(allFixtures);
    const late = f.states['sensor.keuken_airco_luchtvochtigheid'];
    delete f.states['sensor.keuken_airco_luchtvochtigheid'];
    const hass = makeHass(f);
    const card = document.createElement('liquid-climate-card') as unknown as AnyCard;
    card.setConfig({ entity: K });
    card.hass = hass;
    document.body.append(card);
    await card.updateComplete;
    expect(card.shadowRoot!.textContent).not.toContain('Humidity');
    card.hass = { ...hass, states: { ...hass.states, [late.entity_id]: late } };
    await card.updateComplete;
    expect(card.shadowRoot!.textContent).toContain('Humidity');
  });
});

describe('status rows', () => {
  const entities: Record<string, { state: string; attributes?: Record<string, unknown> }> = {
    'binary_sensor.door': { state: 'on', attributes: { friendly_name: 'Door' } },
    'input_boolean.pause': { state: 'off', attributes: { friendly_name: 'Pause' } },
    'switch.fan': { state: 'on', attributes: { friendly_name: 'Fan switch' } },
    'input_select.mode': { state: 'heat', attributes: { friendly_name: 'Mode' } },
    'select.sched': { state: 'night', attributes: { friendly_name: 'Schedule' } },
    'sensor.power': { state: '2.5', attributes: { friendly_name: 'Power', unit_of_measurement: 'kW' } },
    'sensor.plain': { state: 'ok', attributes: { friendly_name: 'Plain' } },
    'timer.nap': { state: 'active', attributes: { friendly_name: 'Nap', finishes_at: new Date(Date.now() + 125_000).toISOString() } },
    'timer.idle': { state: 'idle', attributes: { friendly_name: 'Idle timer' } },
    'sensor.dead': { state: 'unavailable', attributes: { friendly_name: 'Dead' } },
    'sensor.unk': { state: 'unknown', attributes: { friendly_name: 'Unk' } },
    'input_text.long': { state: 'heat|16.5|some very long value that should never wrap onto a second line', attributes: { friendly_name: 'Long' } },
  };
  const mount = async (ids: (string | { entity: string; name?: string; icon?: string })[], format = true) => {
    const f = mergeFixtures(allFixtures);
    for (const [id, e] of Object.entries(entities)) f.states[id] = { entity_id: id, state: e.state, attributes: e.attributes ?? {} };
    const { card, hass } = setup(K, { status_entities: ids.map((i) => (typeof i === 'string' ? { entity: i } : i)) }, f);
    if (format) {
      (hass as any).formatEntityState = (s: any) => ({ on: 'On', off: 'Off', heat: 'Heating' }[s.state as string] ?? s.state);
      card.hass = { ...hass };
    }
    await card.updateComplete;
    return card;
  };
  const rows = (card: AnyCard) => [...card.shadowRoot!.querySelectorAll('.status button.row')] as HTMLElement[];
  const val = (r: HTMLElement) => r.querySelector('.val')!.textContent!.replace(/\s+/g, ' ').trim();
  const lbl = (r: HTMLElement) => r.querySelector('.lbl')!.textContent!.trim();

  it('uses the friendly name as the label by default and name when set', async () => {
    const card = await mountNamed();
    expect(rows(card).map(lbl)).toEqual(['Door', 'Custom']);
  });
  async function mountNamed() {
    return mount(['binary_sensor.door', { entity: 'input_boolean.pause', name: 'Custom' }]);
  }

  it('shows a dot plus On or Off for binary_sensor, input_boolean and switch', async () => {
    const card = await mount(['binary_sensor.door', 'input_boolean.pause', 'switch.fan']);
    const r = rows(card);
    expect(r.map(val)).toEqual(['On', 'Off', 'On']);
    const dots = r.map((x) => x.querySelector('.dot')!.getAttribute('style')!);
    expect(dots[0]).toContain('opacity: 0.85');
    expect(dots[1]).toContain('opacity: 0.3');
    expect(dots[2]).toContain('opacity: 0.85');
  });

  it('shows the formatted option for input_select and select, and the formatted state otherwise', async () => {
    const card = await mount(['input_select.mode', 'select.sched', 'sensor.plain']);
    expect(rows(card).map(val)).toEqual(['Heating', 'night', 'ok']);
    expect(rows(card)[0].querySelector('.dot')).toBeNull();
  });

  it('shows number and a dimmed unit for a sensor with a unit', async () => {
    const card = await mount(['sensor.power']);
    const v = rows(card)[0].querySelector('.val')!;
    expect(v.textContent!.replace(/\s+/g, ' ').trim()).toBe('2.5 kW');
    expect(v.querySelector('small.unit')!.textContent!.trim()).toBe('kW');
  });

  it('shows remaining time as mm:ss for an active timer, else the formatted state', async () => {
    const card = await mount(['timer.nap', 'timer.idle']);
    expect(val(rows(card)[0])).toMatch(/^0[12]:\d\d$/);
    expect(val(rows(card)[0])).toBe('02:05');
    expect(val(rows(card)[1])).toBe('idle');
  });

  it('counts an active timer down once a second', async () => {
    const card = await mount(['timer.nap']);
    expect(val(rows(card)[0])).toBe('02:05');
    await vi.advanceTimersByTimeAsync(1000);
    await card.updateComplete;
    expect(val(rows(card)[0])).toBe('02:04');
  });

  it('shows a muted -- for unavailable and unknown entities, and hides a missing one', async () => {
    const card = await mount(['sensor.dead', 'sensor.unk', 'sensor.nope']);
    expect(rows(card).map(val)).toEqual(['--', '--']);
    expect(rows(card)[0].querySelector('.val .muted')).not.toBeNull();
  });

  it('keeps long values on one line with a title holding the full value', async () => {
    const card = await mount(['input_text.long']);
    const r = rows(card)[0];
    expect(r.querySelector('.val')!.getAttribute('title')).toBe('heat|16.5|some very long value that should never wrap onto a second line');
    expect(r.getAttribute('title') ?? r.querySelector('.val')!.getAttribute('title')).toContain('heat|16.5');
  });

  it('falls back to the raw state, with unit, when hass has no formatEntityState', async () => {
    const card = await mount(['input_text.long', 'sensor.power'], false);
    expect(rows(card).map(val)[1]).toBe('2.5 kW');
    expect(val(rows(card)[0])).toContain('heat|16.5');
  });

  it('is a real button that fires hass-more-info with the entity id', async () => {
    const card = await mount(['binary_sensor.door']);
    const seen: any[] = [];
    card.addEventListener('hass-more-info', (e: Event) => seen.push((e as CustomEvent).detail));
    const r = rows(card)[0];
    expect(r.tagName).toBe('BUTTON');
    r.click();
    expect(seen).toEqual([{ entityId: 'binary_sensor.door' }]);
  });

  it('renders an ha-icon only when an icon is configured', async () => {
    const card = await mount([{ entity: 'binary_sensor.door', icon: 'mdi:door' }, 'input_boolean.pause']);
    const r = rows(card);
    expect(r[0].querySelector('ha-icon')!.getAttribute('icon')).toBe('mdi:door');
    expect(r[1].querySelector('ha-icon')).toBeNull();
  });
});

describe('glass follows the HA theme by default', () => {
  const cls = async (themes: unknown, glass?: string) => {
    const { card, hass } = setup(K, glass ? { look: { glass } } : {});
    card.hass = { ...hass, themes };
    await card.updateComplete;
    return card.shadowRoot!.querySelector('section.lc')!.className;
  };

  it('resolves theme to dark glass in dark mode and light glass otherwise', async () => {
    expect(await cls({ darkMode: true })).toContain('g-dark');
    expect(await cls({ darkMode: false })).toContain('g-light');
    expect(await cls(undefined)).toContain('g-light');
  });

  it('picks dark glass for a dark single-mode theme background', async () => {
    const { card, hass } = setup(K, {});
    card.style.setProperty('--primary-background-color', '#111111');
    card.hass = { ...hass, themes: { darkMode: false } };
    await card.updateComplete;
    expect(card.shadowRoot!.querySelector('section.lc')!.className).toContain('g-dark');
  });

  it('keeps an explicit choice', async () => {
    expect(await cls({ darkMode: false }, 'dark')).toContain('g-dark');
    expect(await cls({ darkMode: true }, 'light')).toContain('g-light');
  });
});

describe('pointer-follow light', () => {
  const ev = (type: string, pointerType: string, x = 100, y = 80) =>
    Object.assign(new Event(type, { bubbles: true }), { pointerType, clientX: x, clientY: y });
  const mount = async (cfg: Record<string, unknown> = {}) => {
    const { card } = setup(K, cfg);
    await card.updateComplete;
    const root = card.shadowRoot!.querySelector('section.lc') as HTMLElement;
    const glow = card.shadowRoot!.querySelector('.glow') as HTMLElement;
    return { card, root, glow };
  };

  it('is hidden by default', async () => {
    const { glow } = await mount();
    expect(glow).not.toBeNull();
    expect(glow.classList.contains('on')).toBe(false);
  });

  it('shows while a mouse hovers and hides on leave, cancel and focusout', async () => {
    const { root, glow } = await mount();
    root.dispatchEvent(ev('pointerenter', 'mouse'));
    expect(glow.classList.contains('on')).toBe(true);
    root.dispatchEvent(ev('pointerleave', 'mouse'));
    expect(glow.classList.contains('on')).toBe(false);
    root.dispatchEvent(ev('pointerenter', 'mouse'));
    root.dispatchEvent(ev('pointercancel', 'mouse'));
    expect(glow.classList.contains('on')).toBe(false);
    root.dispatchEvent(ev('pointerenter', 'mouse'));
    root.dispatchEvent(Object.assign(new Event('focusout', { bubbles: true }), { relatedTarget: document.body }));
    expect(glow.classList.contains('on')).toBe(false);
  });

  it('keeps the light while focus moves inside the card or the pointer is still over it', async () => {
    const { card, root, glow } = await mount();
    const inner = card.shadowRoot!.querySelector('button')!;
    root.dispatchEvent(ev('pointerenter', 'mouse'));
    // Focus moves between buttons inside the card.
    root.dispatchEvent(Object.assign(new Event('focusout', { bubbles: true }), { relatedTarget: inner }));
    expect(glow.classList.contains('on')).toBe(true);
    // Focus leaves to nowhere (a click on a button), mouse still over the card.
    root.dispatchEvent(Object.assign(new Event('focusout', { bubbles: true }), { relatedTarget: null }));
    expect(glow.classList.contains('on')).toBe(true);
  });

  it('jumps to the new position before fading in, and follows the mouse without re-rendering', async () => {
    const { card, root, glow } = await mount();
    root.dispatchEvent(ev('pointerenter', 'mouse', 10, 10));
    const first = glow.style.getPropertyValue('--mx');
    root.dispatchEvent(ev('pointerleave', 'mouse'));
    root.dispatchEvent(ev('pointerenter', 'mouse', 30, 30));
    expect(glow.style.getPropertyValue('--mx')).not.toBe('');
    expect(glow.classList.contains('on')).toBe(true);
    expect(first).not.toBe('');
    const render = vi.spyOn(card as any, 'render');
    root.dispatchEvent(ev('pointermove', 'mouse', 40, 40));
    await vi.advanceTimersByTimeAsync(50);
    expect(render).not.toHaveBeenCalled();
  });

  it('never shows for touch or pen', async () => {
    const { root, glow } = await mount();
    for (const t of ['touch', 'pen']) {
      root.dispatchEvent(ev('pointerenter', t));
      root.dispatchEvent(ev('pointermove', t));
      expect(glow.classList.contains('on')).toBe(false);
    }
  });

  it('never shows with motion minimal', async () => {
    const { root, glow } = await mount({ look: { motion: 'minimal' } });
    root.dispatchEvent(ev('pointerenter', 'mouse'));
    root.dispatchEvent(ev('pointermove', 'mouse'));
    expect(glow.classList.contains('on')).toBe(false);
  });

  it('never shows with prefers-reduced-motion', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q }));
    const { root, glow } = await mount();
    root.dispatchEvent(ev('pointerenter', 'mouse'));
    expect(glow.classList.contains('on')).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('queue lifecycle', () => {
  it('sends a pending change when the card is removed', async () => {
    const { card, calls } = setup();
    await card.updateComplete;
    card._queue.set({ temperature: 22 });
    card.remove();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([{ service: 'set_temperature', data: { entity_id: K, temperature: 22 } }]);
  });

  it('sends pending changes to the old entity when the config switches entity, and clears in-flight state', async () => {
    const { card, calls } = setup();
    await card.updateComplete;
    card._queue.set({ fan_mode: '5' });
    card._inflight = { temperature: 25 };
    card.setConfig({ entity: 'climate.slaapkamer_airco' });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([{ service: 'set_fan_mode', data: { entity_id: K, fan_mode: '5' } }]);
    expect(card._inflight).toEqual({});
    expect(card._queue.isPending).toBe(false);
  });

  it('treats lostpointercapture like pointerup', async () => {
    const { card, calls } = setup();
    await card.updateComplete;
    const dial = card.shadowRoot!.querySelector('svg.dial')!;
    card._drag = 'temp';
    card._queue.hold();
    card._queue.set({ temperature: 23 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toEqual([]);
    dial.dispatchEvent(new Event('lostpointercapture'));
    expect(card._drag).toBeNull();
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toHaveLength(1);
  });

  it('a config switch clears an active drag and hold, so later writes are sent', async () => {
    const { card, calls } = setup();
    await card.updateComplete;
    card._drag = 'fan';
    card._queue.hold();
    card.setConfig({ entity: 'climate.slaapkamer_airco' });
    card._queue.set({ temperature: 20 });
    await vi.advanceTimersByTimeAsync(1500);
    expect(card._drag).toBeNull();
    expect(calls).toHaveLength(1);
  });
});

describe('failed service call', () => {
  it('shows a brief error line on the card, then removes it', async () => {
    const { card } = setup(K, {}, allFixtures, () => Promise.reject(new Error('Rate limit reached')));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await card.updateComplete;
    card._queue.set({ temperature: 22 });
    await vi.advanceTimersByTimeAsync(1500);
    await card.updateComplete;
    expect(card.shadowRoot!.querySelector('[role=alert]')?.textContent).toContain('Rate limit reached');
    await vi.advanceTimersByTimeAsync(6100);
    await card.updateComplete;
    expect(card.shadowRoot!.querySelector('[role=alert]')).toBeNull();
  });
});

describe('dual setpoint', () => {
  it('exposes both knobs as sliders with their own value', async () => {
    const { card } = setup('climate.dual_setpoint');
    await card.updateComplete;
    const sliders = [...card.shadowRoot!.querySelectorAll('circle[role=slider]')];
    expect(sliders.map((s) => s.getAttribute('aria-label'))).toEqual(['Lower target temperature', 'Upper target temperature']);
    expect(sliders.map((s) => s.getAttribute('aria-valuenow'))).toEqual(['19', '24']);
    expect(sliders[1].getAttribute('aria-valuetext')).toBe('24.0 °C');
    expect(card.shadowRoot!.querySelector('svg.dial')!.getAttribute('role')).toBe('group');
  });

  it('moves the upper knob with Shift plus arrow and a focused knob with a plain arrow', async () => {
    const { card, calls } = setup('climate.dual_setpoint');
    await card.updateComplete;
    const dial = card.shadowRoot!.querySelector('svg.dial')!;
    dial.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls[0].data).toMatchObject({ target_temp_low: 19, target_temp_high: 24.5 });
    const lowKnob = card.shadowRoot!.querySelector('circle[data-knob=low]')!;
    lowKnob.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, composed: true }));
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls[1].data).toMatchObject({ target_temp_low: 18.5 });
  });

  it('clamps the range to min and max', async () => {
    const f = mergeFixtures(allFixtures);
    Object.assign(f.states['climate.dual_setpoint'].attributes, { target_temp_low: 35, target_temp_high: 34.5 });
    const { card, calls } = setup('climate.dual_setpoint', {}, f);
    await card.updateComplete;
    const dial = card.shadowRoot!.querySelector('svg.dial')!;
    dial.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls[0].data.target_temp_high).toBeLessThanOrEqual(35);
    expect(calls[0].data.target_temp_low).toBeLessThanOrEqual(35);
  });
});

describe('layout and motion', () => {
  it('offers grid options for the sections layout', () => {
    const { card } = setup();
    expect(card.getGridOptions()).toMatchObject({ columns: 12, min_columns: 6 });
  });

  it('pauses the spin animation when the unit is off', () => {
    expect(spinStyle(7, false).animationPlayState).toBe('paused');
    expect(spinStyle(7, true).animationPlayState).toBe('running');
    expect(spinStyle(2.64, true).animationDuration).toBe('2.6s');
  });

  it('pauses animations while the card is not visible', async () => {
    let cb: (e: { isIntersecting: boolean }[]) => void = () => undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(fn: typeof cb) {
          cb = fn;
        }
        observe() {}
        disconnect() {}
      },
    );
    const { card } = setup();
    await card.updateComplete;
    cb([{ isIntersecting: false }]);
    expect(card.hasAttribute('data-paused')).toBe(true);
    cb([{ isIntersecting: true }]);
    expect(card.hasAttribute('data-paused')).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('detection memo', () => {
  it('computes once per identical key and again when a key part changes', () => {
    const memo = new Memo<number>();
    const compute = vi.fn(() => 42);
    const entities = {};
    expect(memo.get([entities, 'a', 3], compute)).toBe(42);
    expect(memo.get([entities, 'a', 3], compute)).toBe(42);
    expect(compute).toHaveBeenCalledTimes(1);
    memo.get([entities, 'a', 4], compute);
    expect(compute).toHaveBeenCalledTimes(2);
    memo.clear();
    memo.get([entities, 'a', 4], compute);
    expect(compute).toHaveBeenCalledTimes(3);
  });
});

describe('editor', () => {
  it('writes concrete ids from the full registry into the config on the first edit', async () => {
    const hass = makeHass(allFixtures);
    const list = Object.entries(allFixtures.registry).map(([entity_id, x]) => ({ entity_id, ...x }));
    const ws = vi.fn(async (m: any) => (m.type === 'config/entity_registry/list' ? list : []));
    (hass as any).callWS = ws;
    const editor = document.createElement('liquid-climate-card-editor') as unknown as HTMLElement & {
      hass: HomeAssistant;
      setConfig(c: unknown): void;
      updateComplete: Promise<boolean>;
    };
    editor.hass = hass;
    editor.setConfig({ entity: K });
    document.body.append(editor);
    await editor.updateComplete;
    await vi.advanceTimersByTimeAsync(0);
    await editor.updateComplete;
    expect(ws).toHaveBeenCalledWith({ type: 'config/entity_registry/list' });

    let saved: any = null;
    editor.addEventListener('config-changed', (e: Event) => (saved = (e as CustomEvent).detail.config));
    // A user edit: type a name.
    const name = editor.shadowRoot!.querySelectorAll('input[type=text]')[0] as HTMLInputElement;
    name.value = 'Living Room';
    name.dispatchEvent(new Event('change'));
    expect(saved.name).toBe('Living Room');
    expect(saved.sensors.humidity).toBe('sensor.keuken_airco_luchtvochtigheid');
    expect(saved.sensors.outdoor).toBe('sensor.keuken_airco_buitentemperatuur');
    expect(saved.sensors.cloud_limit).toBe('sensor.keuken_airco_gateway_ratelimit_remaining_day');
    expect(saved.sensors.energy).toHaveLength(2);
  });
});
