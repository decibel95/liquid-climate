import { addDevice, addEntity, emptyFixture, mergeFixtures, type Fixture } from '../../src/demo/fixtures';

/**
 * Radiator valve (TRV) fixtures.
 *
 * trvSonoff mirrors a Zigbee2MQTT Sonoff TRVZB: one climate entity and, on the same device, a
 * battery, the valve opening (Pi heating demand), a window open contact and a local temperature
 * calibration (a number and a sensor, both to be ignored). Z2M sets no translation_key, so the valve
 * is only found by the editor, through unique_id and original_name.
 * trvPresetNone is the same kind of unit with a "none" preset. genericThermostat has no device (as
 * the integration), with and without a room temperature. betterThermostat is a virtual unit on its own device.
 */
export const TRV = {
  sonoff: 'climate.trv_sonoff',
  presetNone: 'climate.trv_preset_none',
  generic: 'climate.generic_thermostat',
  genericBlind: 'climate.generic_thermostat_blind',
  better: 'climate.better_thermostat',
} as const;

const TRV_FEATURES = 1 | 16 | 128 | 256;
const z2m = { platform: 'mqtt' };

function sonoff(): Fixture {
  const f = emptyFixture();
  addDevice(f, { id: 'dev_trv_sonoff', name: 'Radiator valve', manufacturer: 'SONOFF', model: 'TRVZB', area_id: 'lab' });
  addEntity(
    f, TRV.sonoff, 'heat',
    {
      friendly_name: 'Radiator valve', hvac_modes: ['off', 'heat', 'auto'], hvac_action: 'idle',
      min_temp: 4, max_temp: 35, target_temp_step: 0.5, temperature_unit: '°C',
      current_temperature: 19.4, temperature: 20,
      preset_modes: ['manual', 'schedule', 'boost', 'frost_protection'], preset_mode: 'manual',
      supported_features: TRV_FEATURES,
    },
    { ...z2m, device_id: 'dev_trv_sonoff' },
    { unique_id: '0x00124b001234abcd_climate_zigbee2mqtt', original_name: 'Radiator valve' },
  );
  const dev = { ...z2m, device_id: 'dev_trv_sonoff' };
  addEntity(f, 'sensor.trv_sonoff_battery', '78', { device_class: 'battery', unit_of_measurement: '%', state_class: 'measurement', friendly_name: 'Radiator valve battery' }, dev, { unique_id: '0x00124b001234abcd_battery_zigbee2mqtt', original_name: 'Battery' });
  addEntity(f, 'sensor.trv_sonoff_pi_heating_demand', '45', { unit_of_measurement: '%', state_class: 'measurement', friendly_name: 'Radiator valve Pi heating demand' }, dev, { unique_id: '0x00124b001234abcd_pi_heating_demand_zigbee2mqtt', original_name: 'Pi heating demand' });
  addEntity(f, 'binary_sensor.trv_sonoff_window_open', 'off', { device_class: 'window', friendly_name: 'Radiator valve window open' }, dev, { unique_id: '0x00124b001234abcd_window_open_zigbee2mqtt', original_name: 'Window open' });
  // The calibration offset in degrees: neither a valve, nor a temperature to show.
  addEntity(f, 'number.trv_sonoff_local_temperature_calibration', '0', { unit_of_measurement: '°C', min: -12.8, max: 12.7, step: 0.2 }, { ...dev, translation_key: 'local_temperature_calibration' }, { unique_id: '0x00124b001234abcd_local_temperature_calibration_zigbee2mqtt', original_name: 'Local temperature calibration' });
  addEntity(f, 'sensor.trv_sonoff_local_temperature_calibration', '-0.4', { unit_of_measurement: '°C', state_class: 'measurement' }, { ...dev, translation_key: 'local_temperature_calibration' }, { unique_id: '0x00124b001234abcd_local_temperature_calibration_sensor_zigbee2mqtt', original_name: 'Local temperature calibration' });
  return f;
}

function presetNone(): Fixture {
  const f = emptyFixture();
  addDevice(f, { id: 'dev_trv_none', name: 'Spare valve', manufacturer: 'SONOFF', model: 'TRVZB', area_id: 'lab' });
  addEntity(
    f, TRV.presetNone, 'heat',
    {
      friendly_name: 'Spare valve', hvac_modes: ['off', 'heat', 'auto'], hvac_action: 'heating',
      min_temp: 4, max_temp: 35, target_temp_step: 0.5, temperature_unit: '°C',
      current_temperature: 18.2, temperature: 21,
      preset_modes: ['none', 'boost', 'eco'], preset_mode: 'none',
      supported_features: TRV_FEATURES,
    },
    { ...z2m, device_id: 'dev_trv_none' },
  );
  return f;
}

function thermostats(): Fixture {
  const f = emptyFixture();
  const attrs = { hvac_modes: ['heat', 'off'], min_temp: 7, max_temp: 35, target_temp_step: 0.5, temperature_unit: '°C', supported_features: 1 | 128 | 256 };
  // generic_thermostat registers no device.
  addEntity(f, TRV.generic, 'heat', { ...attrs, friendly_name: 'Generic thermostat', hvac_action: 'idle', current_temperature: 20.8, temperature: 21 }, { platform: 'generic_thermostat', device_id: null });
  addEntity(f, TRV.genericBlind, 'heat', { ...attrs, friendly_name: 'Generic thermostat blind', hvac_action: 'heating', temperature: 21 }, { platform: 'generic_thermostat', device_id: null });
  addDevice(f, { id: 'dev_better', name: 'Better thermostat', manufacturer: 'Better Thermostat', area_id: 'lab' });
  addEntity(
    f, TRV.better, 'heat',
    { ...attrs, min_temp: 5, max_temp: 30, friendly_name: 'Better thermostat', hvac_action: 'heating', current_temperature: 19.9, temperature: 21, window_open: false, call_for_heat: true },
    { platform: 'better_thermostat', device_id: 'dev_better' },
  );
  return f;
}

export const trvSonoff = sonoff();
export const trvPresetNone = presetNone();
export const trvThermostats = thermostats();
export const trvFixtures = mergeFixtures(trvSonoff, trvPresetNone, trvThermostats);
