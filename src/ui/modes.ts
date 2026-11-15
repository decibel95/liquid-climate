import { haMode, optionName, t, type I18nHass, type OptionKind } from '../i18n';

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
