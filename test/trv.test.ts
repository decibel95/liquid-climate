// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/index';
import { defaultConfig } from '../src/config';
import { materializeConfig } from '../src/detect/materialize';
import { detectSensors } from '../src/detect/roles';
import { forgetModes } from '../src/cards/shared/writer';
import { emptyElements } from './empty-elements';
import { allFixtures, makeHass, mergeFixtures, type Fixture } from './fixtures';
import { TRV, trvFixtures } from './fixtures/trv';
import type { HomeAssistant } from '../src/types';

type AnyEl = HTMLElement & Record<string, any>;

const BATTERY = 'sensor.trv_sonoff_battery';
const VALVE = 'sensor.trv_sonoff_pi_heating_demand';
const WINDOW = 'binary_sensor.trv_sonoff_window_open';

const fixture = (tweak?: (f: Fixture) => void): Fixture => {
  const f = mergeFixtures(allFixtures, trvFixtures);
  f.states['input_boolean.window'] = { entity_id: 'input_boolean.window', state: 'off', attributes: {} };
  tweak?.(f);
  return f;
};

/** Mount a card. `sensors` is what the editor would have written (the valve needs the registry), `cfg` wins over it. */
function mount(tag: string, entity: string, cfg: Record<string, unknown> = {}, tweak?: (f: Fixture) => void) {
  const f = fixture(tweak);
  const calls: { service: string; data: any }[] = [];
  const hass = makeHass(f, '°C', (_d, service, data) => void calls.push({ service, data: data as any }));
  const written = tag === 'liquid-climate-cluster' ? {} : materializeConfig(defaultConfig(entity), detectSensors(hass, entity, f.registry));
  const el = document.createElement(tag) as unknown as AnyEl;
  el.setConfig({ ...written, type: `custom:${tag}`, entity, ...cfg });
  el.hass = hass;
  document.body.append(el);
  return { el, hass, f, calls };
}

const $ = (el: AnyEl, sel: string) => el.shadowRoot!.querySelector(sel) as HTMLElement | null;
const $$ = (el: AnyEl, sel: string) => [...el.shadowRoot!.querySelectorAll(sel)] as HTMLElement[];
const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

const withState = (hass: HomeAssistant, id: string, state: string, attributes?: Record<string, unknown>): HomeAssistant => ({
  ...hass,
  states: { ...hass.states, [id]: { ...hass.states[id], state, attributes: { ...hass.states[id].attributes, ...(attributes ?? {}) } } },
});

const lowBattery = (f: Fixture) => (f.states[BATTERY].state = '12');

