import type { RegistryExtra } from '../../src/detect/roles';
import type { HassDevice, HassEntity, HassEntityRegistryEntry } from '../../src/types';
import type { Fixture } from './index';

/**
 * Fixtures modelled on the climate entities of Home Assistant's own demo integration, so the
 * card set is proven against an integration that is not Daikin.
 *
 * Source: homeassistant/components/demo/climate.py in home-assistant/core, branch dev.
 *   - file last changed in commit 165dce1ff9360309ac0868a1f357de2cd6fb9fcf (2026-11-10)
 *   - dev head when it was read: a944a59dfca47710b6f81c24da14e87921d7359e (2026-11-14)
 *   - homeassistant/const.py at that head: 2026.12.0.dev0
 * Base class: homeassistant/components/climate/entity.py and const.py at the same head
 * (state attributes, capability attributes, feature flags, display_temp rounding).
 *
 * What comes straight from demo/climate.py:
 *   - three entities with unique_id climate_1, climate_2, climate_3 and device names
 *     HeatPump, Hvac and Ecobee (all with _attr_has_entity_name = True and _attr_name = None, so
 *     the entity is named after its device and the ids are climate.heatpump, climate.hvac and
 *     climate.ecobee);
 *   - the initial values, hvac_modes, preset_modes, the fixed fan_modes, swing_modes and
 *     swing_horizontal_modes lists, target_humidity_step 5, hvac_action;
 *   - the supported_features, built from the same flags and conditions as DemoClimate.__init__;
 *   - the device: identifiers {("demo", unique_id)} and a name, nothing else, so no manufacturer,
 *     no model, no area and no via_device. The demo creates no sensors, so the family of each
 *     entity is one device with one climate entity.
 *   - _attr_translation_key = "ubercool".
 *
 * Inferred from the climate base class, not from the demo file:
 *   - The demo sets no target_temperature_step, min_temp or max_temp. HA then exposes no
 *     target_temp_step attribute, and min_temp/max_temp are the base-class defaults 7 and 35
 *     degrees C, converted to the entity's native unit and back to the system unit.
 *   - min_humidity 30 and max_humidity 99 (base-class defaults) for Hvac, the only entity with
 *     TARGET_HUMIDITY.
 *   - Attribute presence follows ClimateEntity.state_attributes and capability_attributes:
 *     temperature only with TARGET_TEMPERATURE, target_temp_low/high (null when unset) only with
 *     TARGET_TEMPERATURE_RANGE, fan/swing/preset lists and values only with their feature flag,
 *     hvac_action only when it is truthy, current_humidity only when not None.
 *   - Temperatures are shown in the HA system unit with display_temp: converted from the native
 *     unit, rounded to tenths when the system is Celsius and to whole degrees when it is
 *     Fahrenheit (ClimateEntity.precision).
 *   - Device ids are random in HA; the ones here are fixed stand-ins.
 *
 * Differences from what one might assume about the demo: Ecobee is Celsius (not Fahrenheit), it
 * has no target_temperature and so no single-setpoint flag; HeatPump is the Fahrenheit one and
 * lists its hvac_modes as ["heat", "off"]; Hvac has swing_horizontal modes and target humidity;
 * there is no aux heat in the current demo.
 */

type SystemUnit = '°C' | '°F';

/** ClimateEntityFeature values from climate/const.py. */
export const DEMO_FEATURE = {
  TARGET_TEMPERATURE: 1,
  TARGET_TEMPERATURE_RANGE: 2,
  TARGET_HUMIDITY: 4,
  FAN_MODE: 8,
  PRESET_MODE: 16,
  SWING_MODE: 32,
  TURN_OFF: 128,
  TURN_ON: 256,
  SWING_HORIZONTAL_MODE: 512,
} as const;

/** The HVACMode enum, in declaration order. */
const HVAC_MODE = ['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'];

/** Lists that DemoClimate.__init__ hard-codes for every instance. */
const FAN_MODES = ['on_low', 'on_high', 'auto_low', 'auto_high', 'off'];
const SWING_MODES = ['auto', '1', '2', '3', 'off'];
const SWING_HORIZONTAL_MODES = ['auto', 'rangefull', 'off'];

