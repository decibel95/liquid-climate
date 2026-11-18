import type { LiquidClimateConfig } from '../../config';
import { decimalsForStep, snap } from '../../ui/geometry';
import { modeInfo } from '../../ui/modes';
import { HUMIDIFIER_FEATURE, WATER_HEATER_FEATURE, domainOf, operationList, targetKey, type Domain } from '../../domain';
import type { HassEntity, HomeAssistant } from '../../types';

/** ClimateEntityFeature bit flags from Home Assistant core. */
export const FEATURE = {
  TARGET_TEMPERATURE: 1,
  TARGET_TEMPERATURE_RANGE: 2,
  FAN_MODE: 8,
  PRESET_MODE: 16,
  SWING_MODE: 32,
  SWING_HORIZONTAL_MODE: 512,
} as const;

export interface Capabilities {
  /** Which kind of entity: decides the services, the colours and which controls exist. */
  domain: Domain;
  unit: string;
  /** Shown after a setpoint or reading: a degree sign, or % for a humidifier. */
  symbol: string;
  min: number;
  max: number;
  step: number;
  decimals: number;
  /** Modes shown as buttons, in config order, limited to what the entity supports. */
  modes: string[];
  hasOff: boolean;
  /** Entity can hold a single setpoint. */
  single: boolean;
  /** Entity can hold a low/high range. */
  range: boolean;
  fanModes: string[];
  swingModes: string[];
  swingHModes: string[];
  presetModes: string[];
  /** Water heater: away mode can be switched. */
  away: boolean;
}

const has = (features: number, flag: number) => (features & flag) === flag;

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

export function getCapabilities(
  stateObj: HassEntity,
  config: LiquidClimateConfig,
  hass?: Pick<HomeAssistant, 'config'>,
): Capabilities {
  const domain = domainOf(stateObj.entity_id);
  if (domain === 'water_heater') return waterHeaterCapabilities(stateObj, hass);
  if (domain === 'humidifier') return humidifierCapabilities(stateObj);
  const a = stateObj.attributes;
  const features = Number(a.supported_features ?? 0);
  const unit: string = a.temperature_unit ?? hass?.config.unit_system.temperature ?? '°C';
  const fahrenheit = unit.includes('F');
  const min = Number(a.min_temp ?? (fahrenheit ? 45 : 10));
  const max = Number(a.max_temp ?? (fahrenheit ? 95 : 35));
  const step = Number(a.target_temp_step ?? (fahrenheit ? 1 : 0.5)) || 1;

  const hvac = list(a.hvac_modes);
  const wanted = config.controls.modes;
  // Config order wins, entity support filters. Unknown modes are never shown.
  const modes = wanted.filter((m, i) => hvac.includes(m) && wanted.indexOf(m) === i);

  const usable = (flag: number, arr: string[], enabled: boolean) =>
    enabled && has(features, flag) && arr.length > 1 ? arr : [];

  return {
    domain,
    unit,
    symbol: '°',
    min,
    max,
    step,
    decimals: decimalsForStep(step),
    modes,
    hasOff: hvac.includes('off'),
    single: has(features, FEATURE.TARGET_TEMPERATURE),
    range: has(features, FEATURE.TARGET_TEMPERATURE_RANGE),
    fanModes: usable(FEATURE.FAN_MODE, list(a.fan_modes), config.controls.fan),
    swingModes: usable(FEATURE.SWING_MODE, list(a.swing_modes), config.controls.swing),
    swingHModes: usable(
      FEATURE.SWING_HORIZONTAL_MODE,
      list(a.swing_horizontal_modes),
      config.controls.swing_horizontal,
    ),
    presetModes: usable(FEATURE.PRESET_MODE, list(a.preset_modes), config.controls.presets),
    away: false,
  };
}

const NONE = { range: false, fanModes: [], swingModes: [], swingHModes: [], presetModes: [] };

/**
 * A water heater on the dial: the temperature setpoint, the operation modes as mode buttons (off is
 * the power button), away mode as a chip. Defaults follow Home Assistant's water heater (110 to 140 F).
 */
function waterHeaterCapabilities(stateObj: HassEntity, hass?: Pick<HomeAssistant, 'config'>): Capabilities {
  const a = stateObj.attributes;
  const features = Number(a.supported_features ?? 0);
  const unit: string = a.temperature_unit ?? hass?.config.unit_system.temperature ?? '°C';
  const fahrenheit = unit.includes('F');
  const min = Number(a.min_temp ?? (fahrenheit ? 110 : 43));
  const max = Number(a.max_temp ?? (fahrenheit ? 140 : 60));
  const step = Number(a.target_temp_step ?? a.target_temperature_step ?? (fahrenheit ? 1 : 0.5)) || 1;
  const ops = operationList(stateObj);
  const usable = has(features, WATER_HEATER_FEATURE.OPERATION_MODE) ? ops.filter((m) => m !== 'off') : [];
  return {
    domain: 'water_heater',
    unit,
    symbol: '°',
    min,
    max,
    step,
    decimals: decimalsForStep(step),
    // One mode is no choice: the buttons show from two on.
    modes: usable.length > 1 ? usable : [],
    hasOff: has(features, WATER_HEATER_FEATURE.ON_OFF) || ops.includes('off'),
    single: has(features, WATER_HEATER_FEATURE.TARGET_TEMPERATURE),
    ...NONE,
    away: has(features, WATER_HEATER_FEATURE.AWAY_MODE),
  };
}

