import { haLocalize, haMode, humanize, optionName, t, type I18nHass, type OptionKind } from '../i18n';
import { domainOf, type Domain } from '../domain';
import type { HassEntity } from '../types';

export const ICONS = {
  power: 'M12 2v10 M18.4 6.6a9 9 0 1 1-12.77.04',
  flame:
    'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z',
  snow: 'M2 12h20 M12 2v20 M20 16l-4-4 4-4 M4 8l4 4-4 4 M16 4l-4 4-4-4 M8 20l4-4 4 4',
  auto: 'M21 16l-4 4-4-4 M17 20V4 M3 8l4-4 4 4 M7 4v16',
  drop: 'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z',
  fan: 'M10.827 16.379a6.082 6.082 0 0 1-8.618-7.002l5.412 1.45a6.082 6.082 0 0 1 7.002-8.618l-1.45 5.412a6.082 6.082 0 0 1 8.618 7.002l-5.412-1.45a6.082 6.082 0 0 1-7.002 8.618l1.45-5.412Z M12 12v.01',
  swingV: 'M12 2v20 M8 18l4 4 4-4 M8 6l4-4 4 4',
  swingH: 'M2 12h20 M18 8l4 4-4 4 M6 8l-4 4 4 4',
  boost: 'M17 11l-5-5-5 5 M17 18l-5-5-5 5',
  away: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  none: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z',
  door: 'M13 4h3a2 2 0 0 1 2 2v14 M2 20h3 M13 20h9 M10 12v.01 M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z',
  alert: 'M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z M12 9v4 M12 17h.01',
  minus: 'M5 12h14',
  plus: 'M5 12h14 M12 5v14',
  close: 'M6 6l12 12 M18 6L6 18',
  leaf: 'M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12',
  zap: 'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z',
  gauge: 'm12 14 4-4 M3.34 19a10 10 0 1 1 17.32 0',
  heatPump: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16 M8 16H3v5',
  house:
    'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8 M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z',
  sofa: 'M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3 M2 16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z M4 18v2 M20 18v2 M12 4v9',
  baby: 'M9 12h.01 M15 12h.01 M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5 M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1',
  /** Lucide history (lucide-static 0.460.0, icons/history.svg): the dial's history button. */
  history: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5 M12 7v5l4 2',
} as const;

export interface ModeInfo {
  id: string;
  color: string;
  icon: string;
  /** Does this mode have a temperature setpoint? */
  setpoint: boolean;
}

export const MODES: ModeInfo[] = [
  { id: 'off', color: '#9aa3b2', icon: ICONS.power, setpoint: false },
  { id: 'heat', color: '#ff9447', icon: ICONS.flame, setpoint: true },
  { id: 'cool', color: '#5ab0ff', icon: ICONS.snow, setpoint: true },
  { id: 'heat_cool', color: '#a99cff', icon: ICONS.auto, setpoint: true },
  { id: 'auto', color: '#a99cff', icon: ICONS.auto, setpoint: true },
  { id: 'dry', color: '#40d3c8', icon: ICONS.drop, setpoint: false },
  { id: 'fan_only', color: '#d5dce6', icon: ICONS.fan, setpoint: false },
];

/** Badge states that are not hvac modes. */
export const STATUS_COLORS = {
  error: '#f87171',
  paused: '#facc15',
  off: '#6b7280',
} as const;

/** How much of the mode or status colour sits behind an icon. */
export const TINT = {
  /** Tile power button while on, and its edge. */
  tile: 0.24,
  tileEdge: 0.45,
  /** Badge icon circle. */
  badge: 0.3,
} as const;

/**
 * Light glass needs darker versions of the pale colours: amber, red and the fan grey
 * would wash out on a near-white base. test/glass.test.ts checks the result.
 */
const LIGHT_TONES: Record<string, string> = {
  '#facc15': '#b45309',
  '#f87171': '#dc2626',
  '#d5dce6': '#64748b',
};

/** A mode or status colour as it is drawn on the given glass. */
export function tone(color: string, glass: 'dark' | 'light'): string {
  return glass === 'light' ? (LIGHT_TONES[color.toLowerCase()] ?? color) : color;
}

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

export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
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
