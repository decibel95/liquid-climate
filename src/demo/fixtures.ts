import type { RegistryExtra } from '../detect/roles';
import type { HassArea, HassDevice, HassEntity, HassEntityRegistryEntry, HassFloor, HomeAssistant } from '../types';

/**
 * Registry fixtures. The three Daikin Onecta units mirror the structure of a real
 * install, read-only, on 2026-11-13: the climate device holds only climate.* and a
 * refresh button, everything else lives on child devices linked with via_device_id.
 * Device ids, entity ids and the climate attributes are real. Sensor readings
 * other than the Keuken ones are illustrative. translation_key is null because
 * the integration does not set one on these entities.
 */
export interface Fixture {
  states: Record<string, HassEntity>;
  entities: Record<string, HassEntityRegistryEntry>;
  devices: Record<string, HassDevice>;
  /** Full-registry extras (unique_id, original_name) that only the editor can fetch. */
  registry: Record<string, RegistryExtra>;
}

export function emptyFixture(): Fixture {
  return { states: {}, entities: {}, devices: {}, registry: {} };
}

export function mergeFixtures(...list: Fixture[]): Fixture {
  const out = emptyFixture();
  // Deep copies, so tests that tweak a merged fixture never leak into the originals.
  for (const f of list.map((x) => structuredClone(x))) {
    Object.assign(out.states, f.states);
    Object.assign(out.entities, f.entities);
    Object.assign(out.devices, f.devices);
    Object.assign(out.registry, f.registry);
  }
  return out;
}

export function addDevice(f: Fixture, d: HassDevice) {
  f.devices[d.id] = d;
}

export function addEntity(
  f: Fixture,
  entity_id: string,
  state: string,
  attributes: Record<string, unknown>,
  reg: Partial<HassEntityRegistryEntry> & { platform: string },
  extra?: RegistryExtra,
) {
  f.states[entity_id] = { entity_id, state, attributes };
  f.entities[entity_id] = { entity_id, translation_key: null, ...reg };
  if (extra) f.registry[entity_id] = extra;
}

const DAIKIN_CLIMATE_ATTRS = {
  hvac_modes: ['off', 'fan_only', 'heat', 'cool', 'heat_cool', 'dry'],
  min_temp: 10,
  max_temp: 30,
  target_temp_step: 0.5,
  fan_modes: ['auto', 'quiet', '1', '2', '3', '4', '5'],
  preset_modes: ['away', 'boost', 'none'],
  swing_modes: ['stop', 'swing', 'windnice'],
  swing_horizontal_modes: ['stop', 'swing'],
  temperature_unit: '°C',
  fan_mode: '2',
  preset_mode: 'none',
  swing_mode: 'stop',
  swing_horizontal_mode: 'stop',
  supported_features: 953,
};

interface DaikinSpec {
  slug: string;
  uuid: string;
  title: string;
  area: string;
  ids: { climate: string; regeling: string; gateway: string; buiten: string; binnen: string };
  state: string;
  target: number;
  room: number;
  outdoor: number;
  /** The real Keuken unit exposes room humidity, the other two do not. */
  humidity: number | null;
  energyHeatDay: number;
  energyCoolDay: number;
  rateLimit: number;
  /** State of the regeling error code sensor. The real Slaapkamer and Nagelsalon report U0-00 while healthy. */
  errorCode?: string;
}

