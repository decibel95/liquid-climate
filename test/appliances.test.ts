// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'lit';
import '../src/index';
import { forgetModes } from '../src/cards/shared/writer';
import { getCapabilities, buildView, steppedTarget } from '../src/cards/dial/capabilities';
import { defaultConfig } from '../src/config';
import { ICONS, MODES, climateTwin, entityModeInfo } from '../src/ui/modes';
import { LOCALES } from '../src/i18n';
import { buildTicks, tickInterval } from '../src/ui/geometry';
import { emptyElements } from './empty-elements';
import { APPLIANCE_IDS as ID, allFixtures, appliances, makeHass, mergeFixtures, type Fixture } from './fixtures';
import type { HomeAssistant } from '../src/types';

const color = (id: string) => MODES.find((m) => m.id === id)!.color;
const HEAT = color('heat');
const COOL = color('cool');
const DRY = color('dry');

type AnyEl = HTMLElement & Record<string, any>;
type Call = { domain: string; service: string; data: any };

const fixture = (system: '°C' | '°F', tweak?: (f: Fixture) => void): Fixture => {
  const f = mergeFixtures(allFixtures, appliances(system));
  tweak?.(f);
  return f;
};

function mount(tag: string, cfg: Record<string, unknown>, opts: { system?: '°C' | '°F'; tweak?: (f: Fixture) => void } = {}) {
  const system = opts.system ?? '°C';
  const f = fixture(system, opts.tweak);
  const calls: Call[] = [];
  const hass = makeHass(f, system, (domain, service, data) => void calls.push({ domain, service, data: data as any }));
  hass.localize = () => '';
  const el = document.createElement(tag) as AnyEl;
  el.setConfig({ type: `custom:${tag}`, ...cfg });
  el.hass = hass;
  document.body.append(el);
  return { el, hass, f, calls };
}

const settle = async (el: AnyEl) => {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
    await el.updateComplete;
  }
};
const $ = (el: AnyEl, sel: string) => el.shadowRoot!.querySelector(sel) as HTMLElement | null;
const $$ = (el: AnyEl, sel: string) => [...el.shadowRoot!.querySelectorAll(sel)] as HTMLElement[];
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
// happy-dom misplaces the parts inside the dial svg, so read the values the template is rendered with.
const values = (t: any): unknown[] => (Array.isArray(t) ? t.flatMap(values) : t && typeof t === 'object' && 'values' in t ? (t.values as unknown[]).flatMap(values) : [t]);
const colours = (el: AnyEl) => values(el.render()).filter((x): x is string => typeof x === 'string' && x.startsWith('#'));
/** The dial's steppers, rendered on their own: happy-dom misplaces the parts of the dial template from its svg on. */
const steppers = (card: AnyEl) => {
  const host = document.createElement('div');
  render(card._renderSteps(card._context()), host);
  return [...host.querySelectorAll('button')] as HTMLButtonElement[];
};
const withState = (hass: HomeAssistant, id: string, state: string, attributes: Record<string, unknown> = {}): HomeAssistant => ({
  ...hass,
  states: { ...hass.states, [id]: { ...hass.states[id], state, attributes: { ...hass.states[id].attributes, ...attributes } } },
});

