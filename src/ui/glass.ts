/**
 * Glass palettes. The bases are opaque enough to keep text readable over any backdrop,
 * from a near-white page to a black one. test/glass.test.ts checks the contrast.
 */
export interface GlassPalette {
  bg: string;
  fg: string;
  fg2: string;
  fg3: string;
  /** Lit rings, lit ticks, knob fill. */
  bright: string;
  track: string;
  tick: string;
  /** Warning accent for text. */
  warn: string;
}

export const GLASS: Record<'dark' | 'light', GlassPalette> = {
  dark: {
    bg: 'rgba(18,20,26,0.78)',
    fg: '#f4f6fa',
    fg2: 'rgba(235,240,248,0.78)',
    // 12px footers: 4.5:1 on a cluster room even when the dark glass sits over a white page.
    fg3: 'rgba(235,240,248,0.76)',
    bright: '#ffffff',
    track: 'rgba(255,255,255,0.14)',
    tick: 'rgba(255,255,255,0.28)',
    warn: '#ffb067',
  },
  light: {
    bg: 'rgba(248,249,252,0.72)',
    fg: '#10141b',
    fg2: 'rgba(16,20,27,0.62)',
    fg3: 'rgba(16,20,27,0.62)',
    bright: '#10141b',
    track: 'rgba(16,20,27,0.16)',
    tick: 'rgba(16,20,27,0.32)',
    warn: '#7c3a05',
  },
};

export interface MenuPalette {
  fg2: string;
  warn: string;
  panel: string;
  /** Section headers (Scripts, Automations): text, 4.5:1 on the panel. */
  head: string;
  /** Ring of the Run pill and of the off switch: 3:1 against the panel. */
  edge: string;
  /** Switch on: a neutral bright track (never the mode colour) and the thumb on it. */
  onTrack: string;
  onThumb: string;
  /** Switch off: a faint track inside the ring, and its thumb. */
  offTrack: string;
  offThumb: string;
  /** Hover tint of an item, over the panel. */
  hover: string;
  /** Fill of the Run pill and of a checked option, over the panel (and over the hover tint). */
  pill: string;
  /** Fill of the Running pill. */
  pillOn: string;
}

/**
 * Colours of the status menu panel, a little stronger than the card's own fg2 and warn because
 * the panel adds a tint over the glass. test/glass.test.ts checks 4.5:1 for text and 3:1 for
 * the switch and pill edges on the panel, and on against off for the switch.
 */
export const MENU_GLASS: Record<'dark' | 'light', MenuPalette> = {
  dark: {
    fg2: 'rgba(235,240,248,0.94)',
    warn: '#ffc490',
    panel: 'rgba(255,255,255,0.05)',
    head: '#f0f3f8',
    edge: 'rgba(235,240,248,0.62)',
    onTrack: '#e9edf5',
    onThumb: '#10141b',
    offTrack: 'rgba(255,255,255,0.08)',
    offThumb: 'rgba(235,240,248,0.78)',
    hover: 'rgba(255,255,255,0.07)',
    pill: 'rgba(255,255,255,0.05)',
    pillOn: 'rgba(255,255,255,0.1)',
  },
  light: {
    fg2: 'rgba(16,20,27,0.86)',
    warn: '#5c2a04',
    panel: 'rgba(0,0,0,0.04)',
    head: '#161b23',
    edge: 'rgba(16,20,27,0.62)',
    onTrack: '#10141b',
    onThumb: '#ffffff',
    offTrack: 'rgba(0,0,0,0.06)',
    offThumb: 'rgba(16,20,27,0.66)',
    hover: 'rgba(0,0,0,0.06)',
    pill: 'rgba(0,0,0,0.04)',
    pillOn: 'rgba(0,0,0,0.08)',
  },
};

/** Ring around the badge's attention dot, close to each glass base. */
export const DOT_RING: Record<'dark' | 'light', string> = { dark: '#15171d', light: '#f3f4f7' };

/** "theme" follows the HA light or dark mode; dark and light are explicit. */
export function resolveGlass(
  glass: 'dark' | 'light' | 'theme',
  hass: { themes?: { darkMode?: boolean } | unknown },
): 'dark' | 'light' {
  if (glass !== 'theme') return glass;
  return (hass.themes as { darkMode?: boolean } | undefined)?.darkMode === true ? 'dark' : 'light';
}

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];

export function parseColor(c: string): Rgba {
  if (c.startsWith('#')) {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`Unsupported colour ${c}`);
  const [r, g, b, a] = m[1].split(',').map((x) => Number(x.trim()));
  return [r, g, b, a ?? 1];
}

/** Composite a colour with alpha over an opaque backdrop. */
export function composite(fg: Rgba, bg: Rgb): Rgb {
  const a = fg[3];
  return [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a))) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two opaque colours. */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Cluster room tiles over the glass base: fill and edge, resting and selected. Light rooms
 * are lifted with white rather than darkened, so the warning footer keeps its contrast when
 * the light glass sits over a dark page; there the selected edge carries the selection.
 * The dark selected fill is a cool tint, not a white lift, which would eat into the footer
 * contrast when the dark glass sits over a white page.
 */
export const ROOM_FILL: Record<'dark' | 'light', { rest: string; on: string; edge: string; onEdge: string }> = {
  dark: { rest: 'rgba(255,255,255,0.04)', on: 'rgba(100,140,240,0.1)', edge: 'rgba(255,255,255,0.07)', onEdge: 'rgba(255,255,255,0.26)' },
  light: { rest: 'rgba(255,255,255,0.55)', on: 'rgba(255,255,255,0.7)', edge: 'rgba(16,20,27,0.08)', onEdge: 'rgba(16,20,27,0.3)' },
};
