import { describe, expect, it } from 'vitest';
import { getDeviceFamily } from '../src/detect/family';
import { detectSensors, isWholeDegrees, suggestRoomSensors } from '../src/detect/roles';
import { energyKWh, numericState, resolveSensors } from '../src/detect/resolve';
import { materializeConfig } from '../src/detect/materialize';
import { fetchRegistry } from '../src/detect/registry';
import { defaultConfig } from '../src/config';
import type { HomeAssistant } from '../src/types';
import { allFixtures, dualSetpoint, emptyFixture, keuken, makeHass, mergeFixtures, noFan, slaapkamer } from './fixtures';

const hass = makeHass(allFixtures);
const reg = allFixtures.registry;
const K = 'climate.keuken_airco';

describe('device family', () => {
  it('includes the climate device and all linked child devices', () => {
    const fam = getDeviceFamily(hass, K);
    expect(fam.deviceIds.size).toBe(5);
    expect(fam.rootDeviceId).toBe('4c7365434819d3fcf1f13559a96debf4');
    expect(fam.entities.some((e) => e.entity_id === 'sensor.keuken_airco_luchtvochtigheid')).toBe(true);
    expect(fam.entities.some((e) => e.entity_id === K)).toBe(false);
  });

  it('does not leak sensors of other units', () => {
    expect(getDeviceFamily(hass, K).entities.every((e) => !e.entity_id.includes('slaapkamer'))).toBe(true);
  });

  it('survives via_device cycles', () => {
    const cyc = mergeFixtures(keuken);
    cyc.devices['4c7365434819d3fcf1f13559a96debf4'] = {
      ...cyc.devices['4c7365434819d3fcf1f13559a96debf4'],
      via_device_id: 'a3ef3030617250741956879f2e04c609',
    };
    expect(getDeviceFamily(makeHass(cyc), K).deviceIds.size).toBe(5);
  });

  it('is empty for an entity without a device', () => {
    const f = emptyFixture();
    f.states['climate.x'] = { entity_id: 'climate.x', state: 'off', attributes: {} };
    expect(getDeviceFamily(makeHass(f), 'climate.x').deviceIds.size).toBe(0);
  });

  it('does not throw when entities or devices are missing', () => {
    const bare = { states: {}, config: { unit_system: { temperature: '°C' } }, callService: () => undefined } as unknown as HomeAssistant;
    expect(() => getDeviceFamily(bare, 'climate.x')).not.toThrow();
    expect(() => detectSensors(bare, 'climate.x')).not.toThrow();
    expect(() => suggestRoomSensors(bare, 'climate.x')).not.toThrow();
  });
});

describe('device family parent', () => {
  function hubFixture(climateChildren: number) {
    const f = emptyFixture();
    f.devices['hub'] = { id: 'hub', name: 'Hub', via_device_id: null };
    f.entities['sensor.hub_humidity'] = { entity_id: 'sensor.hub_humidity', platform: 'x', device_id: 'hub' };
    f.states['sensor.hub_humidity'] = { entity_id: 'sensor.hub_humidity', state: '40', attributes: { device_class: 'humidity' } };
    for (let i = 1; i <= climateChildren; i++) {
      f.devices[`c${i}`] = { id: `c${i}`, name: `Zone ${i}`, via_device_id: 'hub' };
      f.entities[`climate.z${i}`] = { entity_id: `climate.z${i}`, platform: 'x', device_id: `c${i}` };
      f.states[`climate.z${i}`] = { entity_id: `climate.z${i}`, state: 'off', attributes: {} };
    }
    return makeHass(f);
  }

  it('includes the parent when the climate entity sits on a child device', () => {
    const fam = getDeviceFamily(hubFixture(1), 'climate.z1');
    expect(fam.deviceIds.has('hub')).toBe(true);
    expect(fam.entities.map((e) => e.entity_id)).toContain('sensor.hub_humidity');
  });

  it('stops at the climate device when the parent hub has several climate children', () => {
    const fam = getDeviceFamily(hubFixture(2), 'climate.z1');
    expect(fam.deviceIds.has('hub')).toBe(false);
    expect(fam.deviceIds.has('c2')).toBe(false);
  });
});

