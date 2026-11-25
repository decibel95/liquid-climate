import { haLocalize, haMode, humanize, optionName, t, type I18nHass, type OptionKind } from '../i18n';
import { domainOf, type Domain } from '../domain';
import type { HassEntity } from '../types';

// Shared with Liquid Home: icons, status colours, tints and tone live in @decibel95/liquid-core.
import { ICONS, PALETTE } from '@decibel95/liquid-core';
export { ICONS, STATUS_COLORS, TINT, tone, rgba } from '@decibel95/liquid-core';

export interface ModeInfo {
  id: string;
  color: string;
  icon: string;
  /** Does this mode have a temperature setpoint? */
  setpoint: boolean;
}

export const MODES: ModeInfo[] = [
  { id: 'off', color: PALETTE.off, icon: ICONS.power, setpoint: false },
  { id: 'heat', color: PALETTE.heat, icon: ICONS.flame, setpoint: true },
  { id: 'cool', color: PALETTE.cool, icon: ICONS.snow, setpoint: true },
  { id: 'heat_cool', color: PALETTE.heat_cool, icon: ICONS.auto, setpoint: true },
  { id: 'auto', color: PALETTE.auto, icon: ICONS.auto, setpoint: true },
  { id: 'dry', color: PALETTE.dry, icon: ICONS.drop, setpoint: false },
  { id: 'fan_only', color: PALETTE.fan_only, icon: ICONS.fan, setpoint: false },
];

export function modeInfo(id: string): ModeInfo {
  return (
    MODES.find((m) => m.id === id) ?? {
      id,
      color: '#9aa3b2',
      icon: ICONS.none,
      setpoint: false,
    }
  );
}

/**
 * Name of a mode. Compact (the dial's mode buttons) is always ours and short. Otherwise Home
 * Assistant's own translation, then our long name ("Heat/Cool", "Fan only") so that heat_cool and
 * auto do not both read "Auto", then our short one.
 */
export function modeLabel(hass: I18nHass, id: string, compact = false, modes: string[] = []): string {
  const own = MODES.some((m) => m.id === id);
  if (!compact || !own) {
    const ha = haMode(hass, id);
    if (ha) return ha;
  }
  if (!own) return id;
  // heat_cool and auto are both "Auto" when short: with both present the heat_cool button gets its own word.
  if (compact && id === 'heat_cool' && modes.includes('auto')) return t(hass, 'modeAlt.heat_cool');
  return compact ? t(hass, `mode.${id}`) : (LONG_MODES.includes(id) ? t(hass, `modeLong.${id}`) : t(hass, `mode.${id}`));
}

const LONG_MODES = ['heat_cool', 'fan_only'];

/** The mode as a participle for a sentence: Heating, Cooling, Fan only. */
export function modeVerb(hass: I18nHass, id: string): string {
  return MODES.some((m) => m.id === id) ? t(hass, `modeVerb.${id}`) : id;
}

/** Name of a fan, swing or preset value, in the user's language. */
export function optionLabel(hass: I18nHass, kind: OptionKind, v: string, stateObj?: Parameters<typeof optionName>[3]): string {
  return optionName(hass, kind, v, stateObj);
}

const first = (s: string, n: number) => s.charAt(0).toUpperCase() + s.slice(1, n).toLowerCase();

/**
 * Short labels for the fan ring segments: the number, else the first letter of the (translated)
 * name. Letters are unique within a ring: on a collision (es "Auto" and "Alto") the colliding
 * ones use the initials of the raw value's words (auto A, high H, on_low OL, auto_high AH), then
 * two letters of the name, and as a last resort their position number.
 */
export function fanShortLabels(values: string[], names: string[] = values): string[] {
  const numeric = (i: number) => /^\d+$/.test(values[i]);
  const dup = (labels: string[], i: number) => labels.indexOf(labels[i]) !== labels.lastIndexOf(labels[i]);
  const initials = (v: string) => {
    const words = v.split(/[\s_-]+/).filter(Boolean);
    return words.length > 1 ? words.map((w) => w.charAt(0).toUpperCase()).join('') : first(v, 1);
  };
  const retry = (out: string[], make: (i: number) => string) => (out.some((_, i) => dup(out, i)) ? out.map((l, i) => (!numeric(i) && dup(out, i) ? make(i) : l)) : out);
  let out = values.map((v, i) => (numeric(i) ? v : first(names[i] || v, 1)));
  out = retry(out, (i) => initials(values[i]));
  out = retry(out, (i) => first(names[i] || values[i], 2));
  return retry(out, (i) => String(i + 1));
}