beforeEach(() => {
  vi.useFakeTimers();
  forgetModes();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('capabilities: water heater and humidifier', () => {
  const caps = (f: Fixture, id: string) => getCapabilities(f.states[id], defaultConfig(id));

  it('water heater: setpoint, operation modes without off, away, no fan, swing or presets', () => {
    const c = caps(appliances('°C'), ID.waterHeater);
    expect(c).toMatchObject({ domain: 'water_heater', symbol: '°', min: 43.3, max: 60, step: 1, single: true, range: false, hasOff: true, away: true });
    expect(c.modes).toEqual(['eco', 'electric', 'performance', 'high_demand', 'heat_pump', 'gas']);
    expect([c.fanModes, c.swingModes, c.swingHModes, c.presetModes]).toEqual([[], [], [], []]);
  });

  it('water heater in Fahrenheit: 110 to 140, the entity unit wins over the system', () => {
    const c = caps(appliances('°F'), ID.waterHeater);
    expect(c).toMatchObject({ unit: '°F', min: 110, max: 140, step: 1 });
    const metricSystem = getCapabilities(appliances('°F').states[ID.waterHeater], defaultConfig(ID.waterHeater), { config: { unit_system: { temperature: '°C' } } });
    expect(metricSystem.unit).toBe('°F');
  });

  it('water heater without a step or limits: per-unit defaults', () => {
    const f = appliances('°C');
    const a = f.states[ID.waterHeater].attributes;
    delete a.target_temp_step;
    delete a.min_temp;
    delete a.max_temp;
    expect(caps(f, ID.waterHeater)).toMatchObject({ min: 43, max: 60, step: 0.5 });
    a.temperature_unit = '°F';
    expect(caps(f, ID.waterHeater)).toMatchObject({ min: 110, max: 140, step: 1 });
  });

  it('water heater with supported_features 0: no setpoint, no modes, no away', () => {
    const f = appliances('°C');
    f.states[ID.waterHeater].attributes.supported_features = 0;
    const c = caps(f, ID.waterHeater);
    expect(c).toMatchObject({ single: false, modes: [], away: false });
    expect(buildView(f.states[ID.waterHeater], c, {}).hasSetpoint).toBe(false);
  });

  it('humidifier: percent, step from target_humidity_step, no modes without the MODES flag', () => {
    const c = caps(appliances(), ID.humidifier);
    expect(c).toMatchObject({ domain: 'humidifier', unit: '%', symbol: '%', min: 0, max: 100, step: 5, modes: [], hasOff: true, away: false });
    expect(caps(appliances(), ID.dehumidifier).step).toBe(1);
  });

  it('humidifier: available_modes need the MODES flag', () => {
    expect(caps(appliances(), ID.hygrostat).modes).toEqual(['home', 'eco']);
    const f = appliances();
    f.states[ID.hygrostat].attributes.supported_features = 0;
    expect(caps(f, ID.hygrostat).modes).toEqual([]);
    const g = appliances();
    delete g.states[ID.hygrostat].attributes.available_modes;
    expect(caps(g, ID.hygrostat).modes).toEqual([]);
  });

  it('humidifier view: the setpoint is humidity, the mode is separate from on and off', () => {
    const f = appliances();
    const s = f.states[ID.hygrostat];
    const c = caps(f, ID.hygrostat);
    expect(buildView(s, c, {})).toMatchObject({ mode: 'on', target: 50, hasSetpoint: true, subMode: 'home' });
    expect(buildView(s, c, { humidity: 55, mode: 'eco' })).toMatchObject({ target: 55, subMode: 'eco' });
    expect(buildView(s, c, { hvac_mode: 'off' }).hasSetpoint).toBe(false);
  });

  it.each([
    ['humidifier', 0, 100, 5, 21, [0, 25, 50, 75, 100], [0, 50, 100]],
    ['humidifier', 30, 80, 2, 26, [30, 40, 50, 60, 70, 80], [40, 60, 80]],
    ['water_heater', 43, 60, 1, 18, [45, 50, 55, 60], [50, 60]],
    ['water_heater', 110, 140, 1, 31, [110, 115, 120, 125, 130, 135, 140], [110, 120, 130, 140]],
  ])('%s scale %i to %i: interval %i, %i ticks', (domain, min, max, k, n, majors, labels) => {
    expect(tickInterval(domain, min, max)).toBe(k);
    const ticks = buildTicks(min, max, k);
    expect(ticks).toHaveLength(n);
    expect(ticks.filter((t) => t.major).map((t) => t.value)).toEqual(majors);
    expect(ticks.filter((t) => t.label).map((t) => t.value)).toEqual(labels);
  });

  it('climate always ticks every unit, whatever the span', () => {
    expect(tickInterval('climate', 0, 100)).toBe(1);
    expect(buildTicks(0, 100)).toHaveLength(101);
  });
});

describe('setpoint grid', () => {
  /** One press from `target` on an entity with these limits and step. */
  const press = (id: string, attrs: Record<string, unknown>, target: number, dir: 1 | -1) => {
    const s = { entity_id: id, state: id.startsWith('climate.') ? 'heat' : 'eco', attributes: { supported_features: 1, temperature: target, ...attrs } };
    const caps = getCapabilities(s, defaultConfig(id));
    return steppedTarget(buildView(s, caps, {}), caps, dir);
  };
  const climate = (min: number, max: number, step: number) => ({ hvac_modes: ['off', 'heat'], min_temp: min, max_temp: max, target_temp_step: step });

  it('climate steps from min_temp, as before', () => {
    expect(press('climate.a', climate(16.5, 30, 1), 16.5, 1)).toBe(17.5);
    expect(press('climate.a', climate(16.5, 30, 1), 17.5, -1)).toBe(16.5);
    expect(press('climate.a', climate(44.6, 90, 1), 44.6, 1)).toBe(45.6);
    // An off-grid target on a grid from 10: up lands on 22, down on 20.
    expect(press('climate.a', climate(10, 30, 1), 20.5, 1)).toBe(22);
    expect(press('climate.a', climate(10, 30, 1), 20.5, -1)).toBe(20);
    expect(press('climate.a', climate(7.2, 30, 0.5), 21.2, 1)).toBe(21.7);
  });

  it('a water heater steps on multiples of its step', () => {
    const wh = { operation_list: ['eco'], min_temp: 43.3, max_temp: 60, target_temp_step: 1, supported_features: 3 };
    expect(press(ID.waterHeater, wh, 45, 1)).toBe(46);
    expect(press(ID.waterHeater, wh, 45, -1)).toBe(44);
    expect(press(ID.waterHeater, wh, 44, -1)).toBe(43.3);
  });

  it('a water heater reads target_temperature_step when target_temp_step is missing', () => {
    const f = appliances();
    const a = f.states[ID.waterHeater].attributes;
    delete a.target_temp_step;
    a.target_temperature_step = 2;
    expect(getCapabilities(f.states[ID.waterHeater], defaultConfig(ID.waterHeater)).step).toBe(2);
  });
});

describe('dial: water heater', () => {
  it.each([ID.waterHeater, ID.waterHeaterCelsius])('%s renders without an empty element and without a fan ring', async (id) => {
    const { el } = mount('liquid-climate-card', { entity: id });
    await settle(el);
    expect(emptyElements(el.shadowRoot!)).toEqual([]);
    expect($$(el, '.fan-label')).toHaveLength(0);
  });

  it('reads the operation mode as a state with the target, and shows the modes without off', async () => {
    const { el } = mount('liquid-climate-card', { entity: ID.waterHeaterCelsius });
    await settle(el);
    expect(text($(el, '.sub'))).toBe('Eco, target 45°');
    expect($$(el, '.modes button').map(text)).toEqual(['Eco', 'Elec', 'Perf', 'High', 'Pump', 'Gas']);
    expect($(el, '.modes button[aria-pressed=true]')?.textContent).toContain('Eco');
    expect(colours(el)).toContain(HEAT);
  });

  it('six operation modes: a distinct line icon each and a short label that fits, the full name in aria-label only', async () => {
    const { el } = mount('liquid-climate-card', { entity: ID.waterHeater });
    await settle(el);
    const buttons = $$(el, '.modes button');
    expect(buttons.map((b) => text(b.querySelector('span')))).toEqual(['Eco', 'Elec', 'Perf', 'High', 'Pump', 'Gas']);
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Eco', 'Electric', 'Performance', 'High demand', 'Heat pump', 'Gas']);
    expect(buttons.every((b) => !b.hasAttribute('title'))).toBe(true);
    const icons = buttons.map((b) => b.querySelector('path')!.getAttribute('d'));
    expect(new Set(icons).size).toBe(6);
    const known = new Set<string>(Object.values(ICONS));
    expect(buttons.every((b) => known.has(b.querySelector('path')!.getAttribute('d')!))).toBe(true);
  });

  it.each(['en', 'nl', 'de', 'fr', 'es', 'it'])('%s: every short water heater label has at most 6 letters', (lang) => {
    const L = LOCALES[lang];
    const keys = Object.keys(L).filter((k) => k.startsWith('waterHeaterModeShort.'));
    expect(keys).toHaveLength(6);
    for (const k of keys) expect(L[k].length, `${lang} ${k}`).toBeLessThanOrEqual(6);
  });

  it('the short labels are real shortenings', () => {
    const short = (lang: string) => ['eco', 'electric', 'performance', 'high_demand', 'heat_pump', 'gas'].map((m) => LOCALES[lang][`waterHeaterModeShort.${m}`]);
    expect(short('en')).toEqual(['Eco', 'Elec', 'Perf', 'High', 'Pump', 'Gas']);
    expect(short('nl')).toEqual(['Eco', 'Elektr', 'Prest', 'Hoog', 'Pomp', 'Gas']);
    expect(short('de')).toEqual(['Eco', 'Strom', 'Leist', 'Hoch', 'Pumpe', 'Gas']);
    expect(short('fr')).toEqual(['Éco', 'Élec', 'Perf', 'Forte', 'PAC', 'Gaz']);
    expect(short('es')).toEqual(['Eco', 'Eléc', 'Rend', 'Alta', 'Bomba', 'Gas']);
    expect(short('it')).toEqual(['Eco', 'Elett', 'Prest', 'Alta', 'Pompa', 'Gas']);
  });

  it('humidifier modes get distinct icons', async () => {
    const { el } = mount('liquid-climate-card', { entity: ID.hygrostat });
    await settle(el);
    const icons = $$(el, '.modes button path').map((p) => p.getAttribute('d'));
    expect(icons).toHaveLength(2);
    expect(icons[0]).not.toBe(icons[1]);
  });

  it('Fahrenheit: the scale and the target in Fahrenheit', async () => {
    const { el } = mount('liquid-climate-card', { entity: ID.waterHeater }, { system: '°F' });
    await settle(el);
    expect(text($(el, '.sub'))).toBe('Eco, target 119°');
    const dial = $(el, 'svg.dial')!;
    expect([dial.getAttribute('aria-valuemin'), dial.getAttribute('aria-valuemax'), dial.getAttribute('aria-valuetext')]).toEqual(['110', '140', '119 °F']);
  });

  it('away mode is a chip that toggles set_away_mode', async () => {
    const { el, calls } = mount('liquid-climate-card', { entity: ID.waterHeater });
    await settle(el);
    const chip = $(el, '.chips button')!;
    expect(chip.getAttribute('aria-label')).toBe('Away mode: Off');
    chip.click();
    await vi.advanceTimersByTimeAsync(1600);
    expect(calls).toEqual([{ domain: 'water_heater', service: 'set_away_mode', data: { entity_id: ID.waterHeater, away_mode: true } }]);
  });

  it('no away chip without the AWAY_MODE flag', async () => {
    const { el } = mount('liquid-climate-card', { entity: ID.waterHeater }, { tweak: (f) => (f.states[ID.waterHeater].attributes.supported_features = 1 | 2 | 8) });
    await settle(el);
    expect($(el, '.chips')).toBeNull();
  });

  it('a mode press sends set_operation_mode; setpoint presses batch into one set_temperature', async () => {
    const { el, calls } = mount('liquid-climate-card', { entity: ID.waterHeaterCelsius });
    await settle(el);
    $$(el, '.modes button')[2].click();
    await settle(el);
    steppers(el)[1].click();
    await settle(el);
    steppers(el)[1].click();
    await settle(el);
    steppers(el)[1].click();
    await vi.advanceTimersByTimeAsync(1600);
    expect(calls).toEqual([
      { domain: 'water_heater', service: 'set_operation_mode', data: { entity_id: ID.waterHeaterCelsius, operation_mode: 'performance' } },
      { domain: 'water_heater', service: 'set_temperature', data: { entity_id: ID.waterHeaterCelsius, temperature: 48 } },
    ]);
  });

  it('power uses turn_off with ON_OFF, and the operation mode off without it', async () => {
    const a = mount('liquid-climate-card', { entity: ID.waterHeater });
    await settle(a.el);
    $(a.el, '.power')!.click();
    await vi.advanceTimersByTimeAsync(1600);
    expect(a.calls).toEqual([{ domain: 'water_heater', service: 'turn_off', data: { entity_id: ID.waterHeater } }]);
    document.body.innerHTML = '';
    const b = mount('liquid-climate-card', { entity: ID.waterHeater }, { tweak: (f) => (f.states[ID.waterHeater].attributes.supported_features = 7) });
    await settle(b.el);
    $(b.el, '.power')!.click();
    await vi.advanceTimersByTimeAsync(1600);
    expect(b.calls).toEqual([{ domain: 'water_heater', service: 'set_operation_mode', data: { entity_id: ID.waterHeater, operation_mode: 'off' } }]);
  });

  it('turn_on without operation modes: the state the heater reports replaces "On" at once', async () => {
    const { el, hass, calls } = mount('liquid-climate-card', { entity: ID.waterHeater }, {
      tweak: (f) => {
        const s = f.states[ID.waterHeater];
        s.state = 'off';
        s.attributes.supported_features = 1 | 8;
        delete s.attributes.operation_list;
      },
    });
    await settle(el);
    $(el, '.power')!.click();
    await vi.advanceTimersByTimeAsync(1600);
    expect(calls.map((c) => c.service)).toEqual(['turn_on']);
    el.hass = withState(hass, ID.waterHeater, 'heat_pump');
    await settle(el);
    expect(text($(el, '.sub'))).toBe('Heat pump, target 48°');
  });

  it('turn_off answered with another state than off: that state shows at once', async () => {
    const { el, hass } = mount('liquid-climate-card', { entity: ID.waterHeater }, { tweak: (f) => (f.states[ID.waterHeater].attributes.operation_list = ['eco', 'gas']) });
    await settle(el);
    $(el, '.power')!.click();
    await vi.advanceTimersByTimeAsync(1600);
    expect(text($(el, '.sub'))).toBe('Off');
    el.hass = withState(hass, ID.waterHeater, 'standby');
    await settle(el);
    expect(text($(el, '.sub'))).toBe('Standby, target 48°');
  });

  it('power on from off with ON_OFF: turn_on, then the mode', async () => {
    const { el, calls } = mount('liquid-climate-card', { entity: ID.waterHeater }, { tweak: (f) => (f.states[ID.waterHeater].state = 'off') });
    await settle(el);
    expect(text($(el, '.sub'))).toBe('Off');
    $(el, '.power')!.click();
    await vi.advanceTimersByTimeAsync(1600);
    expect(calls.map((c) => `${c.domain}.${c.service}`)).toEqual(['water_heater.turn_on', 'water_heater.set_operation_mode']);
    expect(calls[1].data.operation_mode).toBe('eco');
  });
});

describe('dial: humidifier', () => {
  it.each([ID.humidifier, ID.dehumidifier, ID.hygrostat])('%s renders without an empty element and without a fan ring', async (id) => {
    const { el } = mount('liquid-climate-card', { entity: id });
    await settle(el);
    expect(emptyElements(el.shadowRoot!)).toEqual([]);
    expect($$(el, '.fan-label')).toHaveLength(0);
  });

  it('the action drives the status, the target and current humidity are in percent', async () => {
    const { el } = mount('liquid-climate-card', { entity: ID.humidifier });
    await settle(el);
    expect(text($(el, '.sub'))).toBe('Humidifying to 65%');
    const v = values(el.render());
    expect(v).toContain('Now 45%');
    expect(v).toContain('65');
    expect(v).toContain('%');
    expect($(el, '.modes')).toBeNull();
    // The humidity is the main figure: no extra humidity tile below.
    expect($(el, '.info')).toBeNull();
  });

  it('a humidity sensor override feeds the current figure', async () => {
    const { el } = mount('liquid-climate-card', { entity: ID.humidifier, temperature_sensor: 'sensor.bath_humidity' }, {
      tweak: (f) => (f.states['sensor.bath_humidity'] = { entity_id: 'sensor.bath_humidity', state: '52', attributes: { device_class: 'humidity' } }),
    });
    await settle(el);
    expect(values(el.render())).toContain('Now 52%');
  });

  it('a water heater never auto-shows a room humidity figure', async () => {
    const { el } = mount('liquid-climate-card', { entity: ID.waterHeater }, { tweak: (f) => (f.states[ID.waterHeater].attributes.current_humidity = 40) });
    await settle(el);
    expect($(el, '.info')).toBeNull();
  });

  it('colour follows device_class: cool for a humidifier, dry for a dehumidifier', async () => {
    const hum = mount('liquid-climate-card', { entity: ID.humidifier });
    await settle(hum.el);
    expect(colours(hum.el)).toContain(COOL);
    expect(colours(hum.el)).not.toContain(DRY);
    document.body.innerHTML = '';
    const de = mount('liquid-climate-card', { entity: ID.dehumidifier });
    await settle(de.el);
    expect(text($(de.el, '.sub'))).toBe('Drying to 54%');
    expect(colours(de.el)).toContain(DRY);
    expect(colours(de.el)).not.toContain(COOL);
  });

  it('the dial wires the domain into the tick interval', async () => {
    const dial = async (entity: string, tweak?: (f: Fixture) => void) => {
      document.body.replaceChildren();
      const { el } = mount('liquid-climate-card', { entity }, { tweak });
      await settle(el);
      const strs = values(el.render()).filter((x): x is string => typeof x === 'string');
      const ticks = strs.filter((x) => /^M [\d.]+ [\d.]+ L /.test(x)).reduce((n, d) => n + d.split(' L ').length - 1, 0);
      const labels = $$(el, '.tick-label').map(text);
      return { ticks, labels: labels.length ? labels : strs.filter((x) => /^\d+$/.test(x)) };
    };
    const humRange = (min: number, max: number) => (f: Fixture) => {
      f.states[ID.humidifier].attributes.min_humidity = min;
      f.states[ID.humidifier].attributes.max_humidity = max;
    };
    const climateId = Object.keys(allFixtures.states).find(
      (id) => id.startsWith('climate.') && allFixtures.states[id].attributes.min_temp === 10 && allFixtures.states[id].attributes.max_temp === 30,
    )!;

    const hum = await dial(ID.humidifier);
    expect(hum.ticks).toBe(21);
    expect(hum.labels).toEqual(['0', '50', '100']);
    const climate = await dial(climateId);
    expect(climate.ticks).toBe(21);
    expect(climate.labels).toEqual(['10', '20', '30']);
    expect((await dial(ID.humidifier, humRange(30, 80))).ticks).toBe(26);
  });

  it('without device_class it is a humidifier, and without an action it names its mode', async () => {
    const { el } = mount('liquid-climate-card', { entity: ID.hygrostat });
    await settle(el);
    expect(text($(el, '.sub'))).toBe('Home, target 50%');
    expect(colours(el)).toContain(COOL);
    expect($$(el, '.modes button').map(text)).toEqual(['Home', 'Eco']);
    expect($(el, '.modes button[aria-pressed=true]')?.textContent).toContain('Home');
  });

  it('steps batch into one set_humidity in the entity step', async () => {
    const { el, calls } = mount('liquid-climate-card', { entity: ID.humidifier });
    await settle(el);
    steppers(el)[1].click();
    await settle(el);
    steppers(el)[1].click();
    await vi.advanceTimersByTimeAsync(1600);
    expect(calls).toEqual([{ domain: 'humidifier', service: 'set_humidity', data: { entity_id: ID.humidifier, humidity: 75 } }]);
    expect(steppers(el)[0].getAttribute('aria-label')).toBe('Lower target humidity');
  });

  it('a mode press sends set_mode; while off it turns on first', async () => {
    const on = mount('liquid-climate-card', { entity: ID.hygrostat });
    await settle(on.el);
    $$(on.el, '.modes button')[1].click();
    await vi.advanceTimersByTimeAsync(1600);
    expect(on.calls).toEqual([{ domain: 'humidifier', service: 'set_mode', data: { entity_id: ID.hygrostat, mode: 'eco' } }]);
    document.body.innerHTML = '';
    const off = mount('liquid-climate-card', { entity: ID.hygrostat }, { tweak: (f) => (f.states[ID.hygrostat].state = 'off') });
    await settle(off.el);
    expect($(off.el, '.modes button[aria-pressed=true]')).toBeNull();
    $$(off.el, '.modes button')[1].click();
    await vi.advanceTimersByTimeAsync(1600);
    expect(off.calls.map((c) => c.service)).toEqual(['turn_on', 'set_mode']);
  });

  it('a pending mode replaces the action on the status line', async () => {
    const { el } = mount('liquid-climate-card', { entity: ID.hygrostat }, { tweak: (f) => (f.states[ID.hygrostat].attributes.action = 'humidifying') });
    await settle(el);
    expect(text($(el, '.sub'))).toBe('Humidifying to 50%');
    $$(el, '.modes button')[1].click();
    await settle(el);
    expect(text($(el, '.sub'))).toBe('Eco, target 50%');
  });

  it('power toggles turn_off and turn_on', async () => {
    const { el, hass, calls } = mount('liquid-climate-card', { entity: ID.dehumidifier });
    await settle(el);
    $(el, '.power')!.click();
    await vi.advanceTimersByTimeAsync(1600);
    el.hass = withState(hass, ID.dehumidifier, 'off', { action: 'off' });
    await settle(el);
    expect(text($(el, '.sub'))).toBe('Off');
    $(el, '.power')!.click();
    await vi.advanceTimersByTimeAsync(1600);
    expect(calls.map((c) => `${c.domain}.${c.service}`)).toEqual(['humidifier.turn_off', 'humidifier.turn_on']);
  });
});

const ALL = Object.values(ID);

describe('unavailable and unknown on every card', () => {
  const cards: [string, (id: string) => Record<string, unknown>][] = [
    ['liquid-climate-card', (id) => ({ entity: id })],
    ['liquid-climate-tile', (id) => ({ entity: id })],
    ['liquid-climate-badge', (id) => ({ entity: id })],
    ['liquid-climate-cluster', (id) => ({ entities: [id] })],
  ];
  for (const state of ['unavailable', 'unknown']) {
    for (const [tag, cfg] of cards) {
      it.each(ALL)(`${tag}: %s ${state}`, async (id) => {
        const { el } = mount(tag, cfg(id), { tweak: (f) => (f.states[id].state = state) });
        await settle(el);
        expect(emptyElements(el.shadowRoot!)).toEqual([]);
        const all = text(el.shadowRoot as unknown as Element);
        if (tag === 'liquid-climate-badge') expect(text($(el, '.v'))).toBe('--');
        else expect(all).toContain('Unavailable');
      });
    }
  }
});

describe('tile', () => {
  it('water heater: steps in its own step, sends water_heater.set_temperature', async () => {
    const { el, calls } = mount('liquid-climate-tile', { entity: ID.waterHeaterCelsius });
    await settle(el);
    expect(text($(el, '.target'))).toBe('45°');
    expect($(el, 'article')!.getAttribute('aria-label')).toBe('Demo Water Heater Celsius water heater');
    $$(el, 'button.step')[1].click();
    await vi.advanceTimersByTimeAsync(1600);
    expect(calls).toEqual([{ domain: 'water_heater', service: 'set_temperature', data: { entity_id: ID.waterHeaterCelsius, temperature: 46 } }]);
  });

  it('humidifier: percent target and figure, humidity steps', async () => {
    const { el, calls } = mount('liquid-climate-tile', { entity: ID.humidifier });
    await settle(el);
    expect(text($(el, '.target'))).toBe('65%');
    expect(text($(el, '.sub'))).toBe('Humidifying, 45% now');
    $$(el, 'button.step')[0].click();
    await vi.advanceTimersByTimeAsync(1600);
    expect(calls).toEqual([{ domain: 'humidifier', service: 'set_humidity', data: { entity_id: ID.humidifier, humidity: 60 } }]);
  });

  it('dehumidifier: its own name in the label, power turns it off', async () => {
    const { el, calls } = mount('liquid-climate-tile', { entity: ID.dehumidifier });
    await settle(el);
    expect($(el, 'article')!.getAttribute('aria-label')).toBe('Dehumidifier dehumidifier');
    $(el, 'button.power')!.click();
    await vi.advanceTimersByTimeAsync(1600);
    expect(calls).toEqual([{ domain: 'humidifier', service: 'turn_off', data: { entity_id: ID.dehumidifier } }]);
  });

  it('the sheet opens the dial for the same entity', async () => {
    const { el } = mount('liquid-climate-tile', { entity: ID.hygrostat });
    await settle(el);
    ($(el, 'button.body') as HTMLButtonElement).click();
    await settle(el);
    const sheet = $(el, 'liquid-climate-sheet') as AnyEl;
    await settle(sheet);
    const dial = sheet.shadowRoot!.querySelector('liquid-climate-card') as AnyEl;
    expect(dial).toBeTruthy();
    await settle(dial);
    expect(text(dial.shadowRoot!.querySelector('.sub'))).toBe('Home, target 50%');
  });
});

describe('badge', () => {
  const badge = async (id: string, tweak?: (f: Fixture) => void) => {
    const { el } = mount('liquid-climate-badge', { entity: id }, { tweak });
    await settle(el);
    return text($(el, '.v'));
  };
  it('shows the current figure with its unit', async () => {
    expect(await badge(ID.humidifier)).toBe('45%');
    expect(await badge(ID.dehumidifier)).toBe('59.4%');
    expect(await badge(ID.waterHeater, (f) => (f.states[ID.waterHeater].attributes.current_temperature = 52.5))).toBe('52.5°');
  });
  it('without a current figure it names the mode', async () => {
    expect(await badge(ID.waterHeater)).toBe('Eco');
    expect(await badge(ID.hygrostat)).toBe('Home');
  });
  it('off is Off', async () => {
    expect(await badge(ID.humidifier, (f) => (f.states[ID.humidifier].state = 'off'))).toBe('Off');
  });
});

describe('cluster', () => {
  it('the automatic modes pick up climate only by default', async () => {
    const { el } = mount('liquid-climate-cluster', {});
    await settle(el);
    const names = $$(el, 'button.room .rname').map(text);
    expect(names).not.toContain('Humidifier');
    expect(names).not.toContain('Demo Water Heater');
  });

  it('domains opts water heaters and humidifiers in', async () => {
    const { el } = mount('liquid-climate-cluster', { domains: ['humidifier', 'water_heater'] });
    await settle(el);
    const names = $$(el, 'button.room .rname').map(text).sort();
    expect(names).toEqual(['Dehumidifier', 'Demo Water Heater', 'Demo Water Heater Celsius', 'Humidifier', 'Hygrostat']);
  });

  it('a list takes any supported entity; the strip uses the domain step and services', async () => {
    const { el, calls } = mount('liquid-climate-cluster', { entities: [ID.hygrostat, ID.waterHeaterCelsius] });
    await settle(el);
    expect(text($(el, '.strip .target .tval'))).toBe('50%');
    expect($$(el, '.strip button.mode').map((b) => b.getAttribute('aria-label'))).toEqual(['Home', 'Eco']);
    $$(el, '.strip button.mode')[1].click();
    $$(el, '.strip button.step')[1].click();
    await vi.advanceTimersByTimeAsync(1600);
    expect(calls).toEqual([
      { domain: 'humidifier', service: 'set_mode', data: { entity_id: ID.hygrostat, mode: 'eco' } },
      { domain: 'humidifier', service: 'set_humidity', data: { entity_id: ID.hygrostat, humidity: 51 } },
    ]);
    ($$(el, 'button.room')[1] as HTMLButtonElement).click();
    await settle(el);
    expect(text($(el, '.strip .target .tval'))).toBe('45°');
  });

  it('the strip status follows a pending humidifier mode', async () => {
    const { el } = mount('liquid-climate-cluster', { entities: [ID.hygrostat] });
    await settle(el);
    expect(text($(el, '.strip .sverb'))).toBe('Home');
    $$(el, '.strip button.mode')[1].click();
    await settle(el);
    expect(text($(el, '.strip .sverb'))).toBe('Eco');
  });

  it('a room shows the current humidity in percent', async () => {
    const { el } = mount('liquid-climate-cluster', { entities: [ID.humidifier] });
    await settle(el);
    expect(text($(el, 'button.room .inside'))).toBe('Now 45%');
    expect(text($(el, 'button.room .tline'))).toBe('65%');
  });

  it('default title: Climate for climate only, Comfort once water heaters or humidifiers can be rooms, a set title wins', async () => {
    const title = async (cfg: Record<string, unknown>) => {
      const { el } = mount('liquid-climate-cluster', cfg);
      await settle(el);
      const out = text($(el, 'h2'));
      document.body.innerHTML = '';
      return out;
    };
    expect(await title({})).toBe('Climate');
    expect(await title({ entities: ['climate.keuken_airco'] })).toBe('Climate');
    expect(await title({ domains: ['climate', 'humidifier'] })).toBe('Comfort');
    expect(await title({ entities: ['climate.keuken_airco', ID.waterHeater] })).toBe('Comfort');
    expect(await title({ domains: ['water_heater'], title: 'Home' })).toBe('Home');
  });

  it('a list with a sensor still throws', () => {
    const card = document.createElement('liquid-climate-cluster') as AnyEl;
    expect(() => card.setConfig({ entities: ['sensor.x'] })).toThrow(/not a climate entity/);
  });
});

describe('setConfig', () => {
  it.each(['liquid-climate-card', 'liquid-climate-tile', 'liquid-climate-badge'])('%s accepts climate, water_heater and humidifier, rejects others', (tag) => {
    const el = document.createElement(tag) as AnyEl;
    for (const entity of ['climate.x', ID.waterHeater, ID.humidifier]) expect(() => el.setConfig({ entity })).not.toThrow();
    expect(() => el.setConfig({ entity: 'sensor.x' })).toThrow(/climate entity/);
  });

  it('uses the climate mode colours and only line icons', () => {
    const st = (entity_id: string, device_class?: string) => ({ entity_id, state: 'on', attributes: { device_class } }) as any;
    expect(entityModeInfo(st('water_heater.x'), 'eco').color).toBe(HEAT);
    expect(entityModeInfo(st('humidifier.x'), 'normal').color).toBe(COOL);
    expect(entityModeInfo(st('humidifier.x', 'dehumidifier'), 'normal').color).toBe(DRY);
    const icons = new Set<string>(Object.values(ICONS));
    const modes = ['eco', 'electric', 'performance', 'high_demand', 'heat_pump', 'gas', 'normal', 'away', 'boost', 'comfort', 'home', 'sleep', 'auto', 'baby', 'unknown'];
    for (const id of ['water_heater.x', 'humidifier.x'])
      for (const m of modes) expect(icons.has(entityModeInfo(st(id), m).icon)).toBe(true);
  });

  it('the climate twin: colour and particle class for water heater, humidifier and dehumidifier', async () => {
    const st = (entity_id: string, device_class?: string) => ({ entity_id, state: 'on', attributes: { device_class } }) as any;
    expect(climateTwin(st('water_heater.x'), 'eco')).toBe('heat');
    expect(climateTwin(st('humidifier.x'), 'normal')).toBe('cool');
    expect(climateTwin(st('humidifier.x', 'dehumidifier'), 'normal')).toBe('dry');
    expect(climateTwin(st('climate.x'), 'heat_cool')).toBe('heat_cool');
    for (const id of ['water_heater.x', 'humidifier.x']) expect(climateTwin(st(id), 'off')).toBe('off');
    for (const [entity, twin] of [[ID.waterHeater, 'heat'], [ID.humidifier, 'cool'], [ID.dehumidifier, 'dry']] as const) {
      document.body.innerHTML = '';
      const { el } = mount('liquid-climate-card', { entity });
      await settle(el);
      const cls = $$(el, '.parts .pt').map((p) => p.className);
      expect(cls.length).toBeGreaterThan(0);
      expect(cls.every((c) => c.includes(`pt-${twin}`))).toBe(true);
    }
  });

  it('a water heater flickers on the tile like climate heat, unless off or motion is minimal', async () => {
    const flick = async (cfg: Record<string, unknown>, tweak?: (f: Fixture) => void) => {
      document.body.innerHTML = '';
      const { el } = mount('liquid-climate-tile', cfg, { tweak });
      await settle(el);
      return $(el, 'button.power svg')!.getAttribute('class')!.includes('flick');
    };
    expect(await flick({ entity: ID.waterHeater })).toBe(true);
    expect(await flick({ entity: ID.waterHeater, look: { motion: 'minimal' } })).toBe(false);
    expect(await flick({ entity: ID.waterHeater }, (f) => (f.states[ID.waterHeater].state = 'off'))).toBe(false);
    expect(await flick({ entity: ID.humidifier })).toBe(false);
  });

  it('mode buttons carry no title in any domain', async () => {
    for (const entity of [ID.waterHeater, ID.hygrostat, ID.humidifier, ID.dehumidifier]) {
      document.body.innerHTML = '';
      const { el } = mount('liquid-climate-card', { entity });
      await settle(el);
      const buttons = $$(el, '.modes button');
      if (entity === ID.waterHeater || entity === ID.hygrostat) expect(buttons.length).toBeGreaterThan(0);
      expect(buttons.every((b) => !b.hasAttribute('title'))).toBe(true);
    }
    document.body.innerHTML = '';
    const { el } = mount('liquid-climate-cluster', { domains: ['water_heater'] });
    await settle(el);
    const modeButtons = $$(el, '.modes button');
    expect(modeButtons.length).toBeGreaterThan(0);
    expect(modeButtons.every((b) => !b.hasAttribute('title'))).toBe(true);
  });
});
