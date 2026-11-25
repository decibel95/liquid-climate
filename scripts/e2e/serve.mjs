#!/usr/bin/env node
/**
 * Static and dev server of the end-to-end suite (started by test/e2e/playwright.config.ts, or by hand).
 *
 * - Vite dev server rooted at test/e2e/pages (not the repository root, so the server exposes nothing else): the test
 *   pages are served from /. configFile is off: the pages need no project config.
 * - /__bundles/liquid-climate.js: this worktree's dist/liquid-climate.js (built first when it is missing, or with
 *   LC_E2E_REBUILD=1), and next to it dist/liquid-inter.woff2 and dist/liquid-inter-OFL.txt, as HACS serves a release.
 * - /__bundles/liquid-home.js: the Liquid Home v0.2.1 release asset, downloaded and sha256-checked into the cache
 *   directory (scripts/e2e/fetch-lh.mjs). The Liquid Home repository is never built or touched.
 *
 * Port: $LC_E2E_PORT, default 5391. Binds to 127.0.0.1 only.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer } from 'vite';
import { ensureLh } from './fetch-lh.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGES = resolve(ROOT, 'test', 'e2e', 'pages');
const DIST = resolve(ROOT, 'dist', 'liquid-climate.js');
const FONT = resolve(ROOT, 'dist', 'liquid-inter.woff2');
const OFL = resolve(ROOT, 'dist', 'liquid-inter-OFL.txt');

export async function startE2eServer({ port = Number(process.env.LC_E2E_PORT || 5391) } = {}) {
  const lhFile = await ensureLh();
  if (!existsSync(DIST) || !existsSync(FONT) || process.env.LC_E2E_REBUILD === '1') {
    console.log('[e2e] building dist/liquid-climate.js');
    await build({ root: ROOT, logLevel: 'warn' });
  }
  const JS = 'text/javascript; charset=utf-8';
  // Read once, here: the bytes served are the bytes that were verified (fetch-lh.mjs checked the Liquid Home file).
  const bundles = {
    '/__bundles/liquid-climate.js': [readFileSync(DIST), JS],
    '/__bundles/liquid-inter.woff2': [readFileSync(FONT), 'font/woff2'],
    '/__bundles/liquid-inter-OFL.txt': [readFileSync(OFL), 'text/plain; charset=utf-8'],
    '/__bundles/liquid-home.js': [readFileSync(lhFile), JS],
  };
  const server = await createServer({
    root: PAGES,
    configFile: false,
    logLevel: 'warn',
    clearScreen: false,
    // No HMR socket: a page under test must not be reloaded by a file change.
    server: { port, strictPort: true, host: '127.0.0.1', open: false, hmr: false, fs: { allow: [PAGES], strict: true } },
    plugins: [
      {
        name: 'lc-e2e-bundles',
        configureServer(s) {
          s.middlewares.use((req, res, next) => {
            const entry = bundles[(req.url ?? '').split('?')[0]];
            if (!entry) return next();
            const [body, type] = entry;
            res.setHeader('Content-Type', type);
            res.setHeader('Cache-Control', 'no-store');
            res.end(body);
          });
        },
      },
    ],
  });
  await server.listen();
  console.log(`[e2e] serving on http://127.0.0.1:${port} (liquid-home from ${lhFile})`);
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startE2eServer().then(
    (server) => {
      const stop = () => server.close().finally(() => process.exit(0));
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    },
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