/**
 * Where a fan mode sits on the quiet..fastest scale, 0..1, or null for "auto"
 * and names we cannot place. The auto mode, when present, is excluded from the scale.
 */
export function fanIntensity(fan: string, modes: string[]): number | null {
  const scale = modes.filter((m) => m !== 'auto');
  const i = scale.indexOf(fan);
  if (i < 0 || scale.length < 2) return null;
  return i / (scale.length - 1);
}

export function particleDuration(base: number, intensity: number | null): number {
  const speed = intensity == null ? 1 : 1.5 - 0.9 * intensity;
  return base * speed;
}

export function spinSeconds(intensity: number | null): number {
  return intensity == null ? 7 : 14 - 11.4 * intensity;
}

/** Inline style for the fan ring spinner: paused while the unit is off. */
export function spinStyle(seconds: number, on: boolean): Record<string, string> {
  return { animationDuration: `${seconds.toFixed(1)}s`, animationPlayState: on ? 'running' : 'paused' };
}

/**
 * The climate mode an entity behaves like: a water heater is heat, a humidifier cool, a dehumidifier
 * dry. Colour, particles and the tile flicker follow it. Climate and off keep their own mode.
 */
export function climateTwin(stateObj: HassEntity | undefined, mode: string): string {
  if (!stateObj || mode === 'off') return mode;
  const domain = domainOf(stateObj.entity_id);
  if (domain === 'climate') return mode;
  if (domain === 'water_heater') return 'heat';
  return stateObj.attributes.device_class === 'dehumidifier' ? 'dry' : 'cool';
}

/**
 * Colour, icon and setpoint of a mode of this entity. Climate: the hvac mode. A water heater or
 * humidifier has one colour for every mode but off, and a setpoint in every mode but off.
 */
export function entityModeInfo(stateObj: HassEntity | undefined, mode: string): ModeInfo {
  if (!stateObj || domainOf(stateObj.entity_id) === 'climate' || mode === 'off') return modeInfo(mode);
  const water = domainOf(stateObj.entity_id) === 'water_heater';
  const icon = (water ? WATER_HEATER_ICONS[mode] : HUMIDIFIER_ICONS[mode]) ?? (water ? ICONS.flame : ICONS.drop);
  return { id: mode, color: modeInfo(climateTwin(stateObj, mode)).color, icon, setpoint: true };
}

/** Icon per water heater operation mode. */
const WATER_HEATER_ICONS: Record<string, string> = {
  eco: ICONS.leaf,
  electric: ICONS.zap,
  performance: ICONS.boost,
  high_demand: ICONS.gauge,
  heat_pump: ICONS.heatPump,
  gas: ICONS.flame,
};

/** Icon per humidifier mode. */
const HUMIDIFIER_ICONS: Record<string, string> = {
  normal: ICONS.drop,
  eco: ICONS.leaf,
  away: ICONS.away,
  boost: ICONS.boost,
  comfort: ICONS.sofa,
  home: ICONS.house,
  sleep: ICONS.moon,
  auto: ICONS.auto,
  baby: ICONS.baby,
};

const MODE_KEYS: Record<Exclude<Domain, 'climate'>, { ha: string; own: string; short?: string }> = {
  water_heater: { ha: 'component.water_heater.entity_component._.state', own: 'waterHeaterMode', short: 'waterHeaterModeShort' },
  humidifier: { ha: 'component.humidifier.entity_component._.state_attributes.mode.state', own: 'humidifierMode' },
};

/**
 * Name of a water heater operation mode or a humidifier mode. Compact (mode buttons) prefers our short
 * name, otherwise Home Assistant's translation wins. Unknown values are made readable.
 */
export function domainModeLabel(hass: I18nHass, domain: Domain, id: string, compact = false, modes: string[] = []): string {
  if (domain === 'climate') return modeLabel(hass, id, compact, modes);
  const keys = MODE_KEYS[domain];
  const haKey = `${keys.ha}.${id}`;
  const ha = haLocalize(hass, haKey);
  const haOk = !!ha && ha !== haKey && ha !== id;
  const own = t(hass, `${keys.own}.${id}`);
  const ownOk = own !== `${keys.own}.${id}`;
  // Six water heater modes share one row: the buttons get a short word, the full name stays in aria-label.
  const short = keys.short ? t(hass, `${keys.short}.${id}`) : '';
  if (compact && keys.short && short !== `${keys.short}.${id}`) return short;
  if (compact && ownOk) return own;
  if (haOk) return ha;
  return ownOk ? own : humanize(id);
}
