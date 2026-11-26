import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASELINE_DIR, OUT_DIR } from './env.mjs';
import { capture } from './capture.mjs';
import { compareDirs } from './compare.mjs';

const USAGE = `Usage: node scripts/pixel/run.mjs <check|update|compare> [--match <regex>] [--concurrency <n>] [--out <dir>] [--against <dir>]
  check    capture fresh into test/pixel/out/fresh and compare with test/pixel/baseline (npm run pixel)
  update   capture straight into test/pixel/baseline (npm run pixel:update)
  compare  compare two existing folders: --out <fresh> --against <baseline> (determinism proof of two captures)`;

const args = process.argv.slice(2);
const mode = args.shift();
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!['check', 'update', 'compare'].includes(mode ?? '')) {
  console.error(USAGE);
  process.exit(2);
}
const match = opt('match') ? new RegExp(opt('match')) : undefined;
const concurrency = Number(opt('concurrency') ?? 4);

/** More retries than this in one run means the harness is unstable: the run fails. */
const MAX_RETRIES = 3;

const sizeOf = (dir) => readdirSync(dir).reduce((sum, f) => sum + statSync(join(dir, f)).size, 0);
const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

async function main() {
  if (mode === 'compare') {
    const fresh = opt('out');
    const base = opt('against');
    if (!fresh || !base) throw new Error(USAGE);
    return report(compareDirs(base, fresh, join(OUT_DIR, 'diff')));
  }
  const dest = mode === 'update' ? BASELINE_DIR : (opt('out') ?? join(OUT_DIR, 'fresh'));
  if (mode === 'check') rmSync(join(OUT_DIR, 'diff'), { recursive: true, force: true });
  if (mode === 'update' && match) throw new Error('"update" always rewrites the whole baseline: leave out --match');
  mkdirSync(dest, { recursive: true });
  const started = Date.now();
  console.log(`Capturing into ${dest}`);
  const result = await capture({ out: dest, match, concurrency });
  console.log(`Captured ${result.count} files (${mb(result.bytes)}) in ${Math.round((Date.now() - started) / 1000)} s`);
  mkdirSync(OUT_DIR, { recursive: true });
  const retryLog = join(OUT_DIR, 'retries.log');
  writeFileSync(retryLog, result.retries.length ? `${result.retries.join('\n')}\n` : '');
  console.log(`Retries: ${result.retries.length} (limit ${MAX_RETRIES}), log: ${retryLog}`);
  if (result.retries.length > MAX_RETRIES) {
    console.error(`Too many retries (${result.retries.length} > ${MAX_RETRIES}): pages did not get ready, the capture is not trustworthy.`);
    process.exit(1);
  }
  if (result.failures.length) {
    console.error(`${result.failures.length} capture failure(s):`);
    for (const f of result.failures.slice(0, 20)) console.error(`  ${f}`);
    process.exit(1);
  }
  if (mode === 'update') {
    console.log(`Baseline updated: ${readdirSync(BASELINE_DIR).filter((f) => f.endsWith('.png')).length} PNGs, ${mb(sizeOf(BASELINE_DIR))}`);
    return;
  }
  if (match) {
    // A partial capture compares only its own files.
    const names = readdirSync(dest).filter((f) => f.endsWith('.png') && match.test(f));
    const subset = join(OUT_DIR, 'baseline-subset');
    const only = join(OUT_DIR, 'fresh-subset');
    for (const d of [subset, only]) {
      rmSync(d, { recursive: true, force: true });
      mkdirSync(d, { recursive: true });
    }
    for (const f of names) {
      if (existsSync(join(BASELINE_DIR, f))) cpSync(join(BASELINE_DIR, f), join(subset, f));
      cpSync(join(dest, f), join(only, f));
    }
    return report(compareDirs(subset, only, join(OUT_DIR, 'diff')));
  }
  report(compareDirs(BASELINE_DIR, dest, join(OUT_DIR, 'diff')));
}

function report(result) {
  if (result.ok) {
    console.log(`PIXEL OK: ${result.total} files identical (tolerance 0)`);
    return;
  }
  console.error(`PIXEL FAIL: ${result.problems.length} problem(s) in ${result.total} files`);
  for (const p of result.problems.slice(0, 40)) console.error(`  ${p}`);
  if (result.problems.length > 40) console.error(`  ... and ${result.problems.length - 40} more`);
  console.error(`Diff images: ${join(OUT_DIR, 'diff')}`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