interface DemoSpec {
  unique_id: string;
  device_name: string;
  entity_id: string;
  device_id: string;
  native_unit: '°C' | '°F';
  target_temperature: number | null;
  current_temperature: number;
  preset: string | null;
  preset_modes: string[] | null;
  fan_mode: string | null;
  target_humidity: number | null;
  current_humidity: number | null;
  swing_mode: string | null;
  swing_horizontal_mode: string | null;
  hvac_mode: string;
  hvac_action: string | null;
  target_temp_high: number | null;
  target_temp_low: number | null;
  hvac_modes: string[];
  target_humidity_step: number | null;
}

/** The three DemoClimate constructor calls of async_setup_entry, argument for argument. */
const SPECS: DemoSpec[] = [
  {
    unique_id: 'climate_1', device_name: 'HeatPump', entity_id: 'climate.heatpump', device_id: '5a1e4b0c9d2f4e7a8c3b6d1f0e2a4c71',
    native_unit: '°F', target_temperature: 68, current_temperature: 77, preset: null, preset_modes: null,
    fan_mode: null, target_humidity: null, current_humidity: null, swing_mode: null, swing_horizontal_mode: null,
    hvac_mode: 'heat', hvac_action: 'heating', target_temp_high: null, target_temp_low: null,
    hvac_modes: ['heat', 'off'], target_humidity_step: null,
  },
  {
    unique_id: 'climate_2', device_name: 'Hvac', entity_id: 'climate.hvac', device_id: '7c3d2e1f8b4a4d6e9f0a1b2c3d4e5f60',
    native_unit: '°C', target_temperature: 21, current_temperature: 22, preset: null, preset_modes: null,
    fan_mode: 'on_high', target_humidity: 67.4, current_humidity: 54.2, swing_mode: 'off', swing_horizontal_mode: 'auto',
    hvac_mode: 'cool', hvac_action: 'cooling', target_temp_high: null, target_temp_low: null,
    hvac_modes: HVAC_MODE.filter((m) => m !== 'heat_cool'), target_humidity_step: 5,
  },
  {
    unique_id: 'climate_3', device_name: 'Ecobee', entity_id: 'climate.ecobee', device_id: '9e8f7a6b5c4d4e3f8a2b1c0d9e8f7a6b',
    native_unit: '°C', target_temperature: null, current_temperature: 23, preset: 'home', preset_modes: ['home', 'eco', 'away'],
    fan_mode: 'auto_low', target_humidity: null, current_humidity: null, swing_mode: 'auto', swing_horizontal_mode: null,
    hvac_mode: 'heat_cool', hvac_action: null, target_temp_high: 24, target_temp_low: 21,
    hvac_modes: HVAC_MODE.filter((m) => m !== 'heat'), target_humidity_step: null,
  },
];

/** DemoClimate.__init__: the feature flags follow which constructor arguments are not None. */
function supportedFeatures(s: DemoSpec): number {
  let f = 0;
  if (s.target_temperature !== null) f |= DEMO_FEATURE.TARGET_TEMPERATURE;
  if (s.preset !== null) f |= DEMO_FEATURE.PRESET_MODE;
  if (s.fan_mode !== null) f |= DEMO_FEATURE.FAN_MODE;
  if (s.target_humidity !== null) f |= DEMO_FEATURE.TARGET_HUMIDITY;
  if (s.swing_mode !== null) f |= DEMO_FEATURE.SWING_MODE;
  if (s.swing_horizontal_mode !== null) f |= DEMO_FEATURE.SWING_HORIZONTAL_MODE;
  if (s.hvac_modes.includes('heat_cool') || s.hvac_modes.includes('auto')) f |= DEMO_FEATURE.TARGET_TEMPERATURE_RANGE;
  return f | DEMO_FEATURE.TURN_OFF | DEMO_FEATURE.TURN_ON;
}

/** homeassistant.helpers.temperature.display_temp, for the two precisions climate uses. */
function display(temp: number | null, native: SystemUnit, system: SystemUnit): number | null {
  if (temp === null) return null;
  let v = temp;
  if (native !== system) v = system === '°F' ? (temp * 9) / 5 + 32 : ((temp - 32) * 5) / 9;
  // Celsius systems use PRECISION_TENTHS, Fahrenheit systems PRECISION_WHOLE.
  return system === '°C' ? Number(v.toFixed(1)) : Math.round(v);
}

