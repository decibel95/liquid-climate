import { clamp, valueToFraction } from '@decibel95/liquid-core';

// Shared with Liquid Home: the number helpers live in @decibel95/liquid-core. The dial geometry below stays here.
export { clamp, valueToFraction, snap, decimalsForStep } from '@decibel95/liquid-core';

/** Dial geometry. The viewBox is 400 x 400, arcs span 270 degrees from 135. */
export const CX = 200;
export const CY = 200;
export const START = 135;
export const SWEEP = 270;
export const R_TEMP = 138;
export const R_FAN = 170;

export function pt(r: number, angleDeg: number): [number, number] {
  const t = (angleDeg * Math.PI) / 180;
  return [CX + r * Math.cos(t), CY + r * Math.sin(t)];
}

export function arcPath(r: number, a0: number, a1: number): string {
  if (a1 - a0 < 0.3) a1 = a0 + 0.3;
  const p = pt(r, a0);
  const q = pt(r, a1);
  return `M ${p[0].toFixed(2)} ${p[1].toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${q[0].toFixed(2)} ${q[1].toFixed(2)}`;
}

export function fractionToAngle(f: number): number {
  return START + f * SWEEP;
}

/** Pointer position (in viewBox units) to a 0..1 fraction along the 270 degree arc. */
export function pointToFraction(x: number, y: number): number {
  const a = (Math.atan2(y - CY, x - CX) * 180) / Math.PI;
  let rel = (((a - START) % 360) + 360) % 360;
  // The 90 degree gap at the bottom snaps to the nearer end of the arc.
  if (rel > SWEEP) rel = rel > 315 ? 0 : SWEEP;
  return rel / SWEEP;
}

export type Zone = 'fan' | 'temp' | null;

export function zoneForDistance(d: number): Zone {
  if (d > 156 && d < 200) return 'fan';
  if (d > 104 && d <= 156) return 'temp';
  return null;
}

export function fanSegments(n: number, gap = 4): { a0: number; a1: number }[] {
  const w = (SWEEP - (n - 1) * gap) / n;
  return Array.from({ length: n }, (_, i) => {
    const a0 = START + i * (w + gap);
    return { a0, a1: a0 + w };
  });
}

export function fanIndexFromFraction(f: number, n: number): number {
  return clamp(Math.floor(f * n), 0, n - 1);
}

/** Which fan segments are lit. When the first mode is "auto" it lights alone; the "off" fan mode (offIndex) is never lit. */
export function litFanSegments(index: number, n: number, firstIsAuto: boolean, offIndex = -1): boolean[] {
  return Array.from({ length: n }, (_, i) => {
    if (index < 0 || i === offIndex || index === offIndex) return false;
    if (firstIsAuto) return index === 0 ? i === 0 : i > 0 && i <= index;
    return i <= index;
  });
}

export interface Tick {
  value: number;
  angle: number;
  major: boolean;
  label: boolean;
}

/**
 * Tick spacing of the dial scale. Climate always ticks every degree. A water heater or humidifier
 * takes the smallest of 1, 2, 5 and 10 that keeps the scale to 35 ticks, so a 0 to 100 humidity
 * range is as airy as a climate dial.
 */
export function tickInterval(domain: string, min: number, max: number): number {
  if (domain === 'climate') return 1;
  return [1, 2, 5, 10].find((k) => Math.floor(max / k) - Math.ceil(min / k) + 1 <= 35) ?? 10;
}

/** A tick every k, a major every 5k and a label every 10k, on multiples of k. */
export function buildTicks(min: number, max: number, k = 1): Tick[] {
  const ticks: Tick[] = [];
  for (let t = Math.ceil(min / k) * k; t <= Math.floor(max); t += k) {
    ticks.push({
      value: t,
      angle: fractionToAngle(valueToFraction(t, min, max)),
      major: t % (5 * k) === 0,
      label: t % (10 * k) === 0,
    });
  }
  return ticks;
}
