import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BASELINE_DIR = resolve(ROOT, 'test', 'pixel', 'baseline');
export const OUT_DIR = resolve(ROOT, 'test', 'pixel', 'out');

/** Everything that decides a pixel, fixed: one device scale, reduced motion, light scheme, sRGB. */
export const CONTEXT = {
  viewport: { width: 1000, height: 1400 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
  colorScheme: 'light',
  locale: 'en-US',
  timezoneId: 'UTC',
};

/** Start Vite (the dev harness) on a free port. Returns { base, close }. */
export async function startServer() {
  const server = await createServer({
    root: ROOT,
    logLevel: 'error',
    clearScreen: false,
    server: { port: 5291, strictPort: false, host: '127.0.0.1', open: false },
  });
  await server.listen();
  const base = server.resolvedUrls?.local?.[0]?.replace(/\/$/, '');
  if (!base) throw new Error('Vite did not report a local URL');
  return { base, close: () => server.close() };
}

/** Headless Chromium from Playwright, with the flags that keep colours and text rendering the same between runs. */
export async function launchBrowser() {
  const args = [
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    '--font-render-hinting=none',
    '--disable-lcd-text',
    '--disable-font-subpixel-positioning',
    '--disable-gpu',
  ];
  try {
    return await chromium.launch({ headless: true, args });
  } catch (err) {
    throw new Error(
      'No Playwright Chromium found. Run "npx playwright install chromium", then run "npm run pixel" again.\n' +
        `First error: ${err?.message?.split('\n')[0]}`,
    );
  }
}