describe('runtime detection (no registry): device_class, unit, translation_key only', () => {
  it('finds humidity and problem sensors on the Keuken family', () => {
    const d = detectSensors(hass, K);
    expect(d.humidity?.entity_id).toBe('sensor.keuken_airco_luchtvochtigheid');
    expect(d.humidity?.source).toBe('Keuken Airco regeling');
    expect(d.deviceCount).toBe(5);
    expect(d.usedRegistry).toBe(false);
    expect(d.health.map((h) => h.entity_id)).toContain('binary_sensor.keuken_airco_buitenunit_is_in_error_state');
  });

  it('leaves ambiguous roles empty instead of guessing from entity ids', () => {
    const d = detectSensors(hass, K);
    // Two temperature sensors, no translation key: which is outdoor is not knowable.
    expect(d.outdoor).toBeNull();
    expect(d.unitTemperature).toBeNull();
    // Daikin cloud limit has no device class or translation key.
    expect(d.cloudLimit).toBeNull();
    // Energy sensors are found by device class but carry no kind or period.
    expect(d.energy).toHaveLength(8);
    expect(d.energy.every((e) => e.kind === null && e.period === null)).toBe(true);
  });

  it('never reads entity ids or names', () => {
    const f = mergeFixtures(keuken);
    const rename = (from: string, to: string) => {
      f.states[to] = { ...f.states[from], entity_id: to };
      f.entities[to] = { ...f.entities[from], entity_id: to };
      delete f.states[from];
      delete f.entities[from];
    };
    rename('sensor.keuken_airco_buitentemperatuur', 'sensor.outdoor_temperature');
    rename('sensor.keuken_airco_temperatuur', 'sensor.x1');
    expect(detectSensors(makeHass(f), K).outdoor).toBeNull();
    for (const e of Object.values(f.entities)) e.name = 'Outdoor temperature';
    expect(detectSensors(makeHass(f), K).outdoor).toBeNull();
  });

  it('uses translation_key when present', () => {
    const f = mergeFixtures(keuken);
    f.entities['sensor.keuken_airco_buitentemperatuur'].translation_key = 'outdoor_temperature';
    f.entities['sensor.keuken_airco_temperatuur'].translation_key = 'room_temperature';
    const d = detectSensors(makeHass(f), K);
    expect(d.outdoor?.entity_id).toBe('sensor.keuken_airco_buitentemperatuur');
    expect(d.unitTemperature?.entity_id).toBe('sensor.keuken_airco_temperatuur');
  });

  it('leaves humidity empty when two sensors compete', () => {
    const f = mergeFixtures(keuken);
    f.entities['sensor.second_humidity'] = { ...f.entities['sensor.keuken_airco_luchtvochtigheid'], entity_id: 'sensor.second_humidity' };
    f.states['sensor.second_humidity'] = { entity_id: 'sensor.second_humidity', state: '50', attributes: { device_class: 'humidity' } };
    expect(detectSensors(makeHass(f), K).humidity).toBeNull();
  });
});

