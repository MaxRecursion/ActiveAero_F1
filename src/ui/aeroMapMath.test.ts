import { describe, expect, it } from 'vitest';
import { contours, fromOklab, hex, labelSpot, parseColor, rampTable, sampleGrid, ticks, toOklab } from './aeroMapMath';

/** Build a row-major grid from f(i, j). */
function grid(nx: number, ny: number, f: (i: number, j: number) => number): Float64Array {
  const v = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = f(i, j);
  return v;
}

const pointsOf = (line: number[]) => Array.from({ length: line.length / 2 }, (_, k) => [line[2 * k], line[2 * k + 1]]);

describe('contours (marching squares)', () => {
  it('finds a straight line through a linear field, as one polyline, at the right place', () => {
    const v = grid(6, 5, (i) => i); // level 2.5 crosses at i = 2.5 on every row
    const lines = contours(v, 6, 5, 2.5);
    expect(lines).toHaveLength(1);
    const pts = pointsOf(lines[0]);
    expect(pts).toHaveLength(5);
    for (const [x] of pts) expect(x).toBeCloseTo(2.5, 9);
    const ys = pts.map(([, y]) => y).sort((a, b) => a - b);
    expect(ys).toEqual([0, 1, 2, 3, 4]);
  });

  it('interpolates a diagonal field linearly along each edge', () => {
    const v = grid(5, 5, (i, j) => i + j);
    const [line] = contours(v, 5, 5, 3.25);
    for (const [x, y] of pointsOf(line)) expect(x + y).toBeCloseTo(3.25, 9);
  });

  it('closes a loop around a peak and repeats its first point', () => {
    const n = 21;
    const v = grid(n, n, (i, j) => -Math.hypot(i - 10, j - 10));
    const lines = contours(v, n, n, -5);
    expect(lines).toHaveLength(1);
    const pts = pointsOf(lines[0]);
    expect(pts[0][0]).toBeCloseTo(pts[pts.length - 1][0], 12);
    expect(pts[0][1]).toBeCloseTo(pts[pts.length - 1][1], 12);
    for (const [x, y] of pts) expect(Math.hypot(x - 10, y - 10)).toBeGreaterThan(4.8);
    for (const [x, y] of pts) expect(Math.hypot(x - 10, y - 10)).toBeLessThan(5.05);
  });

  it('resolves a saddle by the centre value and never crosses its own lines', () => {
    // Corners 1, 0 / 0, 1 (bottom-left and top-right high): the centre (0.5) decides.
    const v = Float64Array.from([1, 0, 0, 1]);
    const joined = contours(v, 2, 2, 0.4); // centre inside → the high corners join, two segments cut off the low ones
    const split = contours(v, 2, 2, 0.6); // centre outside → two segments cut off the high corners
    expect(joined).toHaveLength(2);
    expect(split).toHaveLength(2);
    // Joined: each segment cuts off a LOW corner, so it stays near (1, 0) or (0, 1).
    for (const l of joined) {
      const [[x0, y0], [x1, y1]] = pointsOf(l);
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      expect(Math.abs(mx - my)).toBeGreaterThan(0.3);
    }
  });

  it('returns nothing when the level is outside the field, and skips non-finite cells', () => {
    const v = grid(4, 4, (i) => i);
    expect(contours(v, 4, 4, 10)).toEqual([]);
    v[5] = NaN;
    expect(() => contours(v, 4, 4, 1.5)).not.toThrow();
  });
});

describe('sampleGrid', () => {
  it('is exact on the nodes and bilinear between them, clamped outside', () => {
    const v = grid(3, 3, (i, j) => 10 * j + i);
    expect(sampleGrid(v, 3, 3, 1, 2)).toBe(21);
    expect(sampleGrid(v, 3, 3, 0.5, 0.5)).toBeCloseTo(5.5, 12);
    expect(sampleGrid(v, 3, 3, 1.25, 1.75)).toBeCloseTo(18.75, 12);
    expect(sampleGrid(v, 3, 3, -1, 9)).toBe(20);
    expect(sampleGrid(v, 3, 3, 2, 2)).toBe(22);
  });
});

describe('ticks', () => {
  it('starts on a multiple of the step and includes the end', () => {
    expect(ticks(10, 150, 20)).toEqual([20, 40, 60, 80, 100, 120, 140]);
    expect(ticks(0, 60, 10)).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(ticks(2.05, 3.6, 0.4)).toEqual([2.4, 2.8, 3.2, 3.6]);
  });
});

describe('colour', () => {
  it('parses hex and rgb() colours', () => {
    expect(parseColor('#2356f6')).toEqual([0x23, 0x56, 0xf6]);
    expect(parseColor(' #fff ')).toEqual([255, 255, 255]);
    expect(parseColor('rgb(1 2 3)')).toEqual([1, 2, 3]);
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual([10, 20, 30]);
    expect(parseColor('blue')).toBeNull();
  });

  it('round-trips through OKLab', () => {
    for (const c of [[0, 0, 0], [255, 255, 255], [35, 86, 246], [242, 85, 29], [18, 163, 109]] as const) {
      expect(fromOklab(toOklab([...c]))).toEqual([...c]);
    }
    expect(toOklab([255, 255, 255])[0]).toBeCloseTo(1, 3);
  });

  it('builds a ramp whose ends are the stops and whose lightness is monotone', () => {
    const stops = [parseColor('#eef1f8')!, parseColor('#2356f6')!, parseColor('#0b1f6b')!];
    const t = rampTable(stops, 64);
    expect(hex([t[0], t[1], t[2]])).toBe('#eef1f8');
    expect(hex([t[63 * 3], t[63 * 3 + 1], t[63 * 3 + 2]])).toBe('#0b1f6b');
    let prev = Infinity;
    for (let k = 0; k < 64; k++) {
      const L = toOklab([t[3 * k], t[3 * k + 1], t[3 * k + 2]])[0];
      expect(L).toBeLessThanOrEqual(prev + 1e-3);
      prev = L;
    }
  });
});

describe('labelSpot', () => {
  const box = { x0: 0, y0: 0, x1: 200, y1: 100 };

  it('stays inside the box and away from points to avoid', () => {
    const line = [0, 50, 200, 50];
    const spot = labelSpot(line, box, [{ x: 40, y: 50 }])!;
    expect(spot.y).toBe(50);
    expect(spot.x).toBeGreaterThan(14);
    expect(spot.x).toBeLessThan(186);
    expect(Math.abs(spot.x - 40)).toBeGreaterThanOrEqual(60);
  });

  it('turns the text to read left to right', () => {
    const spot = labelSpot([180, 90, 20, 10], box, [])!;
    expect(spot.angle).toBeGreaterThan(-90);
    expect(spot.angle).toBeLessThanOrEqual(90);
  });

  it('gives up when the line never comes inside the margin', () => {
    expect(labelSpot([0, 2, 200, 2], box, [])).toBeNull();
  });
});
