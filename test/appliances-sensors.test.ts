import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config';
import { materializeConfig } from '../src/detect/materialize';
import { resolveSensors } from '../src/detect/resolve';
import type { Detection, SensorRef } from '../src/detect/roles';
import { APPLIANCE_IDS as ID, allFixtures, appliances, makeHass, mergeFixtures } from './fixtures';

const ref = (entity_id: string): SensorRef => ({ entity_id, device_id: 'dev_x', source: 'Device' });

/** A detection that found every role a hidden one could come from. */
const detection = (): Detection => ({
  humidity: ref('sensor.x_humidity'),
  outdoor: ref('sensor.x_outdoor'),
  unitTemperature: null,
  energy: [],
  cloudLimit: null,
  health: [],
  battery: null,
  batteryLow: null,
  valve: ref('sensor.x_valve'),
  window: ref('binary_sensor.x_window'),
  opening: null,
  deviceCount: 1,
  usedRegistry: true,
});

const hass = () => {
  const f = mergeFixtures(allFixtures, appliances());
  f.states['sensor.x_humidity'] = { entity_id: 'sensor.x_humidity', state: '48', attributes: { device_class: 'humidity', unit_of_measurement: '%' } };
  f.states['sensor.x_outdoor'] = { entity_id: 'sensor.x_outdoor', state: '7.5', attributes: { device_class: 'temperature', unit_of_measurement: '°C' } };
  f.states['sensor.x_valve'] = { entity_id: 'sensor.x_valve', state: '40', attributes: { unit_of_measurement: '%' } };
  f.states['binary_sensor.x_window'] = { entity_id: 'binary_sensor.x_window', state: 'on', attributes: { device_class: 'window' } };
  return makeHass(f);
};

describe('materializeConfig per domain', () => {
  it('climate writes every detected role, as before', () => {
    const s = materializeConfig(defaultConfig('climate.keuken_airco'), detection()).sensors;
    expect([s.humidity, s.outdoor, s.valve]).toEqual(['sensor.x_humidity', 'sensor.x_outdoor', 'sensor.x_valve']);
  });

  it('a humidifier leaves humidity, outdoor and valve at auto', () => {
    const s = materializeConfig(defaultConfig(ID.humidifier), detection()).sensors;
    expect([s.humidity, s.outdoor, s.valve]).toEqual(['auto', 'auto', 'auto']);
  });

  it('a water heater leaves humidity and valve at auto, and writes outdoor', () => {
    const s = materializeConfig(defaultConfig(ID.waterHeater), detection()).sensors;
    expect([s.humidity, s.valve, s.outdoor]).toEqual(['auto', 'auto', 'sensor.x_outdoor']);
  });
});

describe('resolveSensors skips the roles that mean nothing for the domain', () => {
  const keys = (id: string) => resolveSensors(hass(), defaultConfig(id), detection()).info.map((i) => i.key);

  it('climate shows them all', () => {
    expect(keys('climate.keuken_airco')).toEqual(expect.arrayContaining(['humidity', 'outdoor', 'valve']));
    expect(resolveSensors(hass(), defaultConfig('climate.keuken_airco'), detection()).windowOpen).toBe(true);
  });

  it('humidifier: no humidity, outdoor or valve figure', () => {
    const k = keys(ID.humidifier);
    for (const role of ['humidity', 'outdoor', 'valve']) expect(k).not.toContain(role);
  });

  it('humidifier: the window still counts', () => {
    expect(resolveSensors(hass(), defaultConfig(ID.humidifier), detection()).windowOpen).toBe(true);
  });

  it('water heater: no humidity or valve figure and no window, outdoor stays', () => {
    const r = resolveSensors(hass(), defaultConfig(ID.waterHeater), detection());
    const k = r.info.map((i) => i.key);
    expect(k).not.toContain('humidity');
    expect(k).not.toContain('valve');
    expect(k).toContain('outdoor');
    expect(r.windowOpen).toBe(false);
  });

  it('an explicit entity still shows on any domain', () => {
    const cfg = { ...defaultConfig(ID.humidifier), sensors: { ...defaultConfig(ID.humidifier).sensors, outdoor: 'sensor.x_outdoor', valve: 'sensor.x_valve' } };
    const k = resolveSensors(hass(), cfg, detection()).info.map((i) => i.key);
    expect(k).toEqual(expect.arrayContaining(['outdoor', 'valve']));
    const wh = { ...defaultConfig(ID.waterHeater), sensors: { ...defaultConfig(ID.waterHeater).sensors, window: 'binary_sensor.x_window' } };
    expect(resolveSensors(hass(), wh, detection()).windowOpen).toBe(true);
  });
});
