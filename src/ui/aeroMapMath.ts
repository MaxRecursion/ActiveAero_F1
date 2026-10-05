/**
 * Station 6 helpers for the aero-map chart and the floor-pressure plot: contour lines over a
 * gridded field (marching squares), a perceptual colour ramp, grid sampling, axis ticks and a
 * simple label placer. Pure functions over numbers — no DOM, no physics — so they are unit tested.
 */

// ── contours ─────────────────────────────────────────────────────────────────────

/**
 * Edge pairs crossed in each marching-squares case. Corners: bit 0 bottom-left (i, j), bit 1
 * bottom-right (i+1, j), bit 2 top-right (i+1, j+1), bit 3 top-left (i, j+1); a set bit means the
 * corner is at or above the level. Edges: 0 bottom, 1 right, 2 top, 3 left. Cases 5 and 10 are
 * saddles, resolved below by the cell's centre value.
 */
const CASES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [],
  [[3, 0]],
  [[0, 1]],
  [[3, 1]],
  [[1, 2]],
  [], // saddle
  [[0, 2]],
  [[3, 2]],
  [[2, 3]],
  [[0, 2]],
  [], // saddle
  [[1, 2]],
  [[3, 1]],
  [[0, 1]],
  [[3, 0]],
  [],
];
/** Saddle segments when the centre is inside (joins the two "inside" corners) or outside. */
const SADDLE: Record<5 | 10, { inside: [number, number][]; outside: [number, number][] }> = {
  5: { inside: [[0, 1], [2, 3]], outside: [[3, 0], [1, 2]] },
  10: { inside: [[3, 0], [1, 2]], outside: [[0, 1], [2, 3]] },
};

/**
 * Lines where a gridded field crosses `level`. `values` is row-major: index = j·nx + i (j is the
 * row, e.g. rear ride height; i the column, e.g. front ride height). Returns polylines as flat
 * arrays of fractional grid coordinates [i0, j0, i1, j1, …]; a closed loop repeats its first point.
 * Cells with a non-finite corner are skipped.
 */
export function contours(values: ArrayLike<number>, nx: number, ny: number, level: number): number[][] {
  // Each crossing lives on one grid edge, keyed 2·(j·nx + i) (horizontal, from (i, j) to (i+1, j))
  // or 2·(j·nx + i) + 1 (vertical, from (i, j) to (i, j+1)). Two cells share an edge, so joining
  // segments by key turns the cell soup into polylines.
  const points = new Map<number, [number, number]>();
  const links = new Map<number, number[]>();
  const point = (key: number): void => {
    if (points.has(key)) return;
    const cell = key >> 1;
    const i = cell % nx;
    const j = (cell - i) / nx;
    const vertical = (key & 1) === 1;
    const a = values[cell];
    const b = values[vertical ? cell + nx : cell + 1];
    const t = a === b ? 0.5 : Math.min(1, Math.max(0, (level - a) / (b - a)));
    points.set(key, vertical ? [i, j + t] : [i + t, j]);
  };
  const link = (a: number, b: number): void => {
    if (a === b) return;
    point(a);
    point(b);
    (links.get(a) ?? links.set(a, []).get(a)!).push(b);
    (links.get(b) ?? links.set(b, []).get(b)!).push(a);
  };

  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const k = j * nx + i;
      const v0 = values[k];
      const v1 = values[k + 1];
      const v2 = values[k + nx + 1];
      const v3 = values[k + nx];
      if (!Number.isFinite(v0) || !Number.isFinite(v1) || !Number.isFinite(v2) || !Number.isFinite(v3)) continue;
      const c = (v0 >= level ? 1 : 0) | (v1 >= level ? 2 : 0) | (v2 >= level ? 4 : 0) | (v3 >= level ? 8 : 0);
      if (c === 0 || c === 15) continue;
      const edgeKey = [2 * k, 2 * (k + 1) + 1, 2 * (k + nx), 2 * k + 1];
      const pairs = c === 5 || c === 10 ? SADDLE[c][(v0 + v1 + v2 + v3) / 4 >= level ? 'inside' : 'outside'] : CASES[c];
      for (const [e0, e1] of pairs) link(edgeKey[e0], edgeKey[e1]);
    }
  }

  // Walk the chains: start at an open end where there is one, so open lines come out whole.
  const used = new Set<string>();
  const edgeId = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const out: number[][] = [];
  const walk = (start: number): number[] => {
    const line: number[] = [...points.get(start)!];
    let prev = -1;
    let cur = start;
    for (;;) {
      const next = (links.get(cur) ?? []).find((n) => n !== prev && !used.has(edgeId(cur, n)));
      if (next === undefined) break;
      used.add(edgeId(cur, next));
      line.push(...points.get(next)!);
      prev = cur;
      cur = next;
      if (cur === start) break;
    }
    return line;
  };
  for (const [key, nbrs] of links) if (nbrs.length === 1 && !used.has(edgeId(key, nbrs[0]))) out.push(walk(key));
  for (const [key, nbrs] of links) for (const n of nbrs) if (!used.has(edgeId(key, n))) out.push(walk(key));
  return out.filter((l) => l.length >= 4);
}

