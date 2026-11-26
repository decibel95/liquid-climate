import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { CONTEXT, launchBrowser, startServer } from './env.mjs';
import { decodePng, encodePng } from './png.mjs';

/** The file name of one capture. Editors ignore the glass, so their name has none. */
export const fileName = (c, glass, ground) => `${c.id}${c.glass ? `__glass-${glass}` : ''}__ground-${ground}.png`;

async function openCase(page, base, query) {
  const qs = new URLSearchParams(query).toString();
  await page.goto(`${base}/dev/pixel.html?${qs}`, { waitUntil: 'load' });
  try {
    await page.waitForFunction(() => window.__pixelReady === true, null, { timeout: 30000 });
  } catch (err) {
    const where = await page.evaluate(() => ({ step: window.__pixelStep ?? 'none', state: document.readyState, url: location.search })).catch(() => ({ step: 'page gone' }));
    throw new Error(`the page was not ready after 30 s (step "${where.step}", ${where.state ?? ''} ${where.url ?? ''}): ${err.message.split('\n')[0]}`);
  }
  const error = await page.evaluate(() => window.__pixelError ?? null);
  if (error) throw new Error(error.split('\n')[0]);
}

/** The matrix: every case with every glass (when the case uses it) and every ground. */
export async function listMatrix(base, browser) {
  const context = await browser.newContext(CONTEXT);
  const page = await context.newPage();
  await openCase(page, base, { list: '1' });
  const { cases, grounds, glasses } = await page.evaluate(() => ({ cases: window.__pixelCases, grounds: window.__pixelGrounds, glasses: window.__pixelGlasses }));
  await context.close();
  const jobs = [];
  for (const c of cases) {
    for (const ground of grounds) {
      for (const glass of c.glass ? glasses : [null]) jobs.push({ c, glass, ground, file: fileName(c, glass, ground) });
    }
  }
  return jobs;
}

async function describeEnvironment(browser) {
  const fc = (pattern) => {
    try {
      return execFileSync('fc-match', [pattern], { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  };
  const pw = JSON.parse(execFileSync('node', ['-e', 'process.stdout.write(JSON.stringify(require("playwright/package.json").version))'], { encoding: 'utf8' }));
  return {
    playwright: pw,
    chromium: browser.version(),
    chromiumExecutable: chromium.executablePath().replace(os.homedir(), '~'),
    platform: `${os.platform()} ${os.arch()}`,
    node: process.version,
    fonts: { Inter: fc('Inter'), 'system-ui': fc('system-ui'), 'sans-serif': fc('sans-serif') },
    context: CONTEXT,
  };
}

/**
 * Capture the matrix into `out`. `match` (optional RegExp) limits the files by name, for quick checks:
 * the output folder is only emptied on a full run. Returns { count, bytes, failures }.
 */
export async function capture({ out, match, concurrency = 4, log = console.log }) {
  const server = await startServer();
  const browser = await launchBrowser();
  try {
    let jobs = await listMatrix(server.base, browser);
    const total = jobs.length;
    if (match) jobs = jobs.filter((j) => match.test(j.file));
    if (!jobs.length) throw new Error(`No capture matches ${match}`);
    mkdirSync(out, { recursive: true });
    if (!match) for (const f of readdirSync(out)) if (f.endsWith('.png') || f === 'environment.json') rmSync(join(out, f));

    const failures = [];
    const retries = [];
    let done = 0;
    let bytes = 0;
    const queue = [...jobs];
    const worker = async () => {
      const context = await browser.newContext(CONTEXT);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
      page.on('console', (m) => m.type() === 'error' && errors.push(`console error: ${m.text()}`));
      try {
        for (let job = queue.shift(); job; job = queue.shift()) {
          try {
            // A page that never gets ready (seen about once in 900 loads, the step it stood at is logged) is loaded again,
            // up to twice: nothing has been captured from it, so a retry cannot hide a visual difference.
            for (let attempt = 1; ; attempt++) {
              errors.length = 0;
              try {
                await page.setViewportSize(job.c.viewport ?? CONTEXT.viewport);
                await openCase(page, server.base, { case: job.c.id, glass: job.glass ?? 'dark', ground: job.ground });
                break;
              } catch (err) {
                if (attempt >= 3 || !/was not ready/.test(err.message)) throw err;
                retries.push(`${job.file}: ${err.message}`);
              }
            }
            if (errors.length) throw new Error(errors[0]);
            const shot = { animations: 'disabled', caret: 'hide', scale: 'css' };
            const raw = job.c.kind === 'sheet' ? await page.screenshot(shot) : await page.locator('#stage').screenshot(shot);
            // Lossless: decode and write again at the best zlib level (about 15 percent smaller, and the bytes depend only on the pixels).
            const buf = encodePng(decodePng(raw));
            writeFileSync(join(out, job.file), buf);
            bytes += buf.length;
          } catch (err) {
            failures.push(`${job.file}: ${err.message}`);
          }
          if (++done % 100 === 0) log(`  ${done}/${jobs.length}`);
        }
      } finally {
        await context.close();
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
    if (!match) writeFileSync(join(out, 'environment.json'), `${JSON.stringify({ ...(await describeEnvironment(browser)), files: total }, null, 2)}\n`);
    return { count: jobs.length, bytes, failures, retries };
  } finally {
    await browser.close();
    await server.close();
  }
}
