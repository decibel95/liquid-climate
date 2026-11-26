// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIQUID_FONT_FAMILY, LIQUID_FONT_STYLE_ID, LIQUID_FONT_UNICODE_RANGE, ensureLiquidFont } from '@decibel95/liquid-core';

// The font file the build ships: liquid-core's own fonts/liquid-inter.woff2, read from the installed package.
const FONT_SHA256 = 'ec9d62021ca5940db5f5b700613aebf24d379039553795447cd407cd35b253d7';
const FONT_BYTES = 43008;

// Copied from liquid-core 0.2.0 test/font.test.ts: the text core's ensureLiquidFont() writes. Both bundles must write
// the same face, since whichever loads first registers it for the page.
const CORE_RANGE =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2190-2193, U+2212, U+2215, U+2264-2265, U+FEFF, U+FFFD, U+0100-017F';
const CORE_CSS =
  "@font-face { font-family: 'Liquid Inter'; src: url(\"https://example.test/hacsfiles/liquid-home/liquid-inter.woff2\") format('woff2'); " +
  `font-weight: 200 600; font-style: normal; font-display: swap; unicode-range: ${CORE_RANGE}; }`;
const STACK = "'Liquid Inter', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

// The project has no Node typings (tsconfig types: []), so Node modules are loaded through typed shims.
const names = { fs: 'node:fs', crypto: 'node:crypto' };
const fs = (await import(/* @vite-ignore */ names.fs)) as {
  readFileSync: { (file: string): Uint8Array; (file: string, enc: 'utf8'): string };
};
const crypto = (await import(/* @vite-ignore */ names.crypto)) as {
  createHash: (alg: string) => { update: (data: Uint8Array) => { digest: (enc: 'hex') => string } };
};

const styles = () => [...document.querySelectorAll('style')];
afterEach(() => {
  for (const s of styles()) s.remove();
});

describe('the font file from liquid-core', () => {
  const bytes = fs.readFileSync('node_modules/@decibel95/liquid-core/fonts/liquid-inter.woff2');

  it("is liquid-core's build (size and sha256)", () => {
    expect(bytes.length).toBe(FONT_BYTES);
    expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(FONT_SHA256);
  });

  it('is a woff2 file', () => {
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('wOF2');
  });

  it('has its licence next to it, and a NOTICE entry', () => {
    expect(fs.readFileSync('node_modules/@decibel95/liquid-core/fonts/OFL.txt', 'utf8')).toMatch(/^Copyright \(c\) 2016 The Inter Project Authors[\s\S]*SIL OPEN FONT LICENSE Version 1\.1/);
    expect(fs.readFileSync('NOTICE', 'utf8')).toContain('liquid-inter-OFL.txt');
  });
});

describe('ensureLiquidFont', () => {
  it("writes the same @font-face text as liquid-core, to one style in document.head", () => {
    ensureLiquidFont('https://example.test/hacsfiles/liquid-home/liquid-inter.woff2');
    const all = styles();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('liquid-core-font');
    expect(all[0].parentNode).toBe(document.head);
    expect(all[0].textContent).toBe(CORE_CSS);
    expect(LIQUID_FONT_FAMILY).toBe('Liquid Inter');
    expect(LIQUID_FONT_STYLE_ID).toBe('liquid-core-font');
    expect(LIQUID_FONT_UNICODE_RANGE).toBe(CORE_RANGE);
  });

  it('is idempotent: later calls with another URL change nothing', () => {
    ensureLiquidFont('/a/liquid-inter.woff2');
    const first = document.getElementById(LIQUID_FONT_STYLE_ID)!;
    const css = first.textContent;
    ensureLiquidFont('/b/liquid-inter.woff2');
    ensureLiquidFont('/a/liquid-inter.woff2');
    expect(styles()).toEqual([first]);
    expect(first.textContent).toBe(css);
    expect(css).toContain('/a/liquid-inter.woff2');
  });

  it('adds nothing when another bundle (Liquid Home, through core) registered the face first', () => {
    const other = document.createElement('style');
    other.id = 'liquid-core-font';
    other.textContent = CORE_CSS;
    document.head.appendChild(other);
    ensureLiquidFont('/hacsfiles/liquid-climate/liquid-inter.woff2');
    expect(styles()).toEqual([other]);
    expect(other.textContent).toBe(CORE_CSS);
  });

  it('escapes the URL as core does (quotes, backslashes, line breaks), so it stays one CSS string', () => {
    ensureLiquidFont('/x"); color: red; /*\\\n.woff2');
    // Core's own expectation for the same input.
    expect(styles()[0].textContent).toContain('url("/x\\"); color: red; /*\\\\\\a .woff2")');
    expect((styles()[0] as HTMLStyleElement).sheet!.cssRules).toHaveLength(1);
  });

  it('puts nothing into a shadow root', () => {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    document.body.appendChild(host);
    ensureLiquidFont('/liquid-inter.woff2');
    expect(root.querySelector('style')).toBeNull();
    host.remove();
  });

  it('does nothing without a document', () => {
    vi.stubGlobal('document', undefined);
    try {
      expect(() => ensureLiquidFont('/liquid-inter.woff2')).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(styles()).toHaveLength(0);
  });
});

describe('font stack', () => {
  it("every font-family in src starts with 'Liquid Inter', then the 0.11.1 stack", () => {
    const files = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const found = Object.entries(files).flatMap(([file, src]) =>
      [...src.matchAll(/font-family:\s*([^;`]+);/g)].map((m) => [file, m[1].trim()]),
    );
    // The four card roots: dial, tile, badge, cluster. The face itself is written by liquid-core, not by src.
    const stacks = found;
    expect(stacks.map(([file]) => file).sort()).toEqual([
      '../src/cards/badge/liquid-climate-badge.ts',
      '../src/cards/cluster/liquid-climate-cluster.ts',
      '../src/cards/dial/styles.ts',
      '../src/cards/tile/liquid-climate-tile.ts',
    ]);
    for (const [, stack] of stacks) expect(stack).toBe(STACK);
  });
});
