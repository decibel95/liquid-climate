// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/index';
import { LOCALES } from '../src/i18n';
import { forgetModes } from '../src/cards/shared/writer';
import { $, $$, CARDS, configFor, demoHass, mount, text, type AnyEl } from './demo-harness';
import { emptyElements } from './empty-elements';
import { DEMO } from './fixtures/demo-integration';

const { heatpump: HP, hvac: HV, ecobee: EC } = DEMO;
const ALL = [HP, HV, EC];
const SYSTEMS = ['°C', '°F'] as const;

let errors: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  forgetModes();
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a.join(' ')));
  vi.spyOn(console, 'warn').mockImplementation((...a) => void errors.push(a.join(' ')));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('every card renders every demo entity without errors or empty elements', () => {
  for (const system of SYSTEMS) {
    describe.each(CARDS)(`${system}: %s`, (_name, tag) => {
      it.each(ALL)('%s', async (id) => {
        const { hass } = demoHass({ system });
        const card = await mount(tag, configFor(tag, id), hass);
        expect(errors).toEqual([]);
        expect(card.shadowRoot!.textContent).not.toMatch(/not found|Unavailable|undefined|NaN|null/i);
        expect(emptyElements(card.shadowRoot!)).toEqual([]);
        // The name comes from the entity, which the demo names after its device.
        expect(text(card.shadowRoot as unknown as Element)).toContain(hass.states[id].attributes.friendly_name);
      });
    });
  }

  it('also with the Daikin units in the same install', async () => {
    const { hass } = demoHass({ withDaikin: true });
    for (const [, tag] of CARDS) {
      for (const id of ALL) {
        const card = await mount(tag, configFor(tag, id), hass);
        expect(emptyElements(card.shadowRoot!), `${tag} ${id}`).toEqual([]);
      }
    }
    expect(errors).toEqual([]);
  });
});

