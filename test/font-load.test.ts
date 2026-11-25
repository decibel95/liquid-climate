// @vitest-environment node
// Node on purpose, as Liquid Home's test/font.test.ts: under happy-dom, Vitest's web transform swaps the
// import.meta.url base of `new URL(path, import.meta.url)` for the page location. The custom elements are mocked
// away, so src/index.ts runs only its picker entries and the font call.
import { afterEach, describe, expect, it, vi } from 'vitest';

const ensureLiquidFont = vi.hoisted(() => vi.fn());
vi.mock('@decibel95/liquid-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@decibel95/liquid-core')>()),
  ensureLiquidFont,
}));
vi.mock('../src/cards/dial/liquid-climate-card', () => ({}));
vi.mock('../src/cards/tile/liquid-climate-tile', () => ({}));
vi.mock('../src/cards/badge/liquid-climate-badge', () => ({}));
vi.mock('../src/cards/cluster/liquid-climate-cluster', () => ({}));
vi.mock('../src/editor/liquid-climate-card-editor', () => ({}));
vi.mock('../src/editor/liquid-climate-tile-editor', () => ({}));
vi.mock('../src/editor/liquid-climate-badge-editor', () => ({}));
vi.mock('../src/editor/liquid-climate-cluster-editor', () => ({}));

// src/index.ts fills window.customCards and window.customBadges; the global object stands in for window here.
(globalThis as { window?: unknown }).window = globalThis;

/** import.meta.url of src/index.ts under Vitest (the file URL, without a query). */
const MODULE = new URL('../src/index.ts', import.meta.url).href;

async function loadIndex() {
  ensureLiquidFont.mockClear();
  vi.resetModules();
  await import('../src/index');
}

afterEach(() => vi.unstubAllGlobals());

// Imported lazily: vite.config.ts is also the Vitest config.
const { FONT_ASSETS } = await import('../vite.config');

describe('font loading at module load (liquid-core README, "Font")', () => {
  it('calls ensureLiquidFont once, with liquid-inter.woff2 next to the bundle', async () => {
    await loadIndex();
    expect(ensureLiquidFont).toHaveBeenCalledTimes(1);
    const [url] = ensureLiquidFont.mock.calls[0] as [string];
    expect(url).toBe(new URL('./liquid-inter.woff2', MODULE).href);
    expect(new URL(url).pathname.endsWith('/src/liquid-inter.woff2')).toBe(true);
    expect(url.startsWith('data:')).toBe(false);
    expect(new URL(url).search).toBe('');
  });

  it("carries the bundle's own query string (HACS serves the bundle as ?hacstag=...)", async () => {
    // Vitest drops the query from import.meta.url, so this URL class makes the module's URL read as HACS serves it.
    const Real = URL;
    const served = `${MODULE}?hacstag=1234567`;
    vi.stubGlobal(
      'URL',
      class extends Real {
        constructor(input: string | URL, base?: string | URL) {
          super(input === MODULE ? served : input, base === MODULE ? served : base);
        }
      },
    );
    await loadIndex();
    expect(ensureLiquidFont).toHaveBeenCalledTimes(1);
    const [url] = ensureLiquidFont.mock.calls[0] as [string];
    expect(url).toBe(new Real('./liquid-inter.woff2?hacstag=1234567', MODULE).href);
    expect(new Real(url).search).toBe('?hacstag=1234567');
  });

  it('resolves to a file name the build ships and the dev server routes (contract with vite.config.ts)', () => {
    const name = new URL('./liquid-inter.woff2', 'http://x/src/index.ts').pathname.split('/').pop();
    expect(Object.keys(FONT_ASSETS)).toContain(name);
    expect(FONT_ASSETS).toEqual({
      'liquid-inter.woff2': '@decibel95/liquid-core/fonts/liquid-inter.woff2',
      'liquid-inter-OFL.txt': '@decibel95/liquid-core/fonts/OFL.txt',
    });
  });
});
