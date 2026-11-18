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

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Position of a value on the scale, 0..1. */
export function valueToFraction(v: number, min: number, max: number): number {
  if (max <= min) return 0;
  return clamp((v - min) / (max - min), 0, 1);
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

/**
 * The value on the step grid that starts at `origin` (min by default), clamped to the limits. Climate
 * steps from min; a water heater or humidifier passes 0, so limits of 43.3 to 60 step 45, 46, 47.
 */
export function snap(v: number, step: number, min: number, max: number, origin = min): number {
  const s = step > 0 ? step : 1;
  const snapped = Math.round((v - origin) / s) * s + origin;
  // Trim float noise (e.g. 20.500000000000004).
  return clamp(Number(snapped.toFixed(4)), min, max);
}

export function decimalsForStep(step: number): number {
  if (step >= 1) return 0;
  return Math.abs(step * 10 - Math.round(step * 10)) < 1e-9 ? 1 : 2;
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

export function buildTicks(min: number, max: number, wide = false): Tick[] {
  const ticks: Tick[] = [];
  // A wide scale (humidity 0 to 100) ticks every 2, majors every 10 and labels every 20.
  const every = wide && max - min > 60 ? 2 : 1;
  for (let t = Math.ceil(min / every) * every; t <= Math.floor(max); t += every) {
    ticks.push({
      value: t,
      angle: fractionToAngle(valueToFraction(t, min, max)),
      major: t % (5 * every) === 0,
      label: t % (10 * every) === 0,
    });
  }
  return ticks;
}
