import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, encodePng } from './png.mjs';

const pngs = (dir) => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  } catch {
    return [];
  }
};

/**
 * Compare two PNG buffers, pixel by pixel, tolerance 0: every channel of every pixel must be equal.
 * Returns { same, sizeMismatch, differing, width, height, diff } where diff is an RGBA image (red on a faded copy).
 */
export function comparePng(a, b) {
  if (a.equals(b)) return { same: true, differing: 0 };
  const x = decodePng(a);
  const y = decodePng(b);
  if (x.width !== y.width || x.height !== y.height) {
    return { same: false, sizeMismatch: `${x.width}x${x.height} vs ${y.width}x${y.height}`, differing: -1 };
  }
  const out = Buffer.alloc(x.data.length);
  let differing = 0;
  for (let i = 0; i < x.data.length; i += 4) {
    const diff = x.data[i] !== y.data[i] || x.data[i + 1] !== y.data[i + 1] || x.data[i + 2] !== y.data[i + 2] || x.data[i + 3] !== y.data[i + 3];
    if (diff) {
      differing++;
      out[i] = 255;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 255;
    } else {
      // The unchanged pixels, faded to a quarter, so the red stands out.
      const gray = Math.round((x.data[i] + x.data[i + 1] + x.data[i + 2]) / 3);
      out[i] = out[i + 1] = out[i + 2] = Math.round(255 - (255 - gray) * 0.25);
      out[i + 3] = 255;
    }
  }
  return { same: differing === 0, differing, width: x.width, height: x.height, diff: { width: x.width, height: x.height, data: out } };
}

/**
 * Compare two folders of PNGs. Fails on an empty or missing folder (0 files compared), a missing file, an extra file, a size mismatch and any differing pixel.
 * Diff images of the differing files go to diffDir. Returns { ok, total, problems: string[] }.
 */
export function compareDirs(baselineDir, freshDir, diffDir) {
  const base = pngs(baselineDir);
  const fresh = pngs(freshDir);
  const problems = [];
  // An empty or missing folder must never read as a pass.
  if (!base.length) problems.push(`no PNG files in the baseline folder ${baselineDir}`);
  if (!fresh.length) problems.push(`no PNG files in the fresh folder ${freshDir}`);
  for (const f of base) if (!fresh.includes(f)) problems.push(`missing in the fresh capture: ${f}`);
  for (const f of fresh) if (!base.includes(f)) problems.push(`extra in the fresh capture (not in the baseline): ${f}`);
  let differing = 0;
  for (const f of base) {
    if (!fresh.includes(f)) continue;
    let r;
    try {
      r = comparePng(readFileSync(join(baselineDir, f)), readFileSync(join(freshDir, f)));
    } catch (err) {
      problems.push(`${f}: cannot compare (${err.message})`);
      continue;
    }
    if (r.same) continue;
    differing++;
    if (r.sizeMismatch) {
      problems.push(`${f}: size mismatch ${r.sizeMismatch}`);
    } else {
      problems.push(`${f}: ${r.differing} differing pixel${r.differing === 1 ? '' : 's'} of ${r.width * r.height}`);
      mkdirSync(diffDir, { recursive: true });
      writeFileSync(join(diffDir, f), encodePng(r.diff));
    }
  }
  const total = new Set([...base, ...fresh]).size;
  if (total === 0) problems.push('nothing was compared (0 files)');
  return { ok: problems.length === 0, total, differing, problems };
}