function daikin(s: DaikinSpec): Fixture {
  const f = emptyFixture();
  const p = { platform: 'daikin_onecta' };
  const base = `${s.slug}_airco`;
  addDevice(f, { id: s.ids.climate, name: `${s.title} Airco`, manufacturer: 'Daikin', model: 'BRP069C4x', via_device_id: null, area_id: s.area });
  addDevice(f, { id: s.ids.regeling, name: `${s.title} Airco regeling`, manufacturer: 'Daikin', via_device_id: s.ids.climate, area_id: s.area });
  addDevice(f, { id: s.ids.gateway, name: `${s.title} Airco gateway`, manufacturer: 'Daikin', model: 'BRP069C4x', via_device_id: s.ids.climate, area_id: s.area });
  addDevice(f, { id: s.ids.buiten, name: `${s.title} Airco buitenunit`, manufacturer: 'Daikin', model: '3MXM68A2V1B9', via_device_id: s.ids.climate, area_id: 'achtertuin' });
  addDevice(f, { id: s.ids.binnen, name: `${s.title} Airco binnenunit`, manufacturer: 'Daikin', via_device_id: s.ids.climate, area_id: s.area });

  addEntity(f, `climate.${base}`, s.state, { ...DAIKIN_CLIMATE_ATTRS, friendly_name: `${s.title} Airco`, current_temperature: Math.round(s.room), temperature: s.target }, { ...p, device_id: s.ids.climate }, { unique_id: `${s.uuid}_climateControl`, original_name: 'Room Temperature' });
  addEntity(f, `button.${base}_refresh`, 'unknown', {}, { ...p, device_id: s.ids.climate });

  // Entity ids are Dutch and user renamed on the real install. unique_id and
  // original_name are what Onecta registers, so detection must not read the ids.
  const u = (suffix: string, name: string) => ({ unique_id: `${s.uuid}_${suffix}`, original_name: name });
  const reg = { ...p, device_id: s.ids.regeling };
  const temp = { device_class: 'temperature', unit_of_measurement: '°C', state_class: 'measurement' };
  addEntity(f, `sensor.${base}_temperatuur`, String(Math.round(s.room)), temp, reg, u('climateControl_sensory_data_roomTemperature', 'Room temperature'));
  addEntity(f, `sensor.${base}_buitentemperatuur`, String(s.outdoor), temp, reg, u('climateControl_sensory_data_outdoorTemperature', 'Outdoor temperature'));
  if (s.humidity != null) {
    addEntity(f, `sensor.${base}_luchtvochtigheid`, String(s.humidity), { device_class: 'humidity', unit_of_measurement: '%', state_class: 'measurement' }, reg, u('climateControl_sensory_data_roomHumidity', 'Room humidity'));
  }
  for (const [nl, en, day] of [['verwarmen', 'heating', s.energyHeatDay], ['koelen', 'cooling', s.energyCoolDay]] as const) {
    for (const [nlp, enp, v] of [['dag', 'daily', day], ['week', 'weekly', day * 9], ['maand', 'monthly', day * 30], ['jaar', 'yearly', day * 365]] as const) {
      addEntity(
        f, `sensor.${base}_energie_${nl}_${nlp}`, String(Number(v.toFixed(1))),
        { device_class: 'energy', unit_of_measurement: 'kWh', state_class: 'total_increasing' }, reg,
        u(`climateControl_electrical_${en}_${enp}_consumption`, `${en[0].toUpperCase()}${en.slice(1)} ${enp} electrical consumption`),
      );
    }
  }
  const problem = { device_class: 'problem' };
  addEntity(f, `sensor.${base}_error_code`, s.errorCode ?? '00-00', {}, reg, u('climateControl_errorCode', 'Error code'));
  for (const [k, K] of [['caution', 'Caution'], ['error', 'Error'], ['warning', 'Warning']]) {
    addEntity(f, `binary_sensor.${base}_is_in_${k}_state`, 'off', problem, reg, u(`climateControl_isIn${K}State`, `Is in ${k} state`));
  }
  addEntity(f, `binary_sensor.${base}_is_in_mode_conflict`, 'off', problem, reg, u('climateControl_isInModeConflict', 'Is in mode conflict'));
  addEntity(f, `binary_sensor.${base}_is_holiday_mode_active`, 'off', {}, reg, u('climateControl_isHolidayModeActive', 'Is holiday mode active'));
  addEntity(f, `select.${base}_schedule`, 'none', {}, reg);

  const gw = { ...p, device_id: s.ids.gateway };
  addEntity(f, `sensor.${base}_gateway_ratelimit_remaining_day`, String(s.rateLimit), { state_class: 'measurement' }, gw, u('rate_limit_remaining_day', 'Ratelimit remaining day'));
  addEntity(f, `sensor.${base}_gateway_error_code`, '', {}, gw, u('gateway_errorCode', 'Error code'));
  addEntity(f, `sensor.${base}_gateway_ip_address`, '192.0.2.80', {}, gw, u('gateway_ipAddress', 'IP address'));
  addEntity(f, `sensor.${base}_gateway_ssid`, 'DaikinAP00000', {}, gw, u('gateway_ssid', 'SSID'));
  addEntity(f, `binary_sensor.${base}_gateway_is_in_error_state`, 'off', problem, gw, u('gateway_isInErrorState', 'Is in error state'));
  addEntity(f, `binary_sensor.${base}_gateway_is_firmware_update_supported`, 'on', {}, gw, u('gateway_isFirmwareUpdateSupported', 'Is firmware update supported'));

  const ou = { ...p, device_id: s.ids.buiten };
  addEntity(f, `sensor.${base}_buitenunit_error_code`, '00-00', {}, ou, u('outdoorUnit_errorCode', 'Error code'));
  for (const [k, K] of [['caution', 'Caution'], ['error', 'Error'], ['warning', 'Warning']]) {
    addEntity(f, `binary_sensor.${base}_buitenunit_is_in_${k}_state`, 'off', problem, ou, u(`outdoorUnit_isIn${K}State`, `Is in ${k} state`));
  }
  addEntity(f, `update.${base}_buitenunit_firmware_update`, 'off', {}, ou);
  addEntity(f, `update.${base}_binnenunit_firmware_update`, 'off', {}, { ...p, device_id: s.ids.binnen });
  return f;
}