/** A humidifier on the dial: target humidity in %, the modes when the MODES flag is set, on and off. */
function humidifierCapabilities(stateObj: HassEntity): Capabilities {
  const a = stateObj.attributes;
  const features = Number(a.supported_features ?? 0);
  const min = Number(a.min_humidity ?? 0);
  const max = Number(a.max_humidity ?? 100);
  const step = Number(a.target_humidity_step ?? 1) || 1;
  const modes = has(features, HUMIDIFIER_FEATURE.MODES) ? list(a.available_modes) : [];
  return {
    domain: 'humidifier',
    unit: '%',
    symbol: '%',
    min,
    max,
    step,
    decimals: decimalsForStep(step),
    modes: modes.length > 1 ? modes : [],
    hasOff: true,
    single: true,
    ...NONE,
    away: false,
  };
}

/** Whether a mode shows a setpoint: any mode but off outside climate, where the mode decides. */
export function modeHasSetpoint(caps: Pick<Capabilities, 'domain'>, mode: string): boolean {
  return caps.domain === 'climate' ? modeInfo(mode).setpoint : mode !== 'off';
}

/** What the dial shows after merging optimistic local values over the entity. */
export interface DialView {
  mode: string;
  /** Mode shows a setpoint (single or range) on the inner ring. */
  hasSetpoint: boolean;
  dual: boolean;
  target: number | null;
  low: number | null;
  high: number | null;
  fan: string | null;
  swing: string | null;
  swingH: string | null;
  preset: string | null;
  /** Humidifier: the mode within on (available_modes), separate from on and off. */
  subMode: string | null;
  /** Water heater: away mode on, or null when it cannot be switched. */
  away: boolean | null;
}

/**
 * Values set but not yet reported back. `hvac_mode` is the climate hvac mode, a water heater's
 * operation mode, or a humidifier's on/off: always what the entity reports as its state.
 */
export interface Optimistic {
  hvac_mode?: string;
  /** Humidifier target humidity. */
  humidity?: number;
  /** Humidifier mode (available_modes). */
  mode?: string;
  /** Water heater away mode, as the attribute reports it. */
  away_mode?: 'on' | 'off';
  temperature?: number;
  target_temp_low?: number;
  target_temp_high?: number;
  fan_mode?: string;
  swing_mode?: string;
  swing_horizontal_mode?: string;
  preset_mode?: string;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function buildView(stateObj: HassEntity, caps: Capabilities, local: Optimistic): DialView {
  const a = stateObj.attributes;
  const mode = local.hvac_mode ?? stateObj.state;
  const setpoint = modeHasSetpoint(caps, mode);
  const low = local.target_temp_low ?? num(a.target_temp_low);
  const high = local.target_temp_high ?? num(a.target_temp_high);
  const key = targetKey(caps.domain);
  const target = local[key] ?? num(a[key]);

  const rangeData = caps.range && low != null && high != null;
  // An entity with a range but no single setpoint is always dual.
  const dual = setpoint && rangeData && (!caps.single || mode === 'heat_cool' || mode === 'auto');
  const single = setpoint && !dual && caps.single && target != null;

  return {
    mode,
    hasSetpoint: dual || single,
    dual,
    target,
    low,
    high,
    fan: caps.fanModes.length ? (local.fan_mode ?? (a.fan_mode as string | null) ?? null) : null,
    swing: caps.swingModes.length ? (local.swing_mode ?? (a.swing_mode as string | null) ?? null) : null,
    swingH: caps.swingHModes.length
      ? (local.swing_horizontal_mode ?? (a.swing_horizontal_mode as string | null) ?? null)
      : null,
    preset: caps.presetModes.length ? (local.preset_mode ?? (a.preset_mode as string | null) ?? null) : null,
    subMode: caps.domain === 'humidifier' ? (local.mode ?? (typeof a.mode === 'string' ? a.mode : null)) : null,
    away: caps.away ? (local.away_mode ?? a.away_mode) === 'on' : null,
  };
}

/** The optimistic patch that sets the setpoint of a single-setpoint entity. */
export function setpointPatch(caps: Pick<Capabilities, 'domain'>, value: number): Optimistic {
  return { [targetKey(caps.domain)]: value };
}

/** A setpoint snapped to the entity's grid: from min for climate, from 0 for a water heater or humidifier. */
export function snapFor(caps: Pick<Capabilities, 'domain' | 'step' | 'min' | 'max'>, v: number): number {
  return snap(v, caps.step, caps.min, caps.max, caps.domain === 'climate' ? caps.min : 0);
}

/**
 * The single setpoint one stepper press away, or null when there is nothing to step: off,
 * a mode without a setpoint, a dual setpoint, or already at the limit.
 */
export function steppedTarget(view: DialView, caps: Capabilities, dir: 1 | -1): number | null {
  if (view.mode === 'off' || !view.hasSetpoint || view.dual || view.target == null) return null;
  const next = snapFor(caps, view.target + dir * caps.step);
  return next === view.target ? null : next;
}
