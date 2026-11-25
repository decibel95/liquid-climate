// Builds the value snapshot that test/core-parity.test.ts compares with test/fixtures/lc-0.12.0-parity.json.
// It reads the app's own modules, so it keeps working when those become shims over @decibel95/liquid-core.
import { DOT_RING, GLASS, MENU_GLASS, ROOM_FILL } from '../src/ui/glass';
import { glassTokens } from '../src/ui/glass-styles';
import { ICONS, MODES, STATUS_COLORS, TINT, tone } from '../src/ui/modes';
import { ensureLiquidFont } from '@decibel95/liquid-core';
import fixture from './fixtures/lc-0.12.0-parity.json';

// liquid-core's palette module has more icons (bulb, sun, rainbow) and TINT.power than 0.12.0: compare the 0.12.0 keys only.
const LC_ICON_KEYS = Object.keys(fixture.values.ICONS) as (keyof typeof ICONS)[];
const { power: _power, ...LC_TINT } = TINT;

/** The colours LIGHT_TONES (not exported) maps, plus one that it leaves alone. */
const TONE_PROBES = ['#facc15', '#f87171', '#d5dce6', '#FACC15', '#9aa3b2', '#ff9447'];

/** The text ensureLiquidFont writes into `style#liquid-core-font`. Needs a `document` (happy-dom). */
function fontCss(): string {
  document.head.innerHTML = '';
  ensureLiquidFont('https://example.test/hacsfiles/liquid-climate/liquid-inter.woff2');
  const text = document.querySelector('style#liquid-core-font')?.textContent ?? '';
  document.head.innerHTML = '';
  return text;
}

export function parityValues() {
  return {
    GLASS,
    MENU_GLASS,
    DOT_RING,
    ROOM_FILL,
    MODES,
    STATUS_COLORS,
    TINT: LC_TINT,
    LIGHT_TONES: Object.fromEntries(TONE_PROBES.map((c) => [c, { dark: tone(c, 'dark'), light: tone(c, 'light') }])),
    ICONS: Object.fromEntries(LC_ICON_KEYS.map((k) => [k, ICONS[k]])),
    glassTokensCssText: glassTokens.cssText,
    ensureLiquidFontCss: fontCss(),
  };
}
