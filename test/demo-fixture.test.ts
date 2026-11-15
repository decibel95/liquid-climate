// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DEMO, DEMO_FEATURE as F, demoImperial, demoIntegration, demoMetric } from './fixtures/demo-integration';
import { defaultConfig } from '../src/config';
import { getCapabilities, buildView } from '../src/cards/dial/capabilities';
import { detectSensors } from '../src/detect/roles';
import { getDeviceFamily } from '../src/detect/family';
import { resolveSensors } from '../src/detect/resolve';
import { allFixtures, makeHass, mergeFixtures } from './fixtures';

const ALL = [DEMO.heatpump, DEMO.hvac, DEMO.ecobee];

describe('the demo fixture mirrors demo/climate.py', () => {
  it('has the three entities, each on its own device with only a name and no parent', () => {
    expect(Object.keys(demoMetric.states).sort()).toEqual(['climate.ecobee', 'climate.heatpump', 'climate.hvac']);
    expect(Object.values(demoMetric.devices).map((d) => d.name).sort()).toEqual(['Ecobee', 'HeatPump', 'Hvac']);
    for (const d of Object.values(demoMetric.devices)) {
      expect(d.via_device_id).toBeNull();
      expect(d.manufacturer).toBeNull();
      expect(d.area_id).toBeNull();
    }
    for (const id of ALL) {
      const reg = demoMetric.entities[id];
      expect(reg.platform).toBe('demo');
      expect(reg.translation_key).toBe('ubercool');
      expect(demoMetric.devices[reg.device_id!].name).toBe(demoMetric.states[id].attributes.friendly_name);
    }
    expect(demoMetric.registry[DEMO.heatpump].unique_id).toBe('climate_1');
    expect(demoMetric.registry[DEMO.hvac].unique_id).toBe('climate_2');
    expect(demoMetric.registry[DEMO.ecobee].unique_id).toBe('climate_3');
  });

  it('computes supported_features from the same flags as DemoClimate.__init__', () => {
    const feat = (id: string) => demoMetric.states[id].attributes.supported_features;
    expect(feat(DEMO.heatpump)).toBe(F.TARGET_TEMPERATURE | F.TURN_OFF | F.TURN_ON);
    expect(feat(DEMO.heatpump)).toBe(385);
    expect(feat(DEMO.hvac)).toBe(F.TARGET_TEMPERATURE | F.TARGET_TEMPERATURE_RANGE | F.TARGET_HUMIDITY | F.FAN_MODE | F.SWING_MODE | F.SWING_HORIZONTAL_MODE | F.TURN_OFF | F.TURN_ON);
    expect(feat(DEMO.hvac)).toBe(943);
    // Ecobee has no target_temperature, so no single-setpoint flag.
    expect(feat(DEMO.ecobee)).toBe(F.TARGET_TEMPERATURE_RANGE | F.FAN_MODE | F.PRESET_MODE | F.SWING_MODE | F.TURN_OFF | F.TURN_ON);
    expect(feat(DEMO.ecobee)).toBe(442);
  });

  it('exposes attributes by feature flag, like the climate base class', () => {
    const hp = demoMetric.states[DEMO.heatpump];
    expect(hp.state).toBe('heat');
    expect(hp.attributes.hvac_modes).toEqual(['heat', 'off']);
    for (const k of ['fan_modes', 'fan_mode', 'swing_modes', 'swing_mode', 'swing_horizontal_modes', 'preset_modes', 'preset_mode', 'humidity', 'current_humidity', 'target_temp_low', 'target_temp_high', 'target_temp_step']) {
      expect(hp.attributes, k).not.toHaveProperty(k);
    }
    expect(hp.attributes.hvac_action).toBe('heating');

    const hvac = demoMetric.states[DEMO.hvac];
    expect(hvac.state).toBe('cool');
    expect(hvac.attributes).toMatchObject({
      hvac_modes: ['off', 'heat', 'cool', 'auto', 'dry', 'fan_only'],
      fan_modes: ['on_low', 'on_high', 'auto_low', 'auto_high', 'off'],
      fan_mode: 'on_high',
      swing_modes: ['auto', '1', '2', '3', 'off'],
      swing_mode: 'off',
      swing_horizontal_modes: ['auto', 'rangefull', 'off'],
      swing_horizontal_mode: 'auto',
      humidity: 67.4,
      current_humidity: 54.2,
      min_humidity: 30,
      max_humidity: 99,
      target_humidity_step: 5,
      hvac_action: 'cooling',
      temperature: 21,
      current_temperature: 22,
      target_temp_low: null,
      target_temp_high: null,
    });
    expect(hvac.attributes).not.toHaveProperty('preset_modes');

    const eco = demoMetric.states[DEMO.ecobee];
    expect(eco.state).toBe('heat_cool');
    expect(eco.attributes).toMatchObject({
      hvac_modes: ['off', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'],
      preset_modes: ['home', 'eco', 'away'],
      preset_mode: 'home',
      fan_mode: 'auto_low',
      swing_mode: 'auto',
      target_temp_low: 21,
      target_temp_high: 24,
      current_temperature: 23,
    });
    // No target_temperature, no hvac_action (None), no horizontal swing, no humidity.
    for (const k of ['temperature', 'hvac_action', 'swing_horizontal_modes', 'humidity', 'current_humidity']) expect(eco.attributes, k).not.toHaveProperty(k);
  });

  it('shows temperatures in the system unit with HA display rounding', () => {
    const m = (id: string) => demoMetric.states[id].attributes;
    // HeatPump is Fahrenheit natively: 68 F, 77 F and the 7..35 C defaults come back as Celsius.
    expect([m(DEMO.heatpump).temperature, m(DEMO.heatpump).current_temperature, m(DEMO.heatpump).min_temp, m(DEMO.heatpump).max_temp]).toEqual([20, 25, 7, 35]);
    expect(m(DEMO.heatpump).temperature_unit).toBe('°C');
    const i = (id: string) => demoImperial.states[id].attributes;
    expect(i(DEMO.heatpump)).toMatchObject({ temperature: 68, current_temperature: 77, min_temp: 45, max_temp: 95, temperature_unit: '°F' });
    expect(i(DEMO.hvac)).toMatchObject({ temperature: 70, current_temperature: 72, min_temp: 45, max_temp: 95 });
    expect(i(DEMO.ecobee)).toMatchObject({ target_temp_low: 70, target_temp_high: 75, current_temperature: 73, min_temp: 45, max_temp: 95 });
  });

  it('does not share objects between builds', () => {
    const a = demoIntegration();
    a.states[DEMO.hvac].attributes.fan_mode = 'off';
    expect(demoIntegration().states[DEMO.hvac].attributes.fan_mode).toBe('on_high');
  });
});

describe('capabilities the cards derive from the demo entities', () => {
  const caps = (f = demoMetric, id: string = DEMO.hvac) => getCapabilities(f.states[id], defaultConfig(id), makeHass(f, '°C'));

  it('HeatPump: single setpoint, off and heat, nothing else', () => {
    const c = caps(demoMetric, DEMO.heatpump);
    expect(c).toMatchObject({ single: true, range: false, modes: ['off', 'heat'], hasOff: true, min: 7, max: 35, step: 0.5, unit: '°C' });
    expect([c.fanModes, c.swingModes, c.swingHModes, c.presetModes]).toEqual([[], [], [], []]);
  });

  it('Hvac: every control but presets; heat_cool is not offered', () => {
    const c = caps();
    expect(c.modes).toEqual(['off', 'heat', 'cool', 'auto', 'dry', 'fan_only']);
    expect(c.fanModes).toHaveLength(5);
    expect(c.swingModes).toHaveLength(5);
    expect(c.swingHModes).toHaveLength(3);
    expect(c.presetModes).toEqual([]);
    expect(c).toMatchObject({ single: true, range: true });
  });

  it('Ecobee: range only, with presets and no heat mode', () => {
    const c = caps(demoMetric, DEMO.ecobee);
    expect(c).toMatchObject({ single: false, range: true, modes: ['off', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'] });
    expect(c.presetModes).toEqual(['home', 'eco', 'away']);
    expect(c.swingHModes).toEqual([]);
  });

  it('Fahrenheit system: whole-degree step and the converted limits', () => {
    const c = getCapabilities(demoImperial.states[DEMO.ecobee], defaultConfig(DEMO.ecobee), makeHass(demoImperial, '°F'));
    expect(c).toMatchObject({ unit: '°F', min: 45, max: 95, step: 1, decimals: 0 });
  });

  it('views: Ecobee is dual, Hvac stays single though it supports a range, HeatPump is single', () => {
    const view = (f: typeof demoMetric, id: string) => buildView(f.states[id], getCapabilities(f.states[id], defaultConfig(id)), {});
    expect(view(demoMetric, DEMO.ecobee)).toMatchObject({ dual: true, low: 21, high: 24, hasSetpoint: true });
    expect(view(demoMetric, DEMO.hvac)).toMatchObject({ dual: false, target: 21, hasSetpoint: true, fan: 'on_high', swing: 'off', swingH: 'auto', preset: null });
    expect(view(demoMetric, DEMO.heatpump)).toMatchObject({ dual: false, target: 20, hasSetpoint: true, fan: null, swing: null });
    expect(view(demoImperial, DEMO.ecobee)).toMatchObject({ dual: true, low: 70, high: 75 });
  });
});

describe('sensor detection finds nothing Daikin-specific on the demo entities', () => {
  const hass = (f = demoMetric) => makeHass(f);

  it('a family is the entity device alone', () => {
    for (const id of ALL) {
      const fam = getDeviceFamily(hass(), id);
      expect(fam.deviceIds.size).toBe(1);
      expect(fam.entities).toEqual([]);
    }
  });

  it.each(ALL)('%s: runtime detection is empty', (id) => {
    expect(detectSensors(hass(), id)).toEqual({
      humidity: null, outdoor: null, unitTemperature: null, energy: [], cloudLimit: null, health: [], battery: null, batteryLow: null, valve: null, window: null, opening: null, deviceCount: 1, usedRegistry: false,
    });
  });

  it.each(ALL)('%s: the editor tier, with unique_id and original_name, finds nothing either', (id) => {
    const d = detectSensors(hass(), id, demoMetric.registry);
    expect(d).toMatchObject({ humidity: null, outdoor: null, unitTemperature: null, energy: [], cloudLimit: null, health: [], usedRegistry: true });
  });

  it('resolved sensors show no outdoor, energy or cloud calls; only Hvac reports humidity, from its own attribute', () => {
    const keys = (id: string) => {
      const h = hass();
      return resolveSensors(h, defaultConfig(id), detectSensors(h, id)).info.map((i) => [i.key, i.value]);
    };
    expect(keys(DEMO.heatpump)).toEqual([]);
    expect(keys(DEMO.ecobee)).toEqual([]);
    expect(keys(DEMO.hvac)).toEqual([['humidity', '54']]);
    const r = resolveSensors(hass(), defaultConfig(DEMO.hvac), detectSensors(hass(), DEMO.hvac));
    expect(r.problems).toEqual([]);
    expect(r.figures).toEqual({ outdoor: undefined, energy: [], cloud_limit: undefined });
  });

  it('next to Daikin units, the demo entities pick up none of their sensors and the Daikin ones none of the demo', () => {
    const f = mergeFixtures(allFixtures, demoIntegration());
    const h = makeHass(f);
    for (const id of ALL) {
      const d = detectSensors(h, id);
      expect(d.deviceCount).toBe(1);
      expect([d.outdoor, d.cloudLimit, d.unitTemperature, d.humidity]).toEqual([null, null, null, null]);
      expect(d.energy).toEqual([]);
      expect(d.health).toEqual([]);
    }
    const k = detectSensors(h, 'climate.keuken_airco', f.registry);
    expect(k.cloudLimit).not.toBeNull();
    expect(k.deviceCount).toBeGreaterThan(1);
    expect([...getDeviceFamily(h, 'climate.keuken_airco').entities].some((e) => e.platform === 'demo')).toBe(false);
  });
});