/** Field value at fractional grid coordinates (bilinear, clamped to the grid). */
export function sampleGrid(values: ArrayLike<number>, nx: number, ny: number, fi: number, fj: number): number {
  const x = Math.min(nx - 1, Math.max(0, fi));
  const y = Math.min(ny - 1, Math.max(0, fj));
  const i = Math.min(nx - 2, Math.floor(x));
  const j = Math.min(ny - 2, Math.floor(y));
  const tx = x - i;
  const ty = y - j;
  const k = j * nx + i;
  const bottom = values[k] + (values[k + 1] - values[k]) * tx;
  const top = values[k + nx] + (values[k + nx + 1] - values[k + nx]) * tx;
  return bottom + (top - bottom) * ty;
}

/** Values from `from` to `to` (inclusive, within a small tolerance) in steps of `step`, starting on a multiple of it. */
export function ticks(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  const first = Math.ceil(from / step - 1e-9);
  for (let k = first; k * step <= to + 1e-9; k++) out.push(Math.round(k * step * 1e6) / 1e6 + 0); // + 0: never "-0"
  return out;
}

// ── colour ───────────────────────────────────────────────────────────────────────

export type RGB = [number, number, number];

/** "#rgb", "#rrggbb" or "rgb(r g b)" / "rgb(r, g, b)" → 0–255 channels; null if unreadable. */
export function parseColor(css: string): RGB | null {
  const s = css.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [0, 1, 2].map((n) => parseInt(m![1][n] + m![1][n], 16)) as RGB;
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map((n) => parseInt(m![1].slice(n, n + 2), 16)) as RGB;
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

const toLinear = (c: number) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (x: number) => {
  const c = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};

/** sRGB (0–255) → OKLab (Ottosson 2020). */
export function toOklab([r8, g8, b8]: RGB): [number, number, number] {
  const r = toLinear(r8);
  const g = toLinear(g8);
  const b = toLinear(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab → sRGB (0–255, clipped to the gamut). */
export function fromOklab([L, a, b]: [number, number, number]): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/**
 * A lookup table of `n` colours along a ramp through `stops` (evenly spaced), interpolated in
 * OKLab so equal steps in value look like equal steps in colour. Packed as r, g, b bytes.
 */
export function rampTable(stops: readonly RGB[], n = 256): Uint8ClampedArray {
  const lab = stops.map(toOklab);
  const out = new Uint8ClampedArray(n * 3);
  for (let k = 0; k < n; k++) {
    const t = (k / (n - 1)) * (lab.length - 1);
    const i = Math.min(lab.length - 2, Math.floor(t));
    const f = t - i;
    const c = fromOklab([0, 1, 2].map((d) => lab[i][d] + (lab[i + 1][d] - lab[i][d]) * f) as [number, number, number]);
    out[3 * k] = c[0];
    out[3 * k + 1] = c[1];
    out[3 * k + 2] = c[2];
  }
  return out;
}

export const hex = ([r, g, b]: RGB): string => `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;

// ── labels ───────────────────────────────────────────────────────────────────────

export interface LabelSpot {
  x: number;
  y: number;
  /** Direction of the line there, degrees, turned to read left to right. */
  angle: number;
}

/**
 * The most open spot along a polyline (pixel coordinates, flat [x0, y0, x1, y1, …]) for a label:
 * at least `margin` inside `box` and as far as possible from `avoid` points (other labels, the
 * markers), sampled every `step` px of arc length. Null when no sample fits inside the box.
 */
export function labelSpot(
  line: ArrayLike<number>,
  box: { x0: number; y0: number; x1: number; y1: number },
  avoid: ReadonlyArray<{ x: number; y: number }>,
  margin = 14,
  step = 12,
): LabelSpot | null {
  let best: LabelSpot | null = null;
  let bestScore = -Infinity;
  let acc = 0;
  let next = 0;
  for (let p = 0; p + 3 < line.length; p += 2) {
    const ax = line[p];
    const ay = line[p + 1];
    const dx = line[p + 2] - ax;
    const dy = line[p + 3] - ay;
    const len = Math.hypot(dx, dy);
    for (; len > 0 && next <= acc + len; next += step) {
      const s = next - acc;
      const x = ax + (dx * s) / len;
      const y = ay + (dy * s) / len;
      const edge = Math.min(x - box.x0, box.x1 - x, y - box.y0, box.y1 - y);
      if (edge < margin) continue;
      let near = Infinity;
      for (const a of avoid) near = Math.min(near, Math.hypot(a.x - x, a.y - y));
      // Prefer open space; past ~60 px from everything, prefer the middle of the plot.
      const score = Math.min(near, 60) + Math.min(edge, 40) * 0.25;
      if (score > bestScore) {
        bestScore = score;
        let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (angle > 90) angle -= 180;
        else if (angle < -90) angle += 180;
        best = { x, y, angle };
      }
    }
    acc += len;
  }
  return best;
}