export const keuken = daikin({
  slug: 'keuken', uuid: '3f1c9a52-8d47-4b6e-a0f3-5c2e7b9d1a64', title: 'Keuken', area: 'keuken',
  ids: { climate: '4c7365434819d3fcf1f13559a96debf4', regeling: 'a3ef3030617250741956879f2e04c609', gateway: '8d4edfc06b6737196cb22a6914d85e60', buiten: '5e7fac9c30764d582f4c540fb5cb3e55', binnen: 'ce6c9b5baa33cc8e61791dd10d17eed2' },
  state: 'heat', target: 19.5, room: 21, outdoor: 14, humidity: 45, energyHeatDay: 2.9, energyCoolDay: 0, rateLimit: 145,
});

export const slaapkamer = daikin({
  slug: 'slaapkamer', uuid: '00000000-0000-4000-8000-000000000002', title: 'Slaapkamer', area: 'slaapkamer',
  ids: { climate: '5cc34e4a9346673ff7981c5e75560b87', regeling: 'c3c220701470dcb6820a9a254b6167c8', gateway: '0b85144e2536197094282bdf3acd94a9', buiten: '1fcb7c4979013f852007a3f22cb77850', binnen: '56a06131f9fb25d041c93300bbfa241e' },
  state: 'cool', target: 21, room: 24, outdoor: 14, humidity: null, energyHeatDay: 0, energyCoolDay: 1.4, rateLimit: 145, errorCode: 'U0-00',
});

export const nagelsalon = daikin({
  slug: 'nagelsalon', uuid: '00000000-0000-4000-8000-000000000003', title: 'Nagelsalon', area: 'nagelsalon',
  ids: { climate: '6593e34cab79266e57f32b0d18085b60', regeling: 'f1cc1f416168a95d4cf808cb57666821', gateway: '3aa93843b2bb08db920faf41794ed1d5', buiten: 'a1a005722b4627bb39ebe340b57a9728', binnen: 'd8df0919bbaeb47f24da2fbf4c84f11f' },
  state: 'off', target: 21, room: 24, outdoor: 14, humidity: null, energyHeatDay: 0.6, energyCoolDay: 0, rateLimit: 145, errorCode: 'U0-00',
});

