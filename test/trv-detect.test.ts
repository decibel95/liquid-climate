// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import '../src/index';
import { defaultConfig, normalizeClusterConfig, normalizeConfig, pruneDefaults, roomDialConfig } from '../src/config';
import { materializeConfig } from '../src/detect/materialize';
import { isPaused, resolveSensors, windowOf } from '../src/detect/resolve';
import { detectSensors } from '../src/detect/roles';
import { allFixtures, makeHass, mergeFixtures, type Fixture } from './fixtures';
import { TRV, trvFixtures } from './fixtures/trv';
import type { HassEntity } from '../src/types';
import type { LiquidClimateConfig } from '../src/config';

const fixture = (tweak?: (f: Fixture) => void) => {
  const f = mergeFixtures(allFixtures, trvFixtures);
  tweak?.(f);
  return f;
};

/** Another entity on the Sonoff device. */
function add(f: Fixture, id: string, state: string, attributes: Record<string, unknown>, reg: Record<string, unknown> = {}, extra?: { unique_id?: string; original_name?: string }) {
  f.states[id] = { entity_id: id, state, attributes } as HassEntity;
  f.entities[id] = { entity_id: id, platform: 'mqtt', device_id: 'dev_trv_sonoff', translation_key: null, ...reg };
  if (extra) f.registry[id] = extra;
}

const detect = (f: Fixture, id: string = TRV.sonoff, withRegistry = false) => detectSensors(makeHass(f), id, withRegistry ? f.registry : undefined);

describe('TRV detection: the Sonoff TRVZB family', () => {
  it('runtime: battery and window by device class; the valve needs a translation key or the registry', () => {
    const d = detect(fixture());
    expect(d.battery?.entity_id).toBe('sensor.trv_sonoff_battery');
    expect(d.batteryLow).toBeNull();
    expect(d.window?.entity_id).toBe('binary_sensor.trv_sonoff_window_open');
    expect(d.valve).toBeNull();
    expect(d.humidity).toBeNull();
    expect(d.outdoor).toBeNull();
    expect(d.cloudLimit).toBeNull();
    expect(d.energy).toEqual([]);
    expect(d.health).toEqual([]);
  });

  it('editor tier: the Pi heating demand sensor is the valve, the calibration is not', () => {
    const d = detect(fixture(), TRV.sonoff, true);
    expect(d.valve?.entity_id).toBe('sensor.trv_sonoff_pi_heating_demand');
    expect(d.valve?.source).toBe('Radiator valve');
    expect(d.unitTemperature).toBeNull();
  });

  it('the editor writes the valve out, and leaves battery and window to runtime detection', () => {
    const f = fixture();
    const cfg = materializeConfig(defaultConfig(TRV.sonoff), detect(f, TRV.sonoff, true));
    expect(cfg.sensors.valve).toBe('sensor.trv_sonoff_pi_heating_demand');
    expect(cfg.sensors.battery).toBe('auto');
    expect(cfg.sensors.window).toBe('auto');
  });

  it('a translation key settles the valve at runtime, with no registry', () => {
    for (const key of ['pi_heating_demand', 'valve_position', 'valve_opening', 'heating_demand']) {
      const f = fixture((fx) => {
        delete fx.states['sensor.trv_sonoff_pi_heating_demand'];
        add(fx, 'sensor.v', '30', { unit_of_measurement: '%' }, { translation_key: key });
      });
      expect(detect(f).valve?.entity_id, key).toBe('sensor.v');
    }
  });

  it('never reads entity ids or names at runtime', () => {
    const f = fixture((fx) => {
      delete fx.states['sensor.trv_sonoff_pi_heating_demand'];
      add(fx, 'sensor.valve_position_pi_heating_demand', '30', { unit_of_measurement: '%', friendly_name: 'Valve position' });
    });
    expect(detect(f).valve).toBeNull();
  });
});

