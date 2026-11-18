import { describe, expect, it } from 'vitest';
import {
  CX,
  CY,
  arcPath,
  buildTicks,
  decimalsForStep,
  fanIndexFromFraction,
  fanSegments,
  fractionToAngle,
  litFanSegments,
  pointToFraction,
  pt,
  snap,
  valueToFraction,
  zoneForDistance,
} from '../src/ui/geometry';

describe('arc and angle math', () => {
  it('maps the scale ends to 135 and 405 degrees', () => {
    expect(fractionToAngle(valueToFraction(10, 10, 30))).toBe(135);
    expect(fractionToAngle(valueToFraction(30, 10, 30))).toBe(405);
    expect(fractionToAngle(valueToFraction(20, 10, 30))).toBe(270);
  });

  it('clamps values outside the scale', () => {
    expect(valueToFraction(5, 10, 30)).toBe(0);
    expect(valueToFraction(99, 10, 30)).toBe(1);
  });

  it('places points on the circle', () => {
    const [x, y] = pt(100, 0);
    expect(x).toBeCloseTo(CX + 100);
    expect(y).toBeCloseTo(CY);
    const [bx, by] = pt(100, 90);
    expect(bx).toBeCloseTo(CX);
    expect(by).toBeCloseTo(CY + 100);
  });

  it('uses the large-arc flag past 180 degrees', () => {
    expect(arcPath(138, 135, 405)).toMatch(/A 138 138 0 1 1/);
    expect(arcPath(138, 135, 200)).toMatch(/A 138 138 0 0 1/);
  });

  it('never draws a zero-length arc', () => {
    expect(arcPath(138, 135, 135)).toBe(arcPath(138, 135, 135.3));
  });

  it('converts pointer positions to arc fractions', () => {
    // Bottom-left start of the arc (135 degrees).
    const [sx, sy] = pt(138, 135);
    expect(pointToFraction(sx, sy)).toBeCloseTo(0, 5);
    // Top (270 degrees) is the middle.
    const [tx, ty] = pt(138, 270);
    expect(pointToFraction(tx, ty)).toBeCloseTo(0.5, 5);
    // Bottom-right end (405 = 45 degrees).
    const [ex, ey] = pt(138, 45);
    expect(pointToFraction(ex, ey)).toBeCloseTo(1, 5);
  });

  it('snaps the bottom gap to the nearer end', () => {
    // 100 degrees is just past the start side of the gap... rel = 325, nearer to 0.
    const [lx, ly] = pt(138, 100);
    expect(pointToFraction(lx, ly)).toBe(0);
    // 70 degrees is inside the gap close to the end: rel = 295, nearer to 270.
    const [rx, ry] = pt(138, 70);
    expect(pointToFraction(rx, ry)).toBe(1);
  });

  it('snaps to the step and trims float noise', () => {
    expect(snap(20.26, 0.5, 10, 30)).toBe(20.5);
    expect(snap(20.24, 0.5, 10, 30)).toBe(20);
    expect(snap(99, 0.5, 10, 30)).toBe(30);
    expect(snap(16.3, 1, 15, 28)).toBe(16);
    expect(snap(0.3 + 0.6, 0.1, 0, 5)).toBe(0.9);
  });

  it('picks decimals from the step', () => {
    expect(decimalsForStep(0.5)).toBe(1);
    expect(decimalsForStep(0.1)).toBe(1);
    expect(decimalsForStep(0.25)).toBe(2);
    expect(decimalsForStep(1)).toBe(0);
  });

  it('assigns drag zones by radius', () => {
    expect(zoneForDistance(170)).toBe('fan');
    expect(zoneForDistance(138)).toBe('temp');
    expect(zoneForDistance(50)).toBe(null);
    expect(zoneForDistance(210)).toBe(null);
  });
});

describe('fan ring', () => {
  it('splits 270 degrees into n segments with 4 degree gaps', () => {
    const segs = fanSegments(7);
    expect(segs).toHaveLength(7);
    expect(segs[0].a0).toBe(135);
    expect(segs[6].a1).toBeCloseTo(405, 5);
    expect(segs[1].a0 - segs[0].a1).toBeCloseTo(4, 5);
  });

  it('handles a single segment', () => {
    const [s] = fanSegments(1);
    expect(s.a0).toBe(135);
    expect(s.a1).toBe(405);
  });

  it('maps fractions to indexes', () => {
    expect(fanIndexFromFraction(0, 7)).toBe(0);
    expect(fanIndexFromFraction(0.5, 7)).toBe(3);
    expect(fanIndexFromFraction(1, 7)).toBe(6);
  });

  it('lights auto alone, otherwise cumulatively', () => {
    expect(litFanSegments(0, 7, true)).toEqual([true, false, false, false, false, false, false]);
    expect(litFanSegments(2, 7, true)).toEqual([false, true, true, false, false, false, false]);
    expect(litFanSegments(1, 3, false)).toEqual([true, true, false]);
  });
});

describe('ticks', () => {
  it('has one tick per whole unit, majors every 5, labels every 10', () => {
    const ticks = buildTicks(10, 30);
    expect(ticks).toHaveLength(21);
    expect(ticks.filter((t) => t.major).map((t) => t.value)).toEqual([10, 15, 20, 25, 30]);
    expect(ticks.filter((t) => t.label).map((t) => t.value)).toEqual([10, 20, 30]);
  });

  it.each([
    [7, 35, 29, 6, 3],
    [10, 30, 21, 5, 3],
    [16, 30, 15, 3, 2],
    [45, 95, 51, 11, 5],
  ])('climate span %i to %i is pinned: %i ticks, %i majors, %i labels', (min, max, n, majors, labels) => {
    const ticks = buildTicks(min, max);
    expect([ticks.length, ticks.filter((t) => t.major).length, ticks.filter((t) => t.label).length]).toEqual([n, majors, labels]);
  });

  it('copes with fractional bounds', () => {
    const ticks = buildTicks(4.5, 9.5);
    expect(ticks.map((t) => t.value)).toEqual([5, 6, 7, 8, 9]);
  });
});
