#!/usr/bin/env node
/**
 * Downloads the Liquid Home release asset the two-bundle test loads next to liquid-climate.js, and verifies its
 * sha256 and size (plan D-10). Fails closed: a wrong hash or size means the file is not used. No token, no secret.
 * Re-pin the constants when Liquid Home moves to a new release.
 *
 * Cache directory: $LC_E2E_CACHE, else $XDG_CACHE_HOME/liquid-climate-e2e, else ~/.cache/liquid-climate-e2e (per user). Needs network only when the cached file is missing
 * or has the wrong hash. Local override: LC_E2E_LH_FILE=<path to a liquid-home.js> is copied to a temp file and its
 * hash is printed; the pin is NOT enforced for it (use it to test an unreleased Liquid Home build).
 * Usage: node scripts/e2e/fetch-lh.mjs   (prints the path of the file to serve)
 */
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LH_VERSION = 'v0.2.1';
export const LH_URL = `https://github.com/decibel95/liquid-home/releases/download/${LH_VERSION}/liquid-home.js`;
export const LH_SHA256 = '4e579eb58843d400e7d6bdb9a82d203819a92146ccc1d49eb98167184fd16e21';
export const LH_BYTES = 205680;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export function cacheDir() {
  return process.env.LC_E2E_CACHE || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'liquid-climate-e2e');
}

/** True when the buffer is the pinned asset (hash and size). */
const isPinned = (buf) => buf.length === LH_BYTES && sha256(buf) === LH_SHA256;

/** Returns the path of the liquid-home.js to serve: the override copy, or the verified (downloaded) asset. */
export async function ensureLh() {
  const override = process.env.LC_E2E_LH_FILE;
  if (override) {
    const dir = mkdtempSync(join(tmpdir(), 'lc-e2e-lh-'));
    const file = join(dir, 'liquid-home.js');
    copyFileSync(override, file);
    console.log(`[e2e] LC_E2E_LH_FILE override: ${override} sha256 ${sha256(readFileSync(file))} (pin not enforced)`);
    return file;
  }

  const dir = join(cacheDir(), `liquid-home-${LH_VERSION}`);
  const file = join(dir, 'liquid-home.js');
  if (existsSync(file) && isPinned(readFileSync(file))) return file;

  mkdirSync(dir, { recursive: true });
  const res = await fetch(LH_URL, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Cannot download ${LH_URL}: HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (!isPinned(body)) {
    throw new Error(`Liquid Home ${LH_VERSION} asset has sha256 ${sha256(body)} and ${body.length} bytes, expected ${LH_SHA256} and ${LH_BYTES} bytes. Not using it.`);
  }
  // Write beside the target and rename, so a parallel run never reads a half-written file.
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  writeFileSync(tmp, body);
  renameSync(tmp, file);
  return file;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  ensureLh().then(
    (file) => console.log(file),
    (err) => {
      console.error(err.message);
      process.exit(1);
    },
  );
}