describe('TRV detection: no false positives', () => {
  it('a humidity sensor in percent is not a valve, even with a valve name', () => {
    const f = fixture((fx) => {
      delete fx.states['sensor.trv_sonoff_pi_heating_demand'];
      add(fx, 'sensor.h', '40', { unit_of_measurement: '%', device_class: 'humidity' }, { translation_key: 'valve_position' }, { unique_id: 'x_heating_demand', original_name: 'Heating demand' });
    });
    expect(detect(f, TRV.sonoff, true).valve).toBeNull();
    expect(detect(f).valve).toBeNull();
  });

  it('a battery sensor in percent is not a valve', () => {
    const f = fixture((fx) => {
      delete fx.states['sensor.trv_sonoff_pi_heating_demand'];
      fx.entities[BATTERY_ID] = { ...fx.entities[BATTERY_ID], translation_key: 'valve_position' };
      fx.registry[BATTERY_ID] = { unique_id: 'x_valve_position_battery', original_name: 'Valve battery' };
    });
    expect(detect(f, TRV.sonoff, true).valve).toBeNull();
    expect(detect(f).valve).toBeNull();
  });

  it('a percent sensor with a battery or humidity word in its name is not a valve', () => {
    const f = fixture((fx) => {
      delete fx.states['sensor.trv_sonoff_pi_heating_demand'];
      add(fx, 'sensor.x', '50', { unit_of_measurement: '%' }, {}, { unique_id: 'x_valve_position_battery_level', original_name: 'Valve battery' });
    });
    expect(detect(f, TRV.sonoff, true).valve).toBeNull();
  });

  it('the calibration offset is not a valve (unit degrees, and its name says so)', () => {
    const f = fixture((fx) => delete fx.states['sensor.trv_sonoff_pi_heating_demand']);
    expect(detect(f, TRV.sonoff, true).valve).toBeNull();
    const g = fixture((fx) => {
      delete fx.states['sensor.trv_sonoff_pi_heating_demand'];
      fx.states['sensor.trv_sonoff_local_temperature_calibration'].attributes.unit_of_measurement = '%';
    });
    expect(detect(g, TRV.sonoff, true).valve).toBeNull();
  });

  it('two valve candidates settle nothing', () => {
    const f = fixture((fx) => add(fx, 'sensor.second', '10', { unit_of_measurement: '%' }, { translation_key: 'valve_opening' }));
    expect(detect(f, TRV.sonoff, true).valve).toBeNull();
  });

  it('a sensor and a valve entity compete, a lone valve entity counts', () => {
    const addValve = (fx: Fixture) => add(fx, 'valve.v', 'open', { current_position: 70 });
    expect(detect(fixture(addValve), TRV.sonoff, true).valve).toBeNull();
    const lone = fixture((fx) => {
      delete fx.states['sensor.trv_sonoff_pi_heating_demand'];
      addValve(fx);
    });
    expect(detect(lone).valve?.entity_id).toBe('valve.v');
  });

  it('a valve name in a space separated original_name alone carries the role', () => {
    const f = fixture((fx) => {
      fx.entities['sensor.trv_sonoff_pi_heating_demand'] = { ...fx.entities['sensor.trv_sonoff_pi_heating_demand'], translation_key: null };
      fx.registry['sensor.trv_sonoff_pi_heating_demand'] = { unique_id: 'abc', original_name: 'Pi heating demand' };
    });
    expect(detect(f, TRV.sonoff, true).valve?.entity_id).toBe('sensor.trv_sonoff_pi_heating_demand');
  });

  it('a louver or vane position in percent is not a valve, and a bare position is not either', () => {
    const f = fixture((fx) => {
      delete fx.states['sensor.trv_sonoff_pi_heating_demand'];
      add(fx, 'sensor.louver', '50', { unit_of_measurement: '%' }, { translation_key: 'vertical_vane_position' }, { unique_id: 'x_vane_position', original_name: 'Vane position' });
      add(fx, 'sensor.pos', '50', { unit_of_measurement: '%' }, { translation_key: 'position' }, { unique_id: 'x_position', original_name: 'Position' });
    });
    expect(detect(f, TRV.sonoff, true).valve).toBeNull();
    expect(detect(f).valve).toBeNull();
    expect(detect(fixture(), 'climate.keuken_airco', true).valve).toBeNull();
  });

  it('a numeric string position is no valve; names match whole words only', () => {
    const str = fixture((fx) => add(fx, 'valve.v', 'open', { current_position: '70' }));
    expect(detect(str, TRV.sonoff, true).valve?.entity_id).toBe('sensor.trv_sonoff_pi_heating_demand');
    const named = (name: string) =>
      fixture((fx) => {
        delete fx.states['sensor.trv_sonoff_pi_heating_demand'];
        add(fx, 'sensor.n', '50', { unit_of_measurement: '%' }, {}, { unique_id: 'x', original_name: name });
      });
    expect(detect(named('Infant room pi heating demand'), TRV.sonoff, true).valve?.entity_id).toBe('sensor.n');
    expect(detect(named('Fan valve position'), TRV.sonoff, true).valve).toBeNull();
    expect(detect(named('fan position'), TRV.sonoff, true).valve).toBeNull();
  });

  it('a valve entity without a numeric position is no candidate; the pi heating demand sensor wins', () => {
    const f = fixture((fx) => add(fx, 'valve.v', 'open', {}));
    expect(detect(f, TRV.sonoff, true).valve?.entity_id).toBe('sensor.trv_sonoff_pi_heating_demand');
    const g = fixture((fx) => add(fx, 'valve.v', 'open', { current_position: null }));
    expect(detect(g, TRV.sonoff, true).valve?.entity_id).toBe('sensor.trv_sonoff_pi_heating_demand');
  });

  it('an opening contact needs a valve in the family; without one it gives no window and no pause', () => {
    const noValve = fixture((fx) => {
      delete fx.states['sensor.trv_sonoff_pi_heating_demand'];
      delete fx.states[WINDOW_ID];
      add(fx, 'binary_sensor.o', 'on', { device_class: 'opening' });
    });
    expect(detect(noValve).window).toBeNull();
    const hass = makeHass(noValve);
    const res = resolveSensors(hass, normalizeConfig({ entity: TRV.sonoff }), detect(noValve));
    expect(res.windowOpen).toBe(false);
    expect(isPaused(hass, undefined, res.windowOpen)).toBe(false);
    // An explicit sensors.window still works.
    const set = resolveSensors(hass, normalizeConfig({ entity: TRV.sonoff, sensors: { window: 'binary_sensor.o' } }), detect(noValve));
    expect(set.windowOpen).toBe(true);
  });

  it('two window contacts settle nothing', () => {
    const two = fixture((fx) => add(fx, 'binary_sensor.w2', 'off', { device_class: 'window' }));
    expect(detect(two).window).toBeNull();
    expect(detect(two).opening).toBeNull();
  });

  it('window and opening together: the window contact wins, with and without the registry', () => {
    const mixed = fixture((fx) => add(fx, 'binary_sensor.o', 'off', { device_class: 'opening' }));
    for (const reg of [false, true]) {
      const d = detect(mixed, TRV.sonoff, reg);
      expect(d.window?.entity_id).toBe(WINDOW_ID);
      expect(d.opening).toBeNull();
      expect(windowOf(d, 'sensor.v')?.entity_id).toBe(WINDOW_ID);
      expect(windowOf(d, 'auto')?.entity_id).toBe(WINDOW_ID);
    }
  });

  it('a lone opening contact counts only when the valve setting resolves, the same with and without the registry', () => {
    const only = fixture((fx) => {
      delete fx.states[WINDOW_ID];
      add(fx, 'binary_sensor.o', 'on', { device_class: 'opening' });
    });
    const hass = makeHass(only);
    const windowOpen = (valve: unknown, reg: boolean) =>
      resolveSensors(hass, normalizeConfig({ entity: TRV.sonoff, sensors: { valve } }), detect(only, TRV.sonoff, reg)).windowOpen;
    // Explicit valve (what the editor writes): runtime without registry pauses.
    expect(windowOpen('sensor.trv_sonoff_pi_heating_demand', false)).toBe(true);
    expect(windowOpen('sensor.trv_sonoff_pi_heating_demand', true)).toBe(true);
    // Auto: only a detected valve (registry) qualifies; no registry means no valve and no window.
    expect(windowOpen('auto', true)).toBe(true);
    expect(windowOpen('auto', false)).toBe(false);
    // Hidden valve disables the pick.
    expect(windowOpen(false, true)).toBe(false);
    expect(windowOpen(false, false)).toBe(false);
    expect(detect(only).opening?.entity_id).toBe('binary_sensor.o');
    expect(detect(only).window).toBeNull();
  });

  it('a door contact is not a window', () => {
    const f = fixture((fx) => {
      delete fx.states[WINDOW_ID];
      add(fx, 'binary_sensor.d', 'on', { device_class: 'door' });
    });
    expect(detect(f).window).toBeNull();
  });

  it('two battery sensors settle nothing; a sensor and a low flag are both kept', () => {
    const two = fixture((fx) => add(fx, 'sensor.b2', '50', { device_class: 'battery', unit_of_measurement: '%' }));
    expect(detect(two).battery).toBeNull();
    const both = fixture((fx) => add(fx, 'binary_sensor.low', 'off', { device_class: 'battery' }));
    const d = detect(both);
    expect(d.battery?.entity_id).toBe('sensor.trv_sonoff_battery');
    expect(d.batteryLow?.entity_id).toBe('binary_sensor.low');
  });

  it('a hidden or stateless entity is ignored', () => {
    const f = fixture((fx) => {
      fx.entities[WINDOW_ID] = { ...fx.entities[WINDOW_ID], hidden: true };
    });
    expect(detect(f).window).toBeNull();
  });

  it('units without a device (generic thermostat) and a bare Better Thermostat find nothing', () => {
    for (const id of [TRV.generic, TRV.genericBlind, TRV.better, TRV.presetNone]) {
      const d = detect(fixture(), id, true);
      expect([d.battery, d.batteryLow, d.valve, d.window], id).toEqual([null, null, null, null]);
    }
  });

  it('Daikin units find none of the valve roles', () => {
    const f = fixture();
    const d = detectSensors(makeHass(f), 'climate.keuken_airco', f.registry);
    expect([d.battery, d.batteryLow, d.valve, d.window]).toEqual([null, null, null, null]);
  });
});