describe('editor detection with the full registry (unique_id and original_name)', () => {
  const d = (id: string) => detectSensors(hass, id, reg);

  it('finds every role on the Keuken unit', () => {
    const k = d(K);
    expect(k.usedRegistry).toBe(true);
    expect(k.humidity?.entity_id).toBe('sensor.keuken_airco_luchtvochtigheid');
    expect(k.outdoor?.entity_id).toBe('sensor.keuken_airco_buitentemperatuur');
    expect(k.unitTemperature?.entity_id).toBe('sensor.keuken_airco_temperatuur');
    expect(k.cloudLimit?.entity_id).toBe('sensor.keuken_airco_gateway_ratelimit_remaining_day');
    expect(k.cloudLimit?.source).toBe('Keuken Airco gateway');
  });

  it('flags the whole-degree unit sensor', () => {
    expect(d(K).unitTemperature?.wholeDegrees).toBe(true);
  });

  it('classifies the 8 energy sensors by kind and period', () => {
    const k = d(K);
    expect(k.energy).toHaveLength(8);
    const keys = k.energy.map((e) => `${e.kind}/${e.period}`).sort();
    expect(keys).toEqual(['heating', 'cooling'].flatMap((a) => ['day', 'week', 'month', 'year'].map((p) => `${a}/${p}`)).sort());
  });

  it('counts only error, warning and caution states and error codes as health on Onecta', () => {
    const ids = d(K).health.map((h) => h.entity_id);
    expect(ids).toContain('binary_sensor.keuken_airco_buitenunit_is_in_error_state');
    expect(ids).toContain('binary_sensor.keuken_airco_gateway_is_in_error_state');
    expect(ids).toContain('binary_sensor.keuken_airco_is_in_caution_state');
    expect(ids).toContain('sensor.keuken_airco_error_code');
    expect(ids).toContain('sensor.keuken_airco_buitenunit_error_code');
    expect(ids).toContain('sensor.keuken_airco_gateway_error_code');
    expect(ids).not.toContain('binary_sensor.keuken_airco_is_in_mode_conflict');
    expect(ids).not.toContain('binary_sensor.keuken_airco_gateway_is_firmware_update_supported');
    expect(ids).toHaveLength(10);
  });

  it('resolves renamed entities from unique_id, not from the id', () => {
    const f = mergeFixtures(keuken);
    const to = 'sensor.zzz_outdoor';
    const from = 'sensor.keuken_airco_buitentemperatuur';
    f.states[to] = { ...f.states[from], entity_id: to };
    f.entities[to] = { ...f.entities[from], entity_id: to };
    f.registry[to] = f.registry[from];
    delete f.states[from];
    delete f.entities[from];
    delete f.registry[from];
    expect(detectSensors(makeHass(f), K, f.registry).outdoor?.entity_id).toBe(to);
  });

  it('has no humidity on Slaapkamer, but the rest is found', () => {
    const s = d('climate.slaapkamer_airco');
    expect(s.humidity).toBeNull();
    expect(s.outdoor).not.toBeNull();
    expect(s.cloudLimit).not.toBeNull();
    expect(s.energy).toHaveLength(8);
  });
});

describe('detection on a generic fixture', () => {
  it('uses device_class only, with no Daikin extras', () => {
    const d = detectSensors(hass, 'climate.dual_setpoint', reg);
    expect(d.humidity?.entity_id).toBe('sensor.dual_setpoint_humidity');
    expect(d.health.map((h) => h.entity_id)).toEqual(['binary_sensor.dual_setpoint_problem']);
    expect(d.cloudLimit).toBeNull();
    expect(d.energy).toEqual([]);
    expect(d.outdoor).toBeNull();
  });

  it('finds nothing for a bare climate entity', () => {
    const d = detectSensors(makeHass(noFan), 'climate.no_fan');
    expect(d.humidity).toBeNull();
    expect(d.health).toEqual([]);
    expect(d.deviceCount).toBe(1);
  });
});

describe('whole degree detection', () => {
  it('flags integer states and display_precision 0', () => {
    expect(isWholeDegrees('21')).toBe(true);
    expect(isWholeDegrees('21.5')).toBe(false);
    expect(isWholeDegrees('21.5', 0)).toBe(true);
    expect(isWholeDegrees('unavailable')).toBe(false);
  });
});