beforeEach(() => {
  vi.useFakeTimers();
  forgetModes();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('dial: radiator valves', () => {
  it.each(Object.values(TRV))('%s renders without an empty element', async (id) => {
    const { el } = mount('liquid-climate-card', id);
    await el.updateComplete;
    expect(emptyElements(el.shadowRoot!)).toEqual([]);
  });

  it('a unit that is idle reads "Idle, target 20.0°", not Heating', async () => {
    const { el } = mount('liquid-climate-card', TRV.sonoff);
    await el.updateComplete;
    expect(text($(el, '.sub'))).toBe('Idle, target 20.0°');
  });

  it('a unit that is heating reads "Heating to 20.0°"', async () => {
    const { el } = mount('liquid-climate-card', TRV.sonoff, {}, (f) => (f.states[TRV.sonoff].attributes.hvac_action = 'heating'));
    await el.updateComplete;
    expect(text($(el, '.sub'))).toBe('Heating to 20.0°');
  });

  it('a unit without hvac_action keeps the mode verb', async () => {
    const { el } = mount('liquid-climate-card', TRV.sonoff, {}, (f) => delete f.states[TRV.sonoff].attributes.hvac_action);
    await el.updateComplete;
    expect(text($(el, '.sub'))).toBe('Heating to 20.0°');
  });

  it('the target arc is softer while idle, in the same colour', async () => {
    // happy-dom misplaces the parts inside the dial svg, so read the values the template is rendered with.
    const values = (t: any): unknown[] => (Array.isArray(t) ? t.flatMap(values) : t && typeof t === 'object' && 'values' in t ? (t.values as unknown[]).flatMap(values) : [t]);
    const idle = mount('liquid-climate-card', TRV.sonoff);
    await idle.el.updateComplete;
    const idleValues = values(idle.el.render());
    expect(idleValues).toContain(0.6);
    document.body.innerHTML = '';
    const heating = mount('liquid-climate-card', TRV.sonoff, {}, (f) => (f.states[TRV.sonoff].attributes.hvac_action = 'heating'));
    await heating.el.updateComplete;
    const heatingValues = values(heating.el.render());
    expect(heatingValues).not.toContain(0.6);
    // Same colour either way: no new colour appears for the arc.
    const colors = (v: unknown[]) => v.filter((x) => typeof x === 'string' && x.startsWith('#'));
    expect(colors(idleValues)).toEqual(colors(heatingValues));
  });

  it('a low battery shows an alert, a healthy one nothing', async () => {
    const ok = mount('liquid-climate-card', TRV.sonoff);
    await ok.el.updateComplete;
    expect($(ok.el, '.alert')).toBeNull();
    document.body.innerHTML = '';
    const low = mount('liquid-climate-card', TRV.sonoff, {}, lowBattery);
    await low.el.updateComplete;
    expect(text($(low.el, '.alert'))).toBe('Battery low, 12%');
    expect(emptyElements(low.el.shadowRoot!)).toEqual([]);
  });

  it('the battery limit is 20 percent: 20 is fine, 19 is low', async () => {
    const at20 = mount('liquid-climate-card', TRV.sonoff, {}, (f) => (f.states[BATTERY].state = '20'));
    await at20.el.updateComplete;
    expect($(at20.el, '.alert')).toBeNull();
    document.body.innerHTML = '';
    const at19 = mount('liquid-climate-card', TRV.sonoff, {}, (f) => (f.states[BATTERY].state = '19'));
    await at19.el.updateComplete;
    expect(text($(at19.el, '.alert'))).toBe('Battery low, 19%');
  });

  it.each(['unavailable', 'unknown'])('a battery that is %s is not low', async (state) => {
    const { el } = mount('liquid-climate-card', TRV.sonoff, {}, (f) => (f.states[BATTERY].state = state));
    await el.updateComplete;
    expect($(el, '.alert')).toBeNull();
  });

  it('a battery low flag (binary_sensor on) is low too, with no percentage', async () => {
    const { el } = mount('liquid-climate-card', TRV.presetNone, {}, (f) => {
      f.devices.dev_trv_none = { ...f.devices.dev_trv_none };
      f.entities['binary_sensor.spare_battery_low'] = { entity_id: 'binary_sensor.spare_battery_low', platform: 'mqtt', device_id: 'dev_trv_none', translation_key: null };
      f.states['binary_sensor.spare_battery_low'] = { entity_id: 'binary_sensor.spare_battery_low', state: 'on', attributes: { device_class: 'battery' } };
    });
    await el.updateComplete;
    expect(text($(el, '.alert'))).toBe('Battery low');
  });

  it('sensors.battery: false hides the alert', async () => {
    const { el } = mount('liquid-climate-card', TRV.sonoff, { sensors: { battery: false } }, lowBattery);
    await el.updateComplete;
    expect($(el, '.alert')).toBeNull();
  });

  it('the Battery figure needs an explicit entity', async () => {
    const auto = mount('liquid-climate-card', TRV.sonoff);
    await auto.el.updateComplete;
    expect($$(auto.el, '.info .l').map(text)).not.toContain('Battery');
    document.body.innerHTML = '';
    const set = mount('liquid-climate-card', TRV.sonoff, { sensors: { battery: BATTERY } });
    await set.el.updateComplete;
    const fig = $$(set.el, '.info > div').find((d) => text(d.querySelector('.l')) === 'Battery')!;
    expect(text(fig.querySelector('.v'))).toBe('78 %');
  });

  it('the valve opening shows as a Valve figure, hidden with false', async () => {
    const { el } = mount('liquid-climate-card', TRV.sonoff);
    await el.updateComplete;
    const fig = $$(el, '.info > div').find((d) => text(d.querySelector('.l')) === 'Valve')!;
    expect(text(fig.querySelector('.v'))).toBe('45 %');
    document.body.innerHTML = '';
    const off = mount('liquid-climate-card', TRV.sonoff, { sensors: { valve: false } });
    await off.el.updateComplete;
    expect($(off.el, '.info')).toBeNull();
  });

  it('a valve entity reports its current_position', async () => {
    const { el } = mount('liquid-climate-card', TRV.presetNone, {}, (f) => {
      f.entities['valve.spare_valve'] = { entity_id: 'valve.spare_valve', platform: 'mqtt', device_id: 'dev_trv_none', translation_key: null };
      f.states['valve.spare_valve'] = { entity_id: 'valve.spare_valve', state: 'open', attributes: { current_position: 60 } };
    });
    await el.updateComplete;
    expect(text($$(el, '.info > div')[0])).toBe('60 % Valve');
  });

  it('the calibration offset is shown nowhere, and no Daikin item appears', async () => {
    const { el } = mount('liquid-climate-card', TRV.sonoff, {}, lowBattery);
    await el.updateComplete;
    const all = text(el.shadowRoot as unknown as Element);
    expect(all).not.toMatch(/calibration|-0\.4|0\.4/i);
    expect($$(el, '.info .l').map(text)).toEqual(['Valve']);
    expect(all).not.toMatch(/cloud|kWh|reports a problem/i);
  });

  it('write_hold keeps a sent value on screen: 30 s holds past 20 s, the default of 10 s does not', async () => {
    const run = async (cfg: Record<string, unknown>) => {
      document.body.innerHTML = '';
      forgetModes();
      const { el, hass, calls } = mount('liquid-climate-card', TRV.sonoff, cfg, (f) => (f.states[TRV.sonoff].attributes.hvac_action = 'heating'));
      await el.updateComplete;
      (el as any)._queue.set({ temperature: 22 });
      await vi.advanceTimersByTimeAsync(1600);
      expect(calls).toHaveLength(1);
      // The device still reports the old target after 20 s.
      await vi.advanceTimersByTimeAsync(20_000);
      el.hass = withState(hass, TRV.sonoff, 'heat');
      await el.updateComplete;
      return text($(el, '.sub'));
    };
    expect(await run({ write_hold: 30 })).toBe('Heating to 22.0°');
    expect(await run({})).toBe('Heating to 20.0°');
  });
});

describe('tile: radiator valves', () => {
  it.each(Object.values(TRV))('%s renders without an empty element', async (id) => {
    const { el } = mount('liquid-climate-tile', id);
    await el.updateComplete;
    expect(emptyElements(el.shadowRoot!)).toEqual([]);
  });

  it('idle and heating sublines', async () => {
    const idle = mount('liquid-climate-tile', TRV.sonoff);
    await idle.el.updateComplete;
    expect(text($(idle.el, '.sub'))).toBe('Idle, 19.4° inside');
    document.body.innerHTML = '';
    const heating = mount('liquid-climate-tile', TRV.sonoff, {}, (f) => (f.states[TRV.sonoff].attributes.hvac_action = 'heating'));
    await heating.el.updateComplete;
    expect(text($(heating.el, '.sub'))).toBe('Heating, 19.4° inside');
  });

  it('a low battery replaces the subline in the warning style; healthy, unavailable and false show the usual one', async () => {
    const low = mount('liquid-climate-tile', TRV.sonoff, {}, lowBattery);
    await low.el.updateComplete;
    expect(text($(low.el, '.sub'))).toBe('Battery low, 12%');
    expect($(low.el, '.sub')!.className).toContain('err');
    expect(text($(low.el, '.sr'))).toContain('Battery low, 12%');
    for (const [cfg, tweak] of [
      [{}, undefined],
      [{}, (f: Fixture) => (f.states[BATTERY].state = 'unavailable')],
      [{ sensors: { battery: false } }, lowBattery],
    ] as [Record<string, unknown>, ((f: Fixture) => void) | undefined][]) {
      document.body.innerHTML = '';
      const { el } = mount('liquid-climate-tile', TRV.sonoff, cfg, tweak);
      await el.updateComplete;
      expect(text($(el, '.sub'))).toBe('Idle, 19.4° inside');
      expect($(el, '.sub')!.className).not.toContain('err');
    }
  });

  it('a health problem still wins over a low battery', async () => {
    const { el } = mount('liquid-climate-tile', TRV.sonoff, {}, (f) => {
      lowBattery(f);
      f.entities['binary_sensor.trv_sonoff_problem'] = { entity_id: 'binary_sensor.trv_sonoff_problem', platform: 'mqtt', device_id: 'dev_trv_sonoff', translation_key: null };
      f.states['binary_sensor.trv_sonoff_problem'] = { entity_id: 'binary_sensor.trv_sonoff_problem', state: 'on', attributes: { device_class: 'problem' } };
    });
    await el.updateComplete;
    expect(text($(el, '.sub'))).toBe('Error');
  });

  it('shows no valve, calibration or Daikin items', async () => {
    const { el } = mount('liquid-climate-tile', TRV.sonoff);
    await el.updateComplete;
    expect(text(el.shadowRoot as unknown as Element)).not.toMatch(/valve %|calibration|cloud|kWh|45/i);
  });

  it('write_hold: the target stays at the sent value for 30 s, and falls back after the default 10 s', async () => {
    const run = async (cfg: Record<string, unknown>) => {
      document.body.innerHTML = '';
      forgetModes();
      const { el, hass, calls } = mount('liquid-climate-tile', TRV.sonoff, cfg);
      await el.updateComplete;
      (el.shadowRoot!.querySelectorAll('button.step')[1] as HTMLButtonElement).click(); // 20.0 -> 20.5
      await vi.advanceTimersByTimeAsync(1600);
      expect(calls).toEqual([{ service: 'set_temperature', data: { entity_id: TRV.sonoff, temperature: 20.5 } }]);
      await vi.advanceTimersByTimeAsync(20_000);
      el.hass = withState(hass, TRV.sonoff, 'heat');
      await el.updateComplete;
      return text($(el, '.target'));
    };
    expect(await run({ write_hold: 30 })).toBe('20.5°');
    expect(await run({})).toBe('20.0°');
  });
});

describe('badge: radiator valves', () => {
  const value = (b: AnyEl) => text($(b, '.v'));
  const kind = (b: AnyEl) => $(b, '.badge')!.className;

  it.each(Object.values(TRV))('%s renders without an empty element', async (id) => {
    const { el } = mount('liquid-climate-badge', id);
    await el.updateComplete;
    expect(emptyElements(el.shadowRoot!)).toEqual([]);
  });

  it('shows the room temperature, and Battery low only when the battery is low', async () => {
    const ok = mount('liquid-climate-badge', TRV.sonoff);
    await ok.el.updateComplete;
    expect(value(ok.el)).toBe('19.4°');
    document.body.innerHTML = '';
    const low = mount('liquid-climate-badge', TRV.sonoff, {}, lowBattery);
    await low.el.updateComplete;
    expect(value(low.el)).toBe('Battery low');
    expect(kind(low.el)).toContain('k-battery');
    document.body.innerHTML = '';
    const gone = mount('liquid-climate-badge', TRV.sonoff, {}, (f) => (f.states[BATTERY].state = 'unavailable'));
    await gone.el.updateComplete;
    expect(value(gone.el)).toBe('19.4°');
    document.body.innerHTML = '';
    const off = mount('liquid-climate-badge', TRV.sonoff, { sensors: { battery: false } }, lowBattery);
    await off.el.updateComplete;
    expect(value(off.el)).toBe('19.4°');
  });

  it('icon only: a low battery asks for attention with a dot', async () => {
    const { el } = mount('liquid-climate-badge', TRV.sonoff, { icon_only: true }, lowBattery);
    await el.updateComplete;
    expect($(el, '.dot')).not.toBeNull();
    expect(emptyElements(el.shadowRoot!)).toEqual([]);
  });

  it('the window contact of the device pauses the badge', async () => {
    const { el } = mount('liquid-climate-badge', TRV.sonoff, {}, (f) => (f.states[WINDOW].state = 'on'));
    await el.updateComplete;
    expect(value(el)).toBe('Paused');
    expect(kind(el)).toContain('k-paused');
  });

  it('Paused wins over a low battery', async () => {
    const { el } = mount('liquid-climate-badge', TRV.sonoff, {}, (f) => {
      f.states[WINDOW].state = 'on';
      lowBattery(f);
    });
    await el.updateComplete;
    expect(value(el)).toBe('Paused');
  });

  it('an explicit pause_entity wins: off ignores an open window, on pauses without one', async () => {
    const closed = mount('liquid-climate-badge', TRV.sonoff, { pause_entity: 'input_boolean.window' }, (f) => (f.states[WINDOW].state = 'on'));
    await closed.el.updateComplete;
    expect(value(closed.el)).toBe('19.4°');
    document.body.innerHTML = '';
    const open = mount('liquid-climate-badge', TRV.sonoff, { pause_entity: 'input_boolean.window' }, (f) => (f.states['input_boolean.window'].state = 'on'));
    await open.el.updateComplete;
    expect(value(open.el)).toBe('Paused');
  });

  it('sensors.window: false, or an explicit entity, overrides the detected contact', async () => {
    const off = mount('liquid-climate-badge', TRV.sonoff, { sensors: { window: false } }, (f) => (f.states[WINDOW].state = 'on'));
    await off.el.updateComplete;
    expect(value(off.el)).toBe('19.4°');
    document.body.innerHTML = '';
    const set = mount('liquid-climate-badge', TRV.sonoff, { sensors: { window: 'input_boolean.window' } }, (f) => (f.states['input_boolean.window'].state = 'on'));
    await set.el.updateComplete;
    expect(value(set.el)).toBe('Paused');
  });

  it('two window contacts settle nothing', async () => {
    const { el } = mount('liquid-climate-badge', TRV.sonoff, {}, (f) => {
      f.entities['binary_sensor.trv_sonoff_door'] = { entity_id: 'binary_sensor.trv_sonoff_door', platform: 'mqtt', device_id: 'dev_trv_sonoff', translation_key: null };
      f.states['binary_sensor.trv_sonoff_door'] = { entity_id: 'binary_sensor.trv_sonoff_door', state: 'on', attributes: { device_class: 'window' } };
      f.states[WINDOW].state = 'on';
    });
    await el.updateComplete;
    expect(value(el)).toBe('19.4°');
  });
});

describe('cluster: radiator valves', () => {
  const valve = { sensors: { valve: VALVE } };
  const rooms = [{ entity: TRV.sonoff, ...valve }, TRV.generic, TRV.better, TRV.genericBlind];
  const foot = (c: AnyEl, i = 0) => text($$(c, '.room .foot')[i]);

  it('renders the valve, thermostat and blind units without an empty element', async () => {
    const { el } = mount('liquid-climate-cluster', '', { entities: rooms });
    await el.updateComplete;
    expect($$(el, '.room')).toHaveLength(4);
    expect(emptyElements(el.shadowRoot!)).toEqual([]);
  });

  it('idle versus heating in the footer, with the valve opening when it resolves', async () => {
    const idle = mount('liquid-climate-cluster', '', { entities: rooms });
    await idle.el.updateComplete;
    expect(foot(idle.el)).toBe('Idle, valve 45%');
    expect(foot(idle.el, 1)).toBe('Idle');
    expect(foot(idle.el, 2)).toBe('Heating');
    document.body.innerHTML = '';
    const heating = mount('liquid-climate-cluster', '', { entities: rooms }, (f) => (f.states[TRV.sonoff].attributes.hvac_action = 'heating'));
    await heating.el.updateComplete;
    expect(foot(heating.el)).toBe('Heating, valve 45%');
  });

  it('valve: false hides the opening', async () => {
    const { el } = mount('liquid-climate-cluster', '', { entities: [{ entity: TRV.sonoff, sensors: { valve: false } }] });
    await el.updateComplete;
    expect(foot(el)).toBe('Idle');
  });

  it('a low battery shows in the footer in the warning style, and in the summary', async () => {
    const { el } = mount('liquid-climate-cluster', '', { entities: rooms }, lowBattery);
    await el.updateComplete;
    expect(foot(el)).toBe('Battery low, 12%, Idle, valve 45%');
    expect($$(el, '.room .foot')[0].className).toContain('warn');
    expect(text($(el, '.sum'))).toContain('Battery low: 1');
    expect(emptyElements(el.shadowRoot!)).toEqual([]);
  });

  it('an unavailable battery, or battery: false, shows the usual footer', async () => {
    const gone = mount('liquid-climate-cluster', '', { entities: rooms }, (f) => (f.states[BATTERY].state = 'unavailable'));
    await gone.el.updateComplete;
    expect(foot(gone.el)).toBe('Idle, valve 45%');
    document.body.innerHTML = '';
    const off = mount('liquid-climate-cluster', '', { entities: [{ entity: TRV.sonoff, sensors: { battery: false } }] }, lowBattery);
    await off.el.updateComplete;
    expect(foot(off.el)).toBe('Idle');
  });

  it('the window contact pauses the room, and an explicit pause_entity wins', async () => {
    const win = mount('liquid-climate-cluster', '', { entities: [TRV.sonoff] }, (f) => (f.states[WINDOW].state = 'on'));
    await win.el.updateComplete;
    expect(foot(win.el)).toBe('Paused');
    expect(text($(win.el, '.sum'))).toContain('1 paused');
    document.body.innerHTML = '';
    const closed = mount('liquid-climate-cluster', '', { entities: [{ entity: TRV.sonoff, pause_entity: 'input_boolean.window' }] }, (f) => (f.states[WINDOW].state = 'on'));
    await closed.el.updateComplete;
    expect(foot(closed.el)).toBe('Idle');
    document.body.innerHTML = '';
    const open = mount('liquid-climate-cluster', '', { entities: [{ entity: TRV.sonoff, pause_entity: 'input_boolean.window' }] }, (f) => (f.states['input_boolean.window'].state = 'on'));
    await open.el.updateComplete;
    expect(foot(open.el)).toBe('Paused');
    document.body.innerHTML = '';
    const hidden = mount('liquid-climate-cluster', '', { entities: [{ entity: TRV.sonoff, sensors: { window: false } }] }, (f) => (f.states[WINDOW].state = 'on'));
    await hidden.el.updateComplete;
    expect(foot(hidden.el)).toBe('Idle');
  });

  it('shows no calibration and none of the Daikin figures', async () => {
    const { el } = mount('liquid-climate-cluster', '', { entities: rooms });
    await el.updateComplete;
    expect($(el, '.figs')).toBeNull();
    expect(text(el.shadowRoot as unknown as Element)).not.toMatch(/calibration|cloud|kWh|-0\.4/i);
  });

  it('write_hold: the strip target stays at the sent value for 30 s, and falls back after the default 10 s', async () => {
    const run = async (cfg: Record<string, unknown>) => {
      document.body.innerHTML = '';
      forgetModes();
      const { el, hass, calls } = mount('liquid-climate-cluster', '', { entities: [TRV.sonoff], write_delay: 0, ...cfg });
      await el.updateComplete;
      ($$(el, '.strip button.step')[1] as HTMLButtonElement).click(); // 20.0 -> 20.5
      await vi.advanceTimersByTimeAsync(50);
      expect(calls).toEqual([{ service: 'set_temperature', data: { entity_id: TRV.sonoff, temperature: 20.5 } }]);
      await vi.advanceTimersByTimeAsync(20_000);
      el.hass = withState(hass, TRV.sonoff, 'heat');
      await el.updateComplete;
      return text($(el, '.strip .target .tval'));
    };
    expect(await run({ write_hold: 30 })).toBe('20.5°');
    expect(await run({})).toBe('20.0°');
  });
});

describe('review fixes', () => {
  it('badge: unavailable wins over a low battery', async () => {
    const { el } = mount('liquid-climate-badge', TRV.sonoff, {}, (f) => {
      lowBattery(f);
      f.states[TRV.sonoff].state = 'unavailable';
    });
    await el.updateComplete;
    expect($(el, '.badge')!.className).toContain('k-unavailable');
  });

  it('dial: the battery alert has the warn modifier, not the red alert alone', async () => {
    const low = mount('liquid-climate-card', TRV.sonoff, {}, lowBattery);
    await low.el.updateComplete;
    expect($(low.el, '.alert')!.classList.contains('battery')).toBe(true);
  });
});