const BATTERY_ID = 'sensor.trv_sonoff_battery';
const WINDOW_ID = 'binary_sensor.trv_sonoff_window_open';

describe('TRV resolution', () => {
  const resolve = (f: Fixture, cfg: Partial<LiquidClimateConfig> = {}, entity: string = TRV.sonoff) => {
    const hass = makeHass(f);
    return resolveSensors(hass, normalizeConfig({ ...cfg, entity }), detectSensors(hass, entity, f.registry));
  };
  const written = (f: Fixture) => materializeConfig(defaultConfig(TRV.sonoff), detect(f, TRV.sonoff, true)).sensors;

  it('battery: low under 20, ok at 20, never for unavailable or unknown', () => {
    for (const [state, low] of [['19', true], ['20', false], ['78', false], ['unavailable', false], ['unknown', false], ['', false]] as const) {
      const f = fixture((fx) => (fx.states[BATTERY_ID].state = state));
      expect(resolve(f).battery?.low, state).toBe(low);
    }
  });

  it('battery: the low flag on counts, off does not, and unavailable does not', () => {
    for (const [state, low] of [['on', true], ['off', false], ['unavailable', false]] as const) {
      const f = fixture((fx) => {
        fx.states[BATTERY_ID].state = '80';
        add(fx, 'binary_sensor.low', state, { device_class: 'battery' });
      });
      expect(resolve(f).battery?.low, state).toBe(low);
    }
  });

  it('battery: no battery sensor at all is no battery, hidden stays hidden, and the figure needs an explicit entity', () => {
    expect(resolve(fixture(), {}, TRV.generic).battery).toBeNull();
    expect(resolve(fixture((fx) => (fx.states[BATTERY_ID].state = '5')), { sensors: { ...defaultConfig('').sensors, battery: false } }).battery).toBeNull();
    expect(resolve(fixture()).info.map((i) => i.key)).not.toContain('battery');
    const set = resolve(fixture((fx) => (fx.states[BATTERY_ID].state = '15')), { sensors: { ...defaultConfig('').sensors, battery: BATTERY_ID } });
    expect(set.info.find((i) => i.key === 'battery')).toMatchObject({ value: '15', unit: '%', warn: true });
  });

  it('valve: the figure, rounded, hidden with false', () => {
    const f = fixture((fx) => (fx.states['sensor.trv_sonoff_pi_heating_demand'].state = '45.6'));
    const r = resolve(f, { sensors: written(f) });
    expect(r.info.find((i) => i.key === 'valve')).toMatchObject({ value: '46', unit: '%', label: 'Valve' });
    expect(resolve(f, { sensors: { ...written(f), valve: false } }).info.map((i) => i.key)).not.toContain('valve');
    expect(resolve(fixture((fx) => (fx.states['sensor.trv_sonoff_pi_heating_demand'].state = 'unavailable')), { sensors: written(f) }).info).toEqual([]);
  });

  it('window: open when on; false hides it', () => {
    const f = fixture((fx) => (fx.states[WINDOW_ID].state = 'on'));
    expect(resolve(f).windowOpen).toBe(true);
    expect(resolve(f, { sensors: { ...defaultConfig('').sensors, window: false } }).windowOpen).toBe(false);
    expect(resolve(fixture()).windowOpen).toBe(false);
  });

  it('isPaused: an explicit pause entity decides, else the window', () => {
    const hass = makeHass(fixture((fx) => (fx.states['input_boolean.p'] = { entity_id: 'input_boolean.p', state: 'off', attributes: {} })));
    expect(isPaused(hass, 'input_boolean.p', true)).toBe(false);
    expect(isPaused(hass, undefined, true)).toBe(true);
    expect(isPaused(hass, undefined, false)).toBe(false);
  });

  it('the calibration sensor is never an info figure', () => {
    const f = fixture();
    expect(resolve(f, { sensors: written(f) }).info.map((i) => i.key)).toEqual(['valve']);
  });
});