describe('room sensor suggestions', () => {
  it('suggests temperature sensors in the same area outside the family', () => {
    const f = mergeFixtures(keuken);
    f.devices['room'] = { id: 'room', name: 'Thermometer', area_id: 'keuken' };
    f.entities['sensor.woonkamer_temperatuur'] = { entity_id: 'sensor.woonkamer_temperatuur', platform: 'zha', device_id: 'room' };
    f.states['sensor.woonkamer_temperatuur'] = { entity_id: 'sensor.woonkamer_temperatuur', state: '17.3', attributes: { device_class: 'temperature' } };
    expect(suggestRoomSensors(makeHass(f), K)).toEqual(['sensor.woonkamer_temperatuur']);
  });
});

describe('numeric and energy states', () => {
  it('treats an empty or blank state as unavailable, not zero', () => {
    const f = mergeFixtures(keuken);
    f.states['sensor.keuken_airco_gateway_error_code'].state = '';
    f.states['sensor.keuken_airco_gateway_ssid'].state = '   ';
    const h = makeHass(f);
    expect(numericState(h, 'sensor.keuken_airco_gateway_error_code')).toBeNull();
    expect(numericState(h, 'sensor.keuken_airco_gateway_ssid')).toBeNull();
    expect(numericState(h, 'sensor.keuken_airco_temperatuur')).toBe(21);
    expect(numericState(h, 'sensor.missing')).toBeNull();
  });

  it('converts Wh and MWh to kWh and rejects other units', () => {
    const f = emptyFixture();
    const add = (id: string, state: string, unit?: string) => {
      f.states[id] = { entity_id: id, state, attributes: unit ? { unit_of_measurement: unit } : {} };
    };
    add('sensor.a', '1500', 'Wh');
    add('sensor.b', '2', 'kWh');
    add('sensor.c', '0.003', 'MWh');
    add('sensor.d', '7', 'W');
    add('sensor.e', '7');
    const h = makeHass(f);
    expect(energyKWh(h, 'sensor.a')).toBeCloseTo(1.5);
    expect(energyKWh(h, 'sensor.b')).toBe(2);
    expect(energyKWh(h, 'sensor.c')).toBeCloseTo(3);
    expect(energyKWh(h, 'sensor.d')).toBeNull();
    expect(energyKWh(h, 'sensor.e')).toBeNull();
  });

  it('sums mixed units into kWh in the info row', () => {
    const f = mergeFixtures(keuken);
    f.states['sensor.keuken_airco_energie_verwarmen_dag'].attributes.unit_of_measurement = 'Wh';
    f.states['sensor.keuken_airco_energie_verwarmen_dag'].state = '2900';
    f.states['sensor.keuken_airco_energie_koelen_dag'].state = '0.5';
    const h = makeHass(f);
    const cfg = materializeConfig(defaultConfig(K), detectSensors(h, K, f.registry));
    expect(resolveSensors(h, cfg, detectSensors(h, K)).info.find((i) => i.key === 'energy')?.value).toBe('3.4');
  });
});

describe('materialising auto into concrete ids', () => {
  it('writes the detected ids, so the card works without the registry', () => {
    const cfg = materializeConfig(defaultConfig(K), detectSensors(hass, K, reg));
    expect(cfg.sensors.humidity).toBe('sensor.keuken_airco_luchtvochtigheid');
    expect(cfg.sensors.outdoor).toBe('sensor.keuken_airco_buitentemperatuur');
    expect(cfg.sensors.cloud_limit).toBe('sensor.keuken_airco_gateway_ratelimit_remaining_day');
    expect(cfg.sensors.energy).toEqual(['sensor.keuken_airco_energie_koelen_dag', 'sensor.keuken_airco_energie_verwarmen_dag']);
    expect(cfg.sensors.health).toHaveLength(10);
  });

  it('keeps false and overrides, and leaves unresolved roles on auto', () => {
    const base = defaultConfig('climate.slaapkamer_airco');
    base.sensors.outdoor = false;
    base.sensors.cloud_limit = 'sensor.mine';
    const cfg = materializeConfig(base, detectSensors(hass, 'climate.slaapkamer_airco', reg));
    expect(cfg.sensors.outdoor).toBe(false);
    expect(cfg.sensors.cloud_limit).toBe('sensor.mine');
    expect(cfg.sensors.humidity).toBe('auto');
  });

  it('gives the right info row at runtime from the concrete config alone', () => {
    const cfg = materializeConfig(defaultConfig(K), detectSensors(hass, K, reg));
    const runtime = resolveSensors(hass, cfg, detectSensors(hass, K));
    expect(runtime.info.map((i) => [i.key, i.value])).toEqual([
      ['humidity', '45'],
      ['outdoor', '14'],
      ['energy', '2.9'],
      ['cloud_limit', '145'],
    ]);
  });
});

