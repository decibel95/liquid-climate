// @vitest-environment happy-dom
import { render } from 'lit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/index';
import { forgetModes } from '../src/cards/shared/writer';
import { $, $$, demoHass, mount, text, type AnyEl, type Call, type DemoHassOptions } from './demo-harness';
import { DEMO } from './fixtures/demo-integration';

const { heatpump: HP, hvac: HV, ecobee: EC } = DEMO;

beforeEach(() => {
  vi.useFakeTimers();
  forgetModes();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

/** Service calls are the climate domain's, with the entity id in the data. */
const climate = (service: string, data: Record<string, unknown>): Call => ({ service: `climate.${service}`, data });

const flush = () => vi.advanceTimersByTimeAsync(1500);

async function dial(entity: string, o: DemoHassOptions = {}, cfg: Record<string, unknown> = {}) {
  const { hass, calls } = demoHass(o);
  const card = await mount('liquid-climate-card', { entity, ...cfg }, hass);
  return { card, hass, calls };
}

const button = (el: AnyEl, sel: string, label: string) => $$(el, sel).find((b) => b.getAttribute('aria-label') === label || text(b) === label) as HTMLButtonElement;
/**
 * The dial's steppers. happy-dom matches the lit parts of the dial's template wrongly from its svg on (see
 * i18n-render.test.ts), so the stepper template is rendered on its own; its handlers are the card's own.
 */
function steppers(card: AnyEl) {
  const host = document.createElement('div');
  render(card._renderSteps(card._context()), host);
  const [down, up] = [...host.querySelectorAll('button')] as HTMLButtonElement[];
  return { down, up };
}
const up = (card: AnyEl) => steppers(card).up;
const down = (card: AnyEl) => steppers(card).down;
const mode = (el: AnyEl, label: string) => button(el, '.modes button', label);
const key = (target: Element, k: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
const knob = (el: AnyEl, which: 'low' | 'high') => $(el, `circle[data-knob=${which}]`)!;
const rendered = async (...els: AnyEl[]) => {
  for (const e of els) await e.updateComplete;
};

describe('dial writes', () => {
  describe('HeatPump, single setpoint', () => {
    it('steps by half a degree in Celsius and by a degree in Fahrenheit', async () => {
      const c = await dial(HP);
      up(c.card).click();
      await flush();
      expect(c.calls).toEqual([climate('set_temperature', { entity_id: HP, temperature: 20.5 })]);

      document.body.innerHTML = '';
      const f = await dial(HP, { system: '°F' });
      down(f.card).click();
      await flush();
      expect(f.calls).toEqual([climate('set_temperature', { entity_id: HP, temperature: 67 })]);
    });

    it('several presses are one call with the final value', async () => {
      const c = await dial(HP);
      for (let i = 0; i < 3; i++) {
        up(c.card).click();
        await rendered(c.card);
      }
      await vi.advanceTimersByTimeAsync(1000);
      expect(c.calls).toEqual([]);
      await flush();
      expect(c.calls).toEqual([climate('set_temperature', { entity_id: HP, temperature: 21.5 })]);
    });

    it('stops at the limits: 35 C and 95 F send nothing', async () => {
      const { hass, calls } = demoHass({ tweak: (f) => (f.states[HP].attributes.temperature = 35) });
      const hot = await mount('liquid-climate-card', { entity: HP }, hass);
      expect(up(hot).disabled).toBe(false);
      up(hot).click();
      await flush();
      expect(calls).toEqual([]);
      document.body.innerHTML = '';

      const f = demoHass({ system: '°F', tweak: (x) => (x.states[HP].attributes.temperature = 95) });
      const hotF = await mount('liquid-climate-card', { entity: HP }, f.hass);
      up(hotF).click();
      await flush();
      expect(f.calls).toEqual([]);
    });

    it('Off, and the power button back to heat (the only mode it has besides off)', async () => {
      const c = await dial(HP);
      mode(c.card, 'Off').click();
      await flush();
      expect(c.calls).toEqual([climate('set_hvac_mode', { entity_id: HP, hvac_mode: 'off' })]);
      // The entity follows; the power button returns to the remembered mode.
      c.card.hass = { ...c.hass, states: { ...c.hass.states, [HP]: { ...c.hass.states[HP], state: 'off' } } };
      await rendered(c.card);
      $(c.card, 'button.power')!.click();
      await flush();
      expect(c.calls.at(-1)).toEqual(climate('set_hvac_mode', { entity_id: HP, hvac_mode: 'heat' }));
    });

    it('pressing the mode it is already in sends nothing', async () => {
      const c = await dial(HP);
      mode(c.card, 'Heat').click();
      await flush();
      expect(c.calls).toEqual([]);
    });

    it('from off with nothing remembered the power button picks heat, not a mode the unit lacks', async () => {
      const c = await dial(HP, { tweak: (f) => (f.states[HP].state = 'off') });
      $(c.card, 'button.power')!.click();
      await flush();
      expect(c.calls).toEqual([climate('set_hvac_mode', { entity_id: HP, hvac_mode: 'heat' })]);
    });
  });

  describe('Hvac, fan, swing and a range it does not use', () => {
    it('Page Up and Page Down move along the demo fan list', async () => {
      const c = await dial(HV);
      key($(c.card, 'svg.dial')!, 'PageUp');
      await flush();
      expect(c.calls).toEqual([climate('set_fan_mode', { entity_id: HV, fan_mode: 'auto_low' })]);
      key($(c.card, 'svg.dial')!, 'PageDown');
      key($(c.card, 'svg.dial')!, 'PageDown');
      await flush();
      expect(c.calls.at(-1)).toEqual(climate('set_fan_mode', { entity_id: HV, fan_mode: 'on_low' }));
    });

    it('the vertical swing chip cycles from off round to auto', async () => {
      const c = await dial(HV);
      button(c.card, '.chips button', 'Vertical airflow: Off').click();
      await flush();
      expect(c.calls).toEqual([climate('set_swing_mode', { entity_id: HV, swing_mode: 'auto' })]);
    });

    it('the horizontal swing chip sends set_swing_horizontal_mode', async () => {
      const c = await dial(HV);
      button(c.card, '.chips button', 'Horizontal airflow: Auto').click();
      await flush();
      expect(c.calls).toEqual([climate('set_swing_horizontal_mode', { entity_id: HV, swing_horizontal_mode: 'rangefull' })]);
    });

    it('a mode change goes first and the setpoint is a single temperature, never a low/high pair', async () => {
      const c = await dial(HV);
      mode(c.card, 'Auto').click();
      await rendered(c.card);
      up(c.card).click();
      await rendered(c.card);
      await flush();
      expect(c.calls).toEqual([
        climate('set_hvac_mode', { entity_id: HV, hvac_mode: 'auto' }),
        climate('set_temperature', { entity_id: HV, temperature: 21.5 }),
      ]);
    });

    it('a mode without a setpoint disables the steppers, and drops a queued temperature', async () => {
      const dry = await dial(HV, { tweak: (f) => (f.states[HV].state = 'dry') });
      expect([down(dry.card).disabled, up(dry.card).disabled]).toEqual([true, true]);
      document.body.innerHTML = '';

      const c = await dial(HV);
      up(c.card).click();
      await rendered(c.card);
      mode(c.card, 'Fan').click();
      await flush();
      expect(c.calls).toEqual([climate('set_hvac_mode', { entity_id: HV, hvac_mode: 'fan_only' })]);
    });

    it('from off the power button picks heat first, as the unit has it', async () => {
      const c = await dial(HV, { tweak: (f) => (f.states[HV].state = 'off') });
      $(c.card, 'button.power')!.click();
      await flush();
      expect(c.calls).toEqual([climate('set_hvac_mode', { entity_id: HV, hvac_mode: 'heat' })]);
    });
  });

  describe('Ecobee, dual setpoint', () => {
    it('the steppers move the lower end and send both ends together', async () => {
      const c = await dial(EC);
      up(c.card).click();
      await flush();
      expect(c.calls).toEqual([climate('set_temperature', { entity_id: EC, target_temp_low: 21.5, target_temp_high: 24 })]);
      expect(c.calls[0].data).not.toHaveProperty('temperature');
    });

    it('a key on the upper knob moves only the upper end', async () => {
      const c = await dial(EC);
      key(knob(c.card, 'high'), 'ArrowUp');
      await flush();
      expect(c.calls).toEqual([climate('set_temperature', { entity_id: EC, target_temp_low: 21, target_temp_high: 24.5 })]);
    });

    it('Fahrenheit steps a whole degree and honours the converted limits', async () => {
      const c = await dial(EC, { system: '°F' });
      key(knob(c.card, 'low'), 'ArrowRight');
      await flush();
      expect(c.calls).toEqual([climate('set_temperature', { entity_id: EC, target_temp_low: 71, target_temp_high: 75 })]);

      document.body.innerHTML = '';
      const lo = await dial(EC, { system: '°F' });
      key(knob(lo.card, 'low'), 'Home');
      await flush();
      expect(lo.calls).toEqual([climate('set_temperature', { entity_id: EC, target_temp_low: 45, target_temp_high: 75 })]);

      document.body.innerHTML = '';
      const hi = await dial(EC, { system: '°F' });
      key(knob(hi.card, 'high'), 'End');
      await flush();
      expect(hi.calls).toEqual([climate('set_temperature', { entity_id: EC, target_temp_low: 70, target_temp_high: 95 })]);
    });

    it('the lower end stops one step below the upper end', async () => {
      const c = await dial(EC, { system: '°F' });
      key(knob(c.card, 'low'), 'End');
      await flush();
      expect(c.calls).toEqual([climate('set_temperature', { entity_id: EC, target_temp_low: 74, target_temp_high: 75 })]);
    });

    it('the preset chip cycles home, eco, away and a quick second press wins', async () => {
      const c = await dial(EC);
      button(c.card, '.chips button', 'Preset: Home').click();
      await flush();
      expect(c.calls).toEqual([climate('set_preset_mode', { entity_id: EC, preset_mode: 'eco' })]);

      document.body.innerHTML = '';
      const d = await dial(EC);
      const chip = () => $(d.card, '.chips button:last-child') as HTMLButtonElement;
      chip().click();
      await rendered(d.card);
      chip().click();
      await flush();
      expect(d.calls).toEqual([climate('set_preset_mode', { entity_id: EC, preset_mode: 'away' })]);
    });

    it('the swing chip sends set_swing_mode; auto moves on to 1', async () => {
      const c = await dial(EC);
      button(c.card, '.chips button', 'Vertical airflow: Auto').click();
      await flush();
      expect(c.calls).toEqual([climate('set_swing_mode', { entity_id: EC, swing_mode: '1' })]);
    });

    it('the fan keys use the demo fan list', async () => {
      const c = await dial(EC);
      key($(c.card, 'svg.dial')!, 'PageUp');
      await flush();
      expect(c.calls).toEqual([climate('set_fan_mode', { entity_id: EC, fan_mode: 'auto_high' })]);
    });

    it('mode buttons: Cool sends only the mode; power off sends off', async () => {
      const c = await dial(EC);
      mode(c.card, 'Cool').click();
      await flush();
      expect(c.calls).toEqual([climate('set_hvac_mode', { entity_id: EC, hvac_mode: 'cool' })]);
      document.body.innerHTML = '';
      const p = await dial(EC);
      $(p.card, 'button.power')!.click();
      await flush();
      expect(p.calls).toEqual([climate('set_hvac_mode', { entity_id: EC, hvac_mode: 'off' })]);
    });

    it('from off with nothing remembered the power button goes to cool: the Ecobee has no heat', async () => {
      const c = await dial(EC, { tweak: (f) => (f.states[EC].state = 'off') });
      $(c.card, 'button.power')!.click();
      await flush();
      expect(c.calls).toEqual([climate('set_hvac_mode', { entity_id: EC, hvac_mode: 'cool' })]);
    });
  });
});

describe('tile writes', () => {
  const tile = async (entity: string, o: DemoHassOptions = {}) => {
    const { hass, calls } = demoHass(o);
    return { tile: await mount('liquid-climate-tile', { entity }, hass), calls, hass };
  };
  const step = (t: AnyEl, i: number) => $$(t, 'button.step')[i] as HTMLButtonElement;

  it('HeatPump and Hvac step the single setpoint', async () => {
    const hp = await tile(HP);
    step(hp.tile, 1).click();
    await flush();
    expect(hp.calls).toEqual([climate('set_temperature', { entity_id: HP, temperature: 20.5 })]);
    document.body.innerHTML = '';
    const hv = await tile(HV, { system: '°F' });
    step(hv.tile, 0).click();
    await flush();
    expect(hv.calls).toEqual([climate('set_temperature', { entity_id: HV, temperature: 69 })]);
  });

  it('the Ecobee tile has no steppers and the range button writes nothing by itself', async () => {
    const ec = await tile(EC);
    expect($$(ec.tile, 'button.step')).toHaveLength(0);
    ($(ec.tile, 'button.range') as HTMLButtonElement).click();
    await flush();
    expect(ec.calls).toEqual([]);
  });

  it('power: off, then back to the remembered mode; Ecobee off', async () => {
    const hp = await tile(HP);
    ($(hp.tile, 'button.power') as HTMLButtonElement).click();
    await flush();
    expect(hp.calls).toEqual([climate('set_hvac_mode', { entity_id: HP, hvac_mode: 'off' })]);
    document.body.innerHTML = '';
    const ec = await tile(EC);
    ($(ec.tile, 'button.power') as HTMLButtonElement).click();
    await flush();
    expect(ec.calls).toEqual([climate('set_hvac_mode', { entity_id: EC, hvac_mode: 'off' })]);
  });

  it('a tile and a dial on the same Ecobee share one queue: a range step and a power press are one flush, in order', async () => {
    const { hass, calls } = demoHass();
    const t = await mount('liquid-climate-tile', { entity: EC }, hass);
    const d = await mount('liquid-climate-card', { entity: EC }, hass);
    up(d).click();
    await rendered(d, t);
    ($(t, 'button.power') as HTMLButtonElement).click();
    await flush();
    // Off has no setpoint, so the queued range is dropped and only the mode goes out.
    expect(calls).toEqual([climate('set_hvac_mode', { entity_id: EC, hvac_mode: 'off' })]);
  });
});

describe('badge and cluster writes', () => {
  it('the badge writes nothing: a tap opens more-info, or the dial sheet when asked', async () => {
    const { hass, calls } = demoHass();
    const b = await mount('liquid-climate-badge', { entity: HV }, hass);
    const seen: unknown[] = [];
    b.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail));
    ($(b, 'button.badge') as HTMLButtonElement).click();
    expect(seen).toEqual([{ entityId: HV }]);

    const s = await mount('liquid-climate-badge', { entity: EC, tap_action: 'sheet' }, hass);
    ($(s, 'button.badge') as HTMLButtonElement).click();
    const sheet = $(s, 'liquid-climate-sheet') as AnyEl;
    await sheet.updateComplete;
    const dialog = sheet.shadowRoot!.querySelector('dialog')!;
    expect(dialog.hasAttribute('open')).toBe(true);
    const card = dialog.querySelector('liquid-climate-card') as AnyEl;
    expect(card._config.entity).toBe(EC);
    await flush();
    expect(calls).toEqual([]);
  });

  it('cluster: the strip writes for the selected unit with that unit\'s modes and limits', async () => {
    const { hass, calls } = demoHass();
    const c = await mount('liquid-climate-cluster', {}, hass);
    const room = (name: string) => $$(c, 'button.room').find((b) => text(b.querySelector('.rname')) === name)!;
    const strip = (sel: string) => $$(c, `.strip ${sel}`) as HTMLButtonElement[];

    // Ecobee is selected first: Cool is a plain mode write.
    strip('button.mode').find((b) => b.getAttribute('aria-label') === 'Cool')!.click();
    await flush();
    expect(calls).toEqual([climate('set_hvac_mode', { entity_id: EC, hvac_mode: 'cool' })]);

    room('HeatPump').click();
    await c.updateComplete;
    strip('button.step')[1].click();
    await flush();
    expect(calls.at(-1)).toEqual(climate('set_temperature', { entity_id: HP, temperature: 20.5 }));

    room('Hvac').click();
    await c.updateComplete;
    strip('button.mode').find((b) => b.getAttribute('aria-label') === 'Heat')!.click();
    await flush();
    expect(calls.at(-1)).toEqual(climate('set_hvac_mode', { entity_id: HV, hvac_mode: 'heat' }));
    expect(calls).toHaveLength(3);
  });

  it('cluster: the Ecobee range opens the dial instead of writing', async () => {
    const { hass, calls } = demoHass();
    const c = await mount('liquid-climate-cluster', { entities: [EC] }, hass);
    ($(c, '.strip button.range') as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(0);
    expect((($(c, 'liquid-climate-sheet')) as AnyEl).isOpen).toBe(true);
    expect(calls).toEqual([]);
  });
});