/** Generic (non-Daikin) fixtures. Each has one climate entity on its own device. */
function generic(
  id: string,
  deviceId: string,
  attrs: Record<string, unknown>,
  state: string,
  extra?: (f: Fixture) => void,
): Fixture {
  const f = emptyFixture();
  addDevice(f, { id: deviceId, name: id, manufacturer: 'Fixture', area_id: 'lab' });
  addEntity(f, `climate.${id}`, state, { friendly_name: id, ...attrs }, { platform: 'demo', device_id: deviceId });
  extra?.(f);
  return f;
}

export const dualSetpoint = generic(
  'dual_setpoint', 'dev_dual',
  {
    hvac_modes: ['off', 'heat', 'cool', 'heat_cool'], min_temp: 7, max_temp: 35, target_temp_step: 0.5,
    temperature_unit: '°C', current_temperature: 21.4, current_humidity: 48,
    temperature: null, target_temp_low: 19, target_temp_high: 24,
    fan_modes: ['auto', 'low', 'medium', 'high'], fan_mode: 'auto',
    supported_features: 1 | 2 | 8 | 128 | 256,
  },
  'heat_cool',
  (f) => {
    addEntity(f, 'sensor.dual_setpoint_humidity', '51', { device_class: 'humidity', unit_of_measurement: '%' }, { platform: 'demo', device_id: 'dev_dual' });
    addEntity(f, 'binary_sensor.dual_setpoint_problem', 'off', { device_class: 'problem' }, { platform: 'demo', device_id: 'dev_dual' });
  },
);

export const noFan = generic(
  'no_fan', 'dev_nofan',
  {
    hvac_modes: ['off', 'heat'], min_temp: 5, max_temp: 30, target_temp_step: 0.5,
    temperature_unit: '°C', current_temperature: 18.2, temperature: 20,
    // fan_modes listed but the feature flag is absent: must stay hidden.
    fan_modes: ['low', 'high'], fan_mode: 'low',
    supported_features: 1 | 128 | 256,
  },
  'heat',
);

export const noSwing = generic(
  'no_swing', 'dev_noswing',
  {
    hvac_modes: ['off', 'cool', 'fan_only', 'dry'], min_temp: 16, max_temp: 30, target_temp_step: 1,
    temperature_unit: '°C', current_temperature: 25, temperature: 23,
    fan_modes: ['low', 'medium', 'high'], fan_mode: 'medium',
    supported_features: 1 | 8 | 128 | 256,
  },
  'cool',
);

export const fahrenheit = generic(
  'fahrenheit', 'dev_f',
  {
    hvac_modes: ['off', 'heat', 'cool', 'heat_cool'], min_temp: 45, max_temp: 95, target_temp_step: 1,
    temperature_unit: '°F', current_temperature: 70, temperature: 72,
    fan_modes: ['auto', 'low', 'high'], fan_mode: 'auto',
    preset_modes: ['home', 'away', 'eco'], preset_mode: 'home',
    supported_features: 1 | 8 | 16 | 128 | 256,
  },
  'heat',
);

export const step1 = generic(
  'step_one', 'dev_step1',
  {
    hvac_modes: ['off', 'heat', 'cool'], min_temp: 15, max_temp: 28, target_temp_step: 1,
    temperature_unit: '°C', current_temperature: 20, temperature: 21,
    supported_features: 1 | 128 | 256,
  },
  'cool',
);

export const allFixtures = mergeFixtures(keuken, slaapkamer, nagelsalon, dualSetpoint, noFan, noSwing, fahrenheit, step1);

export const CLIMATE_IDS = Object.keys(allFixtures.states).filter((id) => id.startsWith('climate.'));

/**
 * Water heaters and humidifiers of Home Assistant's demo integration (demo/water_heater.py and
 * demo/humidifier.py). The metric attributes were read from a test Home Assistant running the demo
 * integration on 2026-11-17. The imperial ones follow from them: Demo Water Heater is Fahrenheit
 * natively (119 F, limits 110 to 140 F, the water heater defaults), Demo Water Heater Celsius is
 * 45 C, shown as 113 F. Neither reports current_temperature. The entities have no device.
 */