describe('resolving sensors with config', () => {
  const cfg = defaultConfig(K);

  it('hides roles set to false and respects overrides', () => {
    const c = { ...cfg, sensors: { ...cfg.sensors, humidity: false as const, outdoor: 'sensor.keuken_airco_temperatuur' } };
    const r = resolveSensors(hass, c, detectSensors(hass, c.entity));
    expect(r.info.find((i) => i.key === 'humidity')).toBeUndefined();
    expect(r.info.find((i) => i.key === 'outdoor')?.value).toBe('21');
  });

  it('lets temperature_sensor override the room temperature', () => {
    const f = mergeFixtures(keuken);
    f.states['sensor.room'] = { entity_id: 'sensor.room', state: '17.3', attributes: {} };
    const h = makeHass(f);
    const c = { ...cfg, temperature_sensor: 'sensor.room' };
    const r = resolveSensors(h, c, detectSensors(h, c.entity));
    expect(r.roomTemperature).toBe(17.3);
    expect(r.watched).toContain('sensor.room');
    expect(resolveSensors(h, cfg, detectSensors(h, cfg.entity)).roomTemperature).toBe(21);
  });

  it('falls back to the entity room temperature when the override is empty', () => {
    const f = mergeFixtures(keuken);
    f.states['sensor.room'] = { entity_id: 'sensor.room', state: '', attributes: {} };
    const h = makeHass(f);
    expect(resolveSensors(h, { ...cfg, temperature_sensor: 'sensor.room' }, detectSensors(h, cfg.entity)).roomTemperature).toBe(21);
  });

  it('reports a raised problem flag, with non-zero error codes as detail', () => {
    const f = mergeFixtures(keuken);
    f.states['binary_sensor.keuken_airco_buitenunit_is_in_error_state'].state = 'on';
    f.states['sensor.keuken_airco_gateway_error_code'].state = 'E7-01';
    const h = makeHass(f);
    const c = materializeConfig(cfg, detectSensors(h, cfg.entity, f.registry));
    const r = resolveSensors(h, c, detectSensors(h, c.entity));
    expect(r.problems.map((p) => p.entity_id)).toEqual(['binary_sensor.keuken_airco_buitenunit_is_in_error_state']);
    expect(r.problems[0].source).toBe('Keuken Airco buitenunit');
    expect(r.problems[0].detail).toContain('E7-01');
  });

  it('warns when cloud calls are nearly exhausted', () => {
    const f = mergeFixtures(slaapkamer);
    f.states['sensor.slaapkamer_airco_gateway_ratelimit_remaining_day'].state = '12';
    const h = makeHass(f);
    const c = materializeConfig(defaultConfig('climate.slaapkamer_airco'), detectSensors(h, 'climate.slaapkamer_airco', f.registry));
    expect(resolveSensors(h, c, detectSensors(h, c.entity)).info.find((i) => i.key === 'cloud_limit')?.warn).toBe(true);
  });

  it('falls back to the climate current_humidity attribute', () => {
    const h = makeHass(dualSetpoint);
    const c = defaultConfig('climate.dual_setpoint');
    const r = resolveSensors(h, c, { ...detectSensors(h, c.entity), humidity: null });
    expect(r.info[0]).toMatchObject({ key: 'humidity', value: '48' });
  });
});

