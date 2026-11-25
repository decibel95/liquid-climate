// Prints the raw and gzip size of dist/liquid-climate.js and fails above LIMIT.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

// The limit is 345,000 B raw, set by Thom on 2026-11-25 for Patch B option Full.
const LIMIT = 345_000;

const file = new URL('../dist/liquid-climate.js', import.meta.url);
const data = readFileSync(file);
const raw = data.length;
const gzip = gzipSync(data, { level: 9 }).length;
console.log(`dist/liquid-climate.js: ${raw} B raw, ${gzip} B gzip (limit ${LIMIT} B raw)`);
if (raw > LIMIT) {
  console.error(`SIZE FAIL: ${raw - LIMIT} B over the limit`);
  process.exit(1);
}
console.log(`SIZE OK: ${LIMIT - raw} B left`);
