import { describe, expect, it } from 'vitest';
import { buildView, getCapabilities } from '../src/cards/dial/capabilities';
import { defaultConfig } from '../src/config';
import { dualSetpoint, fahrenheit, keuken, noFan, noSwing, step1 } from './fixtures';

const cfg = (entity: string) => defaultConfig(entity);
const caps = (f: { states: Record<string, any> }, id: string, c = cfg(id)) => getCapabilities(f.states[id], c);

describe('control hiding', () => {
  it('shows every control on a fully featured Daikin unit', () => {
    const c = caps(keuken, 'climate.keuken_airco');
    expect(c.fanModes).toHaveLength(7);
    expect(c.swingModes).toEqual(['stop', 'swing', 'windnice']);
    expect(c.swingHModes).toEqual(['stop', 'swing']);
    expect(c.presetModes).toHaveLength(3);
    expect(c.modes).toEqual(['off', 'heat', 'cool', 'heat_cool', 'dry', 'fan_only']);
  });

  it('hides fan modes listed without the FAN_MODE feature flag', () => {
    expect(caps(noFan, 'climate.no_fan').fanModes).toEqual([]);
  });

  it('hides swing and presets the entity does not support', () => {
    const c = caps(noSwing, 'climate.no_swing');
    expect(c.swingModes).toEqual([]);
    expect(c.swingHModes).toEqual([]);
    expect(c.presetModes).toEqual([]);
    expect(c.fanModes).toEqual(['low', 'medium', 'high']);
  });

  it('only shows modes the entity supports', () => {
    expect(caps(noFan, 'climate.no_fan').modes).toEqual(['off', 'heat']);
    expect(caps(step1, 'climate.step_one').modes).toEqual(['off', 'heat', 'cool']);
  });

  it('config can hide controls the entity does support', () => {
    const c = cfg('climate.keuken_airco');
    c.controls = { ...c.controls, fan: false, swing: false, presets: false, modes: ['heat', 'cool'] };
    const r = caps(keuken, 'climate.keuken_airco', c);
    expect(r.fanModes).toEqual([]);
    expect(r.swingModes).toEqual([]);
    expect(r.presetModes).toEqual([]);
    expect(r.swingHModes).toHaveLength(2);
    expect(r.modes).toEqual(['heat', 'cool']);
  });

  it('config cannot show controls the entity does not support', () => {
    const c = cfg('climate.no_fan');
    c.controls.modes = ['heat', 'cool', 'dry'];
    expect(caps(noFan, 'climate.no_fan', c).modes).toEqual(['heat']);
  });

  it('follows the config order of modes', () => {
    const c = cfg('climate.keuken_airco');
    c.controls.modes = ['cool', 'heat', 'off'];
    expect(caps(keuken, 'climate.keuken_airco', c).modes).toEqual(['cool', 'heat', 'off']);
  });
});

describe('units and scale', () => {
  it('respects Fahrenheit and step 1', () => {
    const c = caps(fahrenheit, 'climate.fahrenheit');
    expect(c).toMatchObject({ unit: '°F', min: 45, max: 95, step: 1, decimals: 0 });
  });

  it('uses half degree steps and one decimal for Daikin', () => {
    expect(caps(keuken, 'climate.keuken_airco')).toMatchObject({ unit: '°C', step: 0.5, decimals: 1, min: 10, max: 30 });
  });

  it('falls back to HA defaults when attributes are missing', () => {
    const c = getCapabilities({ entity_id: 'climate.x', state: 'heat', attributes: { supported_features: 1 } }, cfg('climate.x'), {
      config: { unit_system: { temperature: '°F' } },
    });
    expect(c).toMatchObject({ unit: '°F', min: 45, max: 95, step: 1 });
  });
});

describe('dial view', () => {
  it('shows a single setpoint in heat mode', () => {
    const c = caps(keuken, 'climate.keuken_airco');
    const v = buildView(keuken.states['climate.keuken_airco'], c, {});
    expect(v).toMatchObject({ mode: 'heat', hasSetpoint: true, dual: false, target: 19.5, fan: '2' });
  });

  it('has no setpoint for dry, fan_only and off', () => {
    const c = caps(keuken, 'climate.keuken_airco');
    for (const mode of ['dry', 'fan_only', 'off']) {
      expect(buildView(keuken.states['climate.keuken_airco'], c, { hvac_mode: mode }).hasSetpoint).toBe(false);
    }
  });

  it('merges optimistic values over the entity', () => {
    const c = caps(keuken, 'climate.keuken_airco');
    const v = buildView(keuken.states['climate.keuken_airco'], c, { temperature: 22, fan_mode: '5', hvac_mode: 'cool' });
    expect(v).toMatchObject({ mode: 'cool', target: 22, fan: '5' });
  });

  it('renders two knobs for a range entity in heat_cool', () => {
    const c = caps(dualSetpoint, 'climate.dual_setpoint');
    const v = buildView(dualSetpoint.states['climate.dual_setpoint'], c, {});
    expect(v).toMatchObject({ dual: true, hasSetpoint: true, low: 19, high: 24 });
  });

  it('hides fan, swing and presets in the view when unsupported', () => {
    const c = caps(noFan, 'climate.no_fan');
    const v = buildView(noFan.states['climate.no_fan'], c, {});
    expect(v.fan).toBeNull();
    expect(v.swing).toBeNull();
    expect(v.preset).toBeNull();
  });
});