export const APPLIANCE_IDS = {
  waterHeater: 'water_heater.demo_water_heater',
  waterHeaterCelsius: 'water_heater.demo_water_heater_celsius',
  humidifier: 'humidifier.humidifier',
  dehumidifier: 'humidifier.dehumidifier',
  hygrostat: 'humidifier.hygrostat',
} as const;

export function appliances(system: '°C' | '°F' = '°C'): Fixture {
  const f = emptyFixture();
  const reg = { platform: 'demo', device_id: null };
  const metric = system === '°C';
  const operation_list = ['eco', 'electric', 'performance', 'high_demand', 'heat_pump', 'gas', 'off'];
  // TARGET_TEMPERATURE | OPERATION_MODE | AWAY_MODE | ON_OFF
  const heater = { target_temp_step: 1, operation_list, current_temperature: null, target_temp_high: null, target_temp_low: null, operation_mode: 'eco', supported_features: 15 };
  const limits = metric ? { min_temp: 43.3, max_temp: 60, temperature_unit: '°C' } : { min_temp: 110, max_temp: 140, temperature_unit: '°F' };
  addEntity(f, APPLIANCE_IDS.waterHeater, 'eco', { ...limits, ...heater, temperature: metric ? 48.3 : 119, away_mode: 'off', friendly_name: 'Demo Water Heater' }, reg);
  addEntity(f, APPLIANCE_IDS.waterHeaterCelsius, 'eco', { ...limits, ...heater, temperature: metric ? 45 : 113, away_mode: 'on', friendly_name: 'Demo Water Heater Celsius' }, reg);
  addEntity(f, APPLIANCE_IDS.humidifier, 'on', { min_humidity: 0, max_humidity: 100, target_humidity_step: 5, action: 'humidifying', current_humidity: 45, humidity: 65, device_class: 'humidifier', friendly_name: 'Humidifier', supported_features: 0 }, reg);
  addEntity(f, APPLIANCE_IDS.dehumidifier, 'on', { min_humidity: 0, max_humidity: 100, action: 'drying', current_humidity: 59.4, humidity: 54.2, device_class: 'dehumidifier', friendly_name: 'Dehumidifier', supported_features: 0 }, reg);
  addEntity(f, APPLIANCE_IDS.hygrostat, 'on', { min_humidity: 0, max_humidity: 100, available_modes: ['home', 'eco'], humidity: 50, mode: 'home', friendly_name: 'Hygrostat', supported_features: 1 }, reg);
  return f;
}

/** What the editor gets from the websocket registry for a fixture. */
export const registryOf = (f: Fixture) => f.registry;

export function makeHass(
  fixture: Fixture,
  unit = '°C',
  callService: HomeAssistant['callService'] = () => undefined,
): HomeAssistant {
  return {
    states: fixture.states,
    entities: fixture.entities,
    devices: fixture.devices,
    config: { unit_system: { temperature: unit } },
    callService,
  };
}

/** Areas of the fixtures: the Daikin rooms on two floors, the garden and the lab without one. */
export const AREAS: Record<string, HassArea> = {
  keuken: { area_id: 'keuken', name: 'Keuken', floor_id: 'begane_grond' },
  nagelsalon: { area_id: 'nagelsalon', name: 'Nagelsalon', floor_id: 'begane_grond' },
  slaapkamer: { area_id: 'slaapkamer', name: 'Slaapkamer', floor_id: 'eerste' },
  achtertuin: { area_id: 'achtertuin', name: 'Achtertuin', floor_id: null },
  lab: { area_id: 'lab', name: 'Lab', floor_id: null },
};

export const FLOORS: Record<string, HassFloor> = {
  eerste: { floor_id: 'eerste', name: 'Eerste verdieping', level: 1 },
  begane_grond: { floor_id: 'begane_grond', name: 'Begane grond', level: 0 },
};
