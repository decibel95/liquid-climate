// Prints the raw and gzip size of dist/liquid-climate.js and fails above LIMIT.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

// The limit is 360,000 B raw, raised by Thom on 2026-11-26 for the Polish language (0.13.0).
const LIMIT = 360_000;

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
