import type { LiquidClimateConfig } from '../../config';
import { decimalsForStep, snap } from '../../ui/geometry';
import { modeInfo } from '../../ui/modes';
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
  unit: string;
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
    unit,
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
  };
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
}

export interface Optimistic {
  hvac_mode?: string;
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
  const info = modeInfo(mode);
  const low = local.target_temp_low ?? num(a.target_temp_low);
  const high = local.target_temp_high ?? num(a.target_temp_high);
  const target = local.temperature ?? num(a.temperature);

  const rangeData = caps.range && low != null && high != null;
  // An entity with a range but no single setpoint is always dual.
  const dual = info.setpoint && rangeData && (!caps.single || mode === 'heat_cool' || mode === 'auto');
  const single = info.setpoint && !dual && caps.single && target != null;

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
  };
}

/**
 * The single setpoint one stepper press away, or null when there is nothing to step: off,
 * a mode without a setpoint, a dual setpoint, or already at the limit.
 */
export function steppedTarget(view: DialView, caps: Capabilities, dir: 1 | -1): number | null {
  if (view.mode === 'off' || !view.hasSetpoint || view.dual || view.target == null) return null;
  const next = snap(view.target + dir * caps.step, caps.step, caps.min, caps.max);
  return next === view.target ? null : next;
}