describe('write_hold config', () => {
  it('defaults to 10, accepts a number of seconds, ignores anything else', () => {
    expect(normalizeConfig({ entity: 'climate.a' }).write_hold).toBe(10);
    expect(normalizeConfig({ entity: 'climate.a', write_hold: 30 }).write_hold).toBe(30);
    expect(normalizeConfig({ entity: 'climate.a', write_hold: -1 }).write_hold).toBe(10);
    expect(normalizeConfig({ entity: 'climate.a', write_hold: '30' }).write_hold).toBe(10);
    expect(normalizeConfig({ entity: 'climate.a', write_hold: Infinity }).write_hold).toBe(10);
    expect(normalizeConfig({ entity: 'climate.a', write_hold: NaN }).write_hold).toBe(10);
    // 0 means no hold.
    expect(normalizeConfig({ entity: 'climate.a', write_hold: 0 }).write_hold).toBe(0);
    expect(normalizeConfig({ entity: 'climate.a', write_hold: 99999 }).write_hold).toBe(3600);
  });

  it('the editor leaves the default out of the saved config', () => {
    const pruned = pruneDefaults(normalizeConfig({ entity: 'climate.a', write_hold: 60 }), defaultConfig('climate.a') as unknown as Record<string, unknown>);
    expect(pruned.write_hold).toBe(60);
    expect(pruneDefaults(normalizeConfig({ entity: 'climate.a' }), defaultConfig('climate.a') as unknown as Record<string, unknown>)).not.toHaveProperty('write_hold');
  });

  it('a cluster passes it to every room dial, and sensors.battery to a room', () => {
    const cluster = normalizeClusterConfig({ write_hold: 30, entities: [{ entity: 'climate.a', sensors: { battery: false, valve: 'sensor.v', window: 'auto', junk: 'x' } }] });
    expect(cluster.write_hold).toBe(30);
    expect(normalizeClusterConfig({}).write_hold).toBe(10);
    const room = roomDialConfig(cluster, cluster.entities[0]);
    expect(room.write_hold).toBe(30);
    expect(room.sensors).toMatchObject({ battery: false, valve: 'sensor.v', window: 'auto' });
    expect(room.sensors).not.toHaveProperty('junk');
  });
});