describe('dial: only the controls the entity supports', () => {
  const dial = async (id: string, system: (typeof SYSTEMS)[number] = '°C', cfg: Record<string, unknown> = {}) => {
    const { hass } = demoHass({ system });
    return mount('liquid-climate-card', { entity: id, ...cfg }, hass);
  };
  const modes = (c: AnyEl) => $$(c, '.modes button').map(text);
  const chips = (c: AnyEl) => $$(c, '.chips button').map((b) => b.getAttribute('aria-label'));
  const fanLabels = (c: AnyEl) => $$(c, '.fan-label').length;

  it('HeatPump: one knob, Off and Heat, no fan ring, no chips, no info row', async () => {
    const c = await dial(HP);
    const svg = $(c, 'svg.dial')!;
    expect(svg.getAttribute('role')).toBe('slider');
    expect([svg.getAttribute('aria-valuemin'), svg.getAttribute('aria-valuemax'), svg.getAttribute('aria-valuetext')]).toEqual(['7', '35', '20.0 °C']);
    expect($$(c, 'circle[data-knob]')).toHaveLength(0);
    expect(fanLabels(c)).toBe(0);
    expect($(c, '.chips')).toBeNull();
    expect($(c, '.info')).toBeNull();
    expect($(c, '.status')).toBeNull();
    expect(modes(c)).toEqual(['Off', 'Heat']);
    expect(text($(c, '.sub'))).toBe('Heating to 20.0°');
    expect(($(c, 'button.power') as HTMLButtonElement).hidden).toBe(false);
  });

  it('Hvac: fan ring with five segments, vertical and horizontal swing, no preset chip, humidity from the attribute', async () => {
    const c = await dial(HV);
    expect(fanLabels(c)).toBe(5);
    expect(chips(c)).toEqual(['Vertical airflow: Off', 'Horizontal airflow: Auto']);
    expect($$(c, '.chips .k').map(text)).toEqual(['Vertical', 'Horizontal']);
    expect(modes(c)).toEqual(['Off', 'Heat', 'Cool', 'Auto', 'Dry', 'Fan']);
    expect($$(c, 'circle[data-knob]')).toHaveLength(0);
    // Only the humidity: no outdoor temperature, energy or cloud calls on a non-Daikin unit.
    expect($$(c, '.info > div').map(text)).toEqual(['54 % Humidity']);
    expect(text($(c, '.sub'))).toBe('Cooling to 21.0°');
    // Target humidity (67.4) and the humidity step are not controls of the dial.
    expect(text($(c, 'section.lc'))).not.toContain('67.4');
  });

  it('Ecobee: two knobs for the range, fan ring, swing and preset chips, no Heat button', async () => {
    const c = await dial(EC);
    const svg = $(c, 'svg.dial')!;
    expect(svg.getAttribute('role')).toBe('group');
    const [low, high] = $$(c, 'circle[data-knob]');
    expect([low.getAttribute('data-knob'), high.getAttribute('data-knob')]).toEqual(['low', 'high']);
    expect([low.getAttribute('aria-valuetext'), high.getAttribute('aria-valuetext')]).toEqual(['21.0 °C', '24.0 °C']);
    expect([low.getAttribute('aria-valuemin'), low.getAttribute('aria-valuemax')]).toEqual(['7', '24']);
    expect([high.getAttribute('aria-valuemin'), high.getAttribute('aria-valuemax')]).toEqual(['21', '35']);
    expect(fanLabels(c)).toBe(5);
    expect(chips(c)).toEqual(['Vertical airflow: Auto', 'Preset: Home']);
    expect(modes(c)).not.toContain('Heat');
    expect(modes(c)).toHaveLength(6);
    expect(text($(c, '.sub'))).toBe('Auto 21.0 to 24.0°');
    expect($(c, '.info')).toBeNull();
  });

  it('Fahrenheit: whole-degree limits and values, and the range knobs in F', async () => {
    const hp = await dial(HP, '°F');
    const svg = $(hp, 'svg.dial')!;
    expect([svg.getAttribute('aria-valuemin'), svg.getAttribute('aria-valuemax'), svg.getAttribute('aria-valuetext')]).toEqual(['45', '95', '68 °F']);
    expect(text($(hp, '.sub'))).toBe('Heating to 68°');

    const ec = await dial(EC, '°F');
    const [low, high] = $$(ec, 'circle[data-knob]');
    expect([low.getAttribute('aria-valuetext'), high.getAttribute('aria-valuetext')]).toEqual(['70 °F', '75 °F']);
    expect([low.getAttribute('aria-valuemin'), high.getAttribute('aria-valuemax')]).toEqual(['45', '95']);
    expect(text($(ec, '.sub'))).toBe('Auto 70 to 75°');
  });

  it('config can still switch controls off', async () => {
    const c = await dial(HV, '°C', { controls: { fan: false, swing: false, swing_horizontal: false, modes: ['off', 'cool'] } });
    expect(fanLabels(c)).toBe(0);
    expect($(c, '.chips')).toBeNull();
    expect(modes(c)).toEqual(['Off', 'Cool']);
  });

  it('modes the entity lacks are not shown even when the config asks for them', async () => {
    const c = await dial(HP, '°C', { controls: { modes: ['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'] } });
    expect(modes(c)).toEqual(['Off', 'Heat']);
  });

  it('a mode without a setpoint drops the knobs and disables the steppers', async () => {
    const { hass } = demoHass({ tweak: (f) => (f.states[HV].state = 'dry') });
    const c = await mount('liquid-climate-card', { entity: HV }, hass);
    expect($(c, 'svg.dial')!.getAttribute('aria-valuetext')).toBe('No setpoint in this mode');
    expect($$(c, '.steps button').every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
});

describe('tile', () => {
  const tile = async (id: string, system: (typeof SYSTEMS)[number] = '°C') => mount('liquid-climate-tile', { entity: id }, demoHass({ system }).hass);
  const steps = (t: AnyEl) => $$(t, 'button.step') as HTMLButtonElement[];

  it('HeatPump and Hvac: steppers, the target and hvac_action in the subline', async () => {
    const hp = await tile(HP);
    expect([text($(hp, '.name')), text($(hp, '.sub')), text($(hp, '.target'))]).toEqual(['HeatPump', 'Heating, 25.0° inside', '20.0°']);
    expect(steps(hp)).toHaveLength(2);
    expect(steps(hp).every((b) => !b.disabled)).toBe(true);
    expect($(hp, 'button.range')).toBeNull();
    const hv = await tile(HV);
    expect([text($(hv, '.name')), text($(hv, '.sub')), text($(hv, '.target'))]).toEqual(['Hvac', 'Cooling, 22.0° inside', '21.0°']);
  });

  it('Ecobee: a range button instead of steppers, the mode word without an hvac_action', async () => {
    const ec = await tile(EC);
    expect(steps(ec)).toHaveLength(0);
    expect(text($(ec, 'button.range'))).toBe('21.0–24.0°');
    expect($(ec, 'button.range')!.getAttribute('aria-label')).toBe('Target range 21.0 to 24.0 °C, open controls');
    expect(text($(ec, '.sub'))).toBe('Auto, 23.0° inside');
  });

  it('Fahrenheit values and no decimals on the target', async () => {
    expect(text($(await tile(HP, '°F'), '.target'))).toBe('68°');
    expect(text($(await tile(EC, '°F'), 'button.range'))).toBe('70–75°');
    expect($(await tile(EC, '°F'), 'button.range')!.getAttribute('aria-label')).toBe('Target range 70 to 75 °F, open controls');
  });

  it('the stepper stops at the converted Celsius limits of the HeatPump', async () => {
    const { hass } = demoHass({ tweak: (f) => (f.states[HP].attributes.temperature = 35) });
    const t = await mount('liquid-climate-tile', { entity: HP }, hass);
    expect([steps(t)[0].disabled, steps(t)[1].disabled]).toEqual([false, true]);
  });

  it('the sheet opened from the Ecobee tile holds a dial with two knobs', async () => {
    const t = await tile(EC);
    ($(t, 'button.range') as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(0);
    const sheet = $(t, 'liquid-climate-sheet') as AnyEl;
    await sheet.updateComplete;
    const dial = sheet.querySelector('liquid-climate-card') ?? sheet.shadowRoot!.querySelector('liquid-climate-card');
    expect(dial).not.toBeNull();
    await (dial as AnyEl).updateComplete;
    expect((dial as AnyEl).shadowRoot!.querySelectorAll('circle[data-knob]')).toHaveLength(2);
  });
});

describe('badge', () => {
  const badge = async (id: string, system: (typeof SYSTEMS)[number] = '°C', cfg: Record<string, unknown> = {}) =>
    mount('liquid-climate-badge', { entity: id, ...cfg }, demoHass({ system }).hass);

  it('shows the room temperature of each unit in its mode colour, with no attention dot', async () => {
    for (const [id, label, kind] of [[HP, 'HeatPump: 25.0°', 'on'], [HV, 'Hvac: 22.0°', 'on'], [EC, 'Ecobee: 23.0°', 'on']] as const) {
      const b = await badge(id);
      expect($(b, 'button.badge')!.getAttribute('aria-label')).toBe(label);
      expect($(b, 'button.badge')!.className).toContain(`k-${kind}`);
      expect($(b, '.dot')).toBeNull();
    }
    const round = await badge(EC, '°C', { icon_only: true });
    expect($(round, '.dot')).toBeNull();
    expect($(round, 'button.badge')!.className).toContain('round');
  });

  it('goes Off when the unit is off, and keeps the Fahrenheit reading', async () => {
    const { hass } = demoHass({ system: '°F', tweak: (f) => (f.states[HP].state = 'off') });
    const off = await mount('liquid-climate-badge', { entity: HP }, hass);
    expect($(off, 'button.badge')!.getAttribute('aria-label')).toBe('HeatPump: Off');
    expect(text($(await badge(HP, '°F'), '.v'))).toBe('77.0°');
  });
});

describe('cluster', () => {
  const cluster = async (cfg: Record<string, unknown>, system: (typeof SYSTEMS)[number] = '°C') => mount('liquid-climate-cluster', cfg, demoHass({ system }).hass);
  const room = (c: AnyEl, name: string) => $$(c, 'button.room').find((b) => text(b.querySelector('.rname')) === name)!;
  const modeLabels = (c: AnyEl) => $$(c, '.strip button.mode').map((b) => b.getAttribute('aria-label'));

  it('lists the three units under their own names in one ungrouped list, without house figures', async () => {
    const c = await cluster({});
    expect($$(c, 'button.room').map((b) => text(b.querySelector('.rname')))).toEqual(['Ecobee', 'HeatPump', 'Hvac']);
    expect($$(c, 'h3.floor').map(text)).toEqual([]);
    expect($(c, '.figs')).toBeNull();
    expect(text($(c, '.sum'))).toBe('3 of 3 on');
  });

  it('each room: target, inside temperature, footer, fan ring only when there is a fan', async () => {
    const c = await cluster({});
    const hp = room(c, 'HeatPump');
    expect([text(hp.querySelector('.tline')), text(hp.querySelector('.inside')), text(hp.querySelector('.foot'))]).toEqual(['20.0°', 'Inside 25.0°', 'Heating']);
    expect(hp.querySelector('path.fan-dim')!.getAttribute('display')).toBe('none');
    expect(hp.querySelector('path.fan-lit')!.getAttribute('display')).toBe('none');
    expect(hp.querySelector('circle.knob')!.getAttribute('display')).not.toBe('none');
    expect(hp.getAttribute('aria-label')).toBe('HeatPump, Heating, target 20.0 °C, inside 25.0 °C');

    const hv = room(c, 'Hvac');
    expect([text(hv.querySelector('.tline')), text(hv.querySelector('.foot'))]).toEqual(['21.0°', 'Cooling, fan on high']);
    expect(hv.querySelector('path.fan-dim')!.getAttribute('display')).not.toBe('none');

    const ec = room(c, 'Ecobee');
    expect([text(ec.querySelector('.tline')), text(ec.querySelector('.foot'))]).toEqual(['21.0–24.0°', 'Auto, fan auto low']);
    expect(ec.getAttribute('aria-label')).toBe('Ecobee, Auto, target 21.0 to 24.0 °C, inside 23.0 °C');
    // A range has two ends and no single knob.
    expect(ec.querySelector('circle.knob')!.getAttribute('display')).toBe('none');
  });

  it('the strip offers the modes of the selected unit, steppers only for a single setpoint', async () => {
    const c = await cluster({});
    // Ecobee is first, so it is selected.
    expect(text($(c, '.strip .sname'))).toBe('Ecobee');
    expect(modeLabels(c)).toEqual(['Off', 'Cool', 'Heat/Cool', 'Auto', 'Dry', 'Fan only']);
    expect($$(c, '.strip button.step')).toHaveLength(0);
    expect(text($(c, '.strip button.range'))).toBe('21.0–24.0°');
    room(c, 'HeatPump').click();
    await c.updateComplete;
    expect(modeLabels(c)).toEqual(['Off', 'Heat']);
    expect($$(c, '.strip button.step')).toHaveLength(2);
    expect($(c, '.strip button.range')).toBeNull();
    room(c, 'Hvac').click();
    await c.updateComplete;
    expect(modeLabels(c)).toEqual(['Off', 'Heat', 'Cool', 'Auto', 'Dry', 'Fan only']);
  });

  it('Fahrenheit: whole degrees', async () => {
    const c = await cluster({}, '°F');
    expect(text(room(c, 'HeatPump').querySelector('.tline'))).toBe('68°');
    expect(text(room(c, 'Ecobee').querySelector('.tline'))).toBe('70–75°');
    expect(room(c, 'Ecobee').getAttribute('aria-label')).toBe('Ecobee, Auto, target 70 to 75 °F, inside 73.0 °F');
  });

  it('shows no Daikin figures even when Daikin units are in the same install', async () => {
    const { hass } = demoHass({ withDaikin: true });
    const demoOnly = await mount('liquid-climate-cluster', { entities: ALL }, hass);
    expect($(demoOnly, '.figs')).toBeNull();
    document.body.innerHTML = '';
    const withDaikin = await mount('liquid-climate-cluster', { entities: [...ALL, 'climate.keuken_airco'], rooms: undefined }, hass);
    // Detection never reads entity ids, so the fixture's sensors stay out of the cluster figures too.
    expect(withDaikin.shadowRoot!.querySelectorAll('button.room')).toHaveLength(4);
    expect(emptyElements(withDaikin.shadowRoot!)).toEqual([]);
  });
});

describe('Dutch and German with the Ecobee, in Fahrenheit and Celsius', () => {
  const ec = (lang: string, system: (typeof SYSTEMS)[number]) => demoHass({ language: lang, system });

  describe.each(['nl', 'de'])('%s', (lang) => {
    const L = LOCALES[lang];
    const range = (low: string, high: string) => L['common.range'].replace('{low}', low).replace('{high}', high);

    it('dial: knob labels, unit and chips in the language, degrees in F', async () => {
      const { hass } = ec(lang, '°F');
      const c = await mount('liquid-climate-card', { entity: EC }, hass);
      const [low, high] = $$(c, 'circle[data-knob]');
      expect([low.getAttribute('aria-label'), high.getAttribute('aria-label')]).toEqual([L['dial.knobLow'], L['dial.knobHigh']]);
      expect([low.getAttribute('aria-valuetext'), high.getAttribute('aria-valuetext')]).toEqual(['70 °F', '75 °F']);
      expect($$(c, '.chips .k').map(text)).toEqual([L['dial.vertical'], L['dial.preset']]);
      expect($(c, '.chips button:last-child')!.getAttribute('aria-label')).toBe(L['dial.ariaPreset'].replace('{value}', L['option.home']));
      expect(text($(c, '.sub'))).toBe(L['dial.subRange'].replace('{verb}', L['modeVerb.heat_cool']).replace('{range}', `${range('70', '75')}°`));
      expect(c.shadowRoot!.textContent).not.toContain('°C');
      expect(emptyElements(c.shadowRoot!)).toEqual([]);
    });

    it('dial: decimal comma in Celsius', async () => {
      const { hass } = ec(lang, '°C');
      const c = await mount('liquid-climate-card', { entity: EC }, hass);
      const [low, high] = $$(c, 'circle[data-knob]');
      expect([low.getAttribute('aria-valuetext'), high.getAttribute('aria-valuetext')]).toEqual(['21,0 °C', '24,0 °C']);
    });

    it('tile: range in F, the subline in the language', async () => {
      const { hass } = ec(lang, '°F');
      const t = await mount('liquid-climate-tile', { entity: EC }, hass);
      expect(text($(t, 'button.range'))).toBe('70–75°');
      expect($(t, 'button.range')!.getAttribute('aria-label')).toBe(L['tile.rangeAria'].replace('{range}', range('70', '75')).replace('{unit}', '°F'));
      expect(text($(t, '.sub'))).toBe(L['tile.insideSub'].replace('{word}', L['modeVerb.heat_cool']).replace('{temp}', '73,0°'));
      expect($(t, 'button.power')!.getAttribute('aria-label')).toBe(L['tile.power'].replace('{name}', 'Ecobee'));
    });

    it('badge: the reading uses the language number format', async () => {
      const { hass } = ec(lang, '°F');
      const b = await mount('liquid-climate-badge', { entity: EC }, hass);
      expect($(b, 'button.badge')!.getAttribute('aria-label')).toBe('Ecobee: 73,0°');
    });

    it('cluster: summary, footer, strip labels and target aria in the language', async () => {
      const { hass } = ec(lang, '°F');
      const c = await mount('liquid-climate-cluster', { entities: [EC] }, hass);
      expect(text($(c, '.sum'))).toBe(L['cluster.summaryOn'].replace('{n}', '1').replace('{total}', '1'));
      const room = $(c, 'button.room')!;
      expect(text(room.querySelector('.tline'))).toBe('70–75°');
      expect(text(room.querySelector('.foot'))).toBe(`${L['modeVerb.heat_cool']}, ${L['cluster.fan'].replace('{value}', lang === 'de' ? 'Auto low' : 'auto low')}`);
      expect(text(room.querySelector('.inside'))).toBe(L['dial.insideValue'].replace('{temp}', '73,0°'));
      expect(room.getAttribute('aria-label')).toContain('°F');
      expect(room.getAttribute('aria-label')).not.toContain('°C');
      expect(text($(c, '.strip button.range'))).toBe('70–75°');
      expect($(c, '.strip button.range')!.getAttribute('aria-label')).toBe(L['cluster.rangeAria'].replace('{range}', range('70', '75')).replace('{unit}', '°F'));
    });
  });
});
