// The Inter font that Liquid Climate ships, so the cards look the same on every OS.
// fonts/liquid-inter.woff2 is liquid-core's subset of Inter 4.1 (variable weight 200..600, optical size 14, Latin and
// Latin Extended-A), copied byte for byte. Inter is under the SIL Open Font License 1.1 (fonts/OFL.txt).
//
// A local copy of liquid-core's src/font.ts (0.2.0): Liquid Climate does not depend on core yet. The family name, the
// @font-face text and the guard (style#liquid-core-font) are the same as core's, so with Liquid Home and Liquid Climate
// on one page the face is added once, by whichever bundle loads first. Keep them in step with core;
// test/font.test.ts holds core's expected text.

/** The CSS family name of the shipped face. */
export const LIQUID_FONT_FAMILY = 'Liquid Inter';

/** The code points in the font file. Same list as core's LIQUID_FONT_UNICODE_RANGE. */
export const LIQUID_FONT_UNICODE_RANGE =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2190-2193, U+2212, U+2215, U+2264-2265, U+FEFF, U+FFFD, U+0100-017F';

/** The id of the `<style>` element ensureLiquidFont() adds to `document.head`. Every copy of core checks for it too. */
export const LIQUID_FONT_STYLE_ID = 'liquid-core-font';

/** A CSS string literal: backslash, double quote and line breaks escaped. */
const cssString = (s: string) => `"${s.replace(/[\\"]/g, '\\$&').replace(/[\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;

/**
 * Registers the 'Liquid Inter' face once per document: one `<style id="liquid-core-font">` in `document.head` with the
 * `@font-face` rule. The guard is that element, not module state, so a Liquid Home bundle (core) and this one register
 * it once; the first URL wins and later calls do nothing. Without a document it does nothing. `@font-face` does not
 * work inside a shadow root, so it never goes there.
 */
export function ensureLiquidFont(url: string): void {
  if (typeof document === 'undefined' || !document.head) return;
  if (document.querySelector(`style#${LIQUID_FONT_STYLE_ID}`)) return;
  const style = document.createElement('style');
  style.id = LIQUID_FONT_STYLE_ID;
  style.textContent =
    `@font-face { font-family: '${LIQUID_FONT_FAMILY}'; src: url(${cssString(url)}) format('woff2'); ` +
    `font-weight: 200 600; font-style: normal; font-display: swap; unicode-range: ${LIQUID_FONT_UNICODE_RANGE}; }`;
  document.head.appendChild(style);
}