describe('health: problem flags decide, error codes only add detail', () => {
  const concrete = (f: ReturnType<typeof mergeFixtures>, id: string) => {
    const h = makeHass(f);
    const c = materializeConfig(defaultConfig(id), detectSensors(h, id, f.registry));
    return resolveSensors(h, c, detectSensors(h, id));
  };

  it('shows no problem on Slaapkamer and Nagelsalon when every flag is off, whatever the error code says', () => {
    for (const id of ['climate.slaapkamer_airco', 'climate.nagelsalon_airco']) {
      const f = mergeFixtures(allFixtures);
      expect(f.states[`sensor.${id.slice(8)}_error_code`].state).toBe('U0-00');
      expect(concrete(f, id).problems).toEqual([]);
    }
  });

  it('reports a problem when a flag is on, with the error codes as detail', () => {
    const f = mergeFixtures(allFixtures);
    f.states['binary_sensor.slaapkamer_airco_buitenunit_is_in_error_state'].state = 'on';
    f.states['sensor.slaapkamer_airco_buitenunit_error_code'].state = 'E7-01';
    const r = concrete(f, 'climate.slaapkamer_airco');
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatchObject({ entity_id: 'binary_sensor.slaapkamer_airco_buitenunit_is_in_error_state', source: 'Slaapkamer Airco buitenunit' });
    expect(r.problems[0].detail).toContain('E7-01');
  });

  it('falls back to error codes as the trigger only when the family has no problem flags', () => {
    const f = mergeFixtures(allFixtures);
    for (const id of Object.keys(f.states)) if (id.startsWith('binary_sensor.slaapkamer_airco')) delete f.states[id];
    f.states['sensor.slaapkamer_airco_error_code'].state = 'A6-01';
    const r = concrete(f, 'climate.slaapkamer_airco');
    expect(r.problems.map((p) => p.entity_id)).toEqual(['sensor.slaapkamer_airco_error_code']);
  });
});

describe('registry fetch', () => {
  const entry = (entity_id: string, unique_id: string | null, original_name = 'N') => ({ entity_id, unique_id, original_name });
  const mk = (handlers: Record<string, (m: any) => unknown>): HomeAssistant =>
    ({
      callWS: async (m: any) => {
        const h = handlers[m.type];
        if (!h) throw new Error('unknown command');
        return h(m);
      },
    }) as unknown as HomeAssistant;

  it('uses the full list when it carries unique_ids', async () => {
    const h = mk({ 'config/entity_registry/list': () => [entry('sensor.a', 'u1'), entry('sensor.z', 'u9')] });
    expect(await fetchRegistry(h, ['sensor.a'])).toEqual({ 'sensor.a': { unique_id: 'u1', original_name: 'N' } });
  });

  it('re-fetches entries the list returned without a unique_id', async () => {
    const h = mk({
      'config/entity_registry/list': () => [entry('sensor.a', null)],
      'config/entity_registry/get_entries': (m) => Object.fromEntries(m.entity_ids.map((id: string) => [id, entry(id, 'u2')])),
    });
    expect((await fetchRegistry(h, ['sensor.a']))['sensor.a'].unique_id).toBe('u2');
  });

  it('falls back to per-entity reads and survives a non-admin user', async () => {
    const h = mk({ 'config/entity_registry/get': (m) => entry(m.entity_id, `u-${m.entity_id}`) });
    expect((await fetchRegistry(h, ['sensor.a', 'sensor.b']))['sensor.b'].unique_id).toBe('u-sensor.b');
    expect(await fetchRegistry(mk({}), ['sensor.a'])).toEqual({});
    expect(await fetchRegistry({} as HomeAssistant, ['sensor.a'])).toEqual({});
  });
});