/** The base-class default limit (7 and 35 degrees C) in the entity's native unit. */
const defaultLimit = (celsius: number, native: SystemUnit): number => (native === '°F' ? (celsius * 9) / 5 + 32 : celsius);

function attributesOf(s: DemoSpec, system: SystemUnit): Record<string, unknown> {
  const features = supportedFeatures(s);
  const has = (flag: number) => (features & flag) === flag;
  const show = (v: number | null) => display(v, s.native_unit, system);
  const a: Record<string, unknown> = {
    // Capability attributes.
    hvac_modes: s.hvac_modes,
    temperature_unit: system,
    min_temp: show(defaultLimit(7, s.native_unit)),
    max_temp: show(defaultLimit(35, s.native_unit)),
  };
  if (has(DEMO_FEATURE.TARGET_HUMIDITY)) {
    a.min_humidity = 30;
    a.max_humidity = 99;
    if (s.target_humidity_step !== null) a.target_humidity_step = s.target_humidity_step;
  }
  if (has(DEMO_FEATURE.FAN_MODE)) a.fan_modes = FAN_MODES;
  if (has(DEMO_FEATURE.PRESET_MODE)) a.preset_modes = s.preset_modes;
  if (has(DEMO_FEATURE.SWING_MODE)) a.swing_modes = SWING_MODES;
  if (has(DEMO_FEATURE.SWING_HORIZONTAL_MODE)) a.swing_horizontal_modes = SWING_HORIZONTAL_MODES;

  // State attributes.
  a.current_temperature = show(s.current_temperature);
  if (has(DEMO_FEATURE.TARGET_TEMPERATURE)) a.temperature = show(s.target_temperature);
  if (has(DEMO_FEATURE.TARGET_TEMPERATURE_RANGE)) {
    a.target_temp_high = show(s.target_temp_high);
    a.target_temp_low = show(s.target_temp_low);
  }
  if (s.current_humidity !== null) a.current_humidity = s.current_humidity;
  if (has(DEMO_FEATURE.TARGET_HUMIDITY)) a.humidity = s.target_humidity;
  if (has(DEMO_FEATURE.FAN_MODE)) a.fan_mode = s.fan_mode;
  if (s.hvac_action) a.hvac_action = s.hvac_action;
  if (has(DEMO_FEATURE.PRESET_MODE)) a.preset_mode = s.preset;
  if (has(DEMO_FEATURE.SWING_MODE)) a.swing_mode = s.swing_mode;
  if (has(DEMO_FEATURE.SWING_HORIZONTAL_MODE)) a.swing_horizontal_mode = s.swing_horizontal_mode;

  // Added by the state machine, not by the entity.
  a.friendly_name = s.device_name;
  a.supported_features = features;
  return a;
}

/**
 * The three demo climate entities and their three devices, as Home Assistant reports them
 * when its unit system is `system`. Metric is the default: the HeatPump (Fahrenheit natively)
 * then shows converted values, and the Ecobee and Hvac show their Celsius values as they are.
 */
export function demoIntegration(system: SystemUnit = '°C'): Fixture {
  const states: Record<string, HassEntity> = {};
  const entities: Record<string, HassEntityRegistryEntry> = {};
  const devices: Record<string, HassDevice> = {};
  const registry: Record<string, RegistryExtra> = {};
  for (const s of SPECS) {
    devices[s.device_id] = { id: s.device_id, name: s.device_name, manufacturer: null, model: null, via_device_id: null, area_id: null };
    states[s.entity_id] = { entity_id: s.entity_id, state: s.hvac_mode, attributes: attributesOf(s, system) };
    entities[s.entity_id] = { entity_id: s.entity_id, platform: 'demo', device_id: s.device_id, translation_key: 'ubercool' };
    // has_entity_name with name None: the registry holds no original_name of its own.
    registry[s.entity_id] = { unique_id: s.unique_id, original_name: null };
  }
  return { states, entities, devices, registry };
}

export const demoMetric = demoIntegration('°C');
export const demoImperial = demoIntegration('°F');

export const DEMO = {
  heatpump: 'climate.heatpump',
  hvac: 'climate.hvac',
  ecobee: 'climate.ecobee',
} as const;
