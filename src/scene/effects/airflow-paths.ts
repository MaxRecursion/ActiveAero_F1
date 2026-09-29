/**
 * Illustrative streamlines around the car — shaped by the car's real geometry, but NOT CFD.
 *
 * Each line starts in uniform air ahead of the car and is bent by simple, readable rules:
 *  - over the body it keeps a small clearance above the car's upper envelope, and starts rising
 *    BEFORE an obstacle (the air "knows" the car is coming) and settles slowly behind it;
 *  - a wing either carries the line over its top or under its suction side, and turns the air
 *    UPWARD behind it (upwash — the reaction to that turn is the wing's downforce);
 *  - under the floor the line runs through the middle of the gap between floor and road.
 *
 * Every sample carries a speed factor (1 = free stream). Under the floor it comes from continuity:
 * the same air through a narrower gap must move faster (and, by Bernoulli, at lower pressure —
 * which is what pulls the car down). Over the body, air slows where it has to climb (stagnation
 * ahead of the nose and tyres) and speeds up a little over the crests and around the wings.
 *
 * Active aero (2026): every line is traced twice, around the wings with the flaps closed (Corner
 * Mode) and open (Straight Mode). Open flaps turn the air less, so the upwash behind them is
 * weaker — much weaker behind the rear wing, whose flap does most of its turning, and only a
 * little behind the front wing, whose mainplane keeps working. The floor keeps working in both
 * modes, so the under-floor lines are the same path in both.
 */
import * as THREE from 'three';
import type { HeightField } from './airflow-heightfield';

/** Where lines start and end (car frame x) and the sample spacing along them (metres). */
export const X_IN = 4.5;
export const X_OUT = -5.0;
const DX = 0.04;
const N = Math.round((X_IN - X_OUT) / DX) + 1;

/** Half-width of the strip of car a line "feels" either side of its own z. */
const BAND = 0.04;
/** Clearance kept between a line and the surface it flows over or under. */
const CLEARANCE = 0.05;
/** How steeply a line rises ahead of an obstacle, and how slowly it settles behind it (m per m). */
const RISE_AHEAD = 0.55;
const SETTLE_BEHIND = 0.3;

/** Floor gap at the tunnel inlets and at the throat (m): the range the continuity speed-up maps. */
const GAP_INLET = 0.2;
const GAP_THROAT = 0.045;
/** Surfaces higher than this over the road are not a "roof" for the under-floor flow. */
const ROOF_MAX = 0.3;
/** Peak under-floor speed factor at the throat (illustrative). */
const FLOOR_SPEEDUP = 0.5;
/** Leading edge of the floor: ahead of it, a gap overhead belongs to the front wing. */
const FLOOR_FRONT_X = 1.45;
/** Lines are x-rayed only from here back, clear of the front tyres (which would ghost them too). */
const XRAY_FROM_X = 1.2;

/** Upwash of each wing in Straight Mode, relative to Corner Mode (illustrative). */
const OPEN_UPWASH_FRONT = 0.7;
const OPEN_UPWASH_REAR = 0.2;

/** Wheel positions (car frame): axles at ±1.70, tyre mid-width at |z| ≈ 0.8. */
const AXLE_X = 1.7;
const TYRE_MID_Z = 0.8;
/** Lines outboard of this |z| feel the wheels. */
const WHEEL_LINE_Z = 0.66;

export type LineKind = 'under' | 'over';

export interface LineSpec {
  kind: LineKind;
  /** Lateral station in free stream (mirrored to -z when > 0). */
  z: number;
  /** Inlet height in free stream. */
  y: number;
  /** Visual weight 0–1: the under-floor lines are the lesson, the rest are context. */
  weight: number;
}

/**
 * About forty lines in all. Under-floor lines fan through the Venturi tunnels; over-body lines
 * sample the nose/cockpit ridge, the sidepods, the wheel line and the rear wing; two outboard
 * lines show air parting around the tyres.
 */
const SPECS: readonly LineSpec[] = [
  { kind: 'under', z: 0.2, y: 0.11, weight: 1 },
  { kind: 'under', z: 0.33, y: 0.11, weight: 1 },
  { kind: 'under', z: 0.46, y: 0.11, weight: 1 },
  { kind: 'under', z: 0.59, y: 0.11, weight: 1 },
  { kind: 'over', z: 0, y: 0.3, weight: 0.85 },
  { kind: 'over', z: 0, y: 0.74, weight: 0.7 },
  { kind: 'over', z: 0, y: 1.18, weight: 0.5 },
  { kind: 'over', z: 0.2, y: 0.52, weight: 0.7 },
  { kind: 'over', z: 0.3, y: 0.7, weight: 0.75 },
  { kind: 'over', z: 0.3, y: 0.92, weight: 0.75 },
  { kind: 'over', z: 0.42, y: 0.36, weight: 0.7 },
  { kind: 'over', z: 0.5, y: 0.16, weight: 0.8 },
  { kind: 'over', z: 0.6, y: 0.58, weight: 0.6 },
  { kind: 'over', z: 0.8, y: 0.3, weight: 0.65 },
  { kind: 'over', z: 0.8, y: 0.95, weight: 0.45 },
  { kind: 'over', z: 1.12, y: 0.22, weight: 0.5 },
  { kind: 'over', z: 1.12, y: 0.55, weight: 0.45 },
];

/** One mode's path: xyz per sample (car frame, running downstream from +X toward -X) and speed. */
export interface FlowPath {
  points: Float32Array;
  /** Local speed / free-stream speed per sample. */
  speed: Float32Array;
}

export interface Streamline {
  kind: LineKind;
  /** Corner Mode (flaps closed). */
  corner: FlowPath;
  /** Straight Mode (flaps open); the same sample count, so the two blend point by point. */
  open: FlowPath;
  /** Per-sample opacity (fade in/out at the ends × the line's visual weight). */
  alpha: Float32Array;
  /** Per-sample 0–1: how much the line shows THROUGH the car (only while it is under the floor). */
  xray: Float32Array;
}

export interface CarEnvelope {
  /** Everything except the wings. */
  body: HeightField;
  /** Front and rear wings only, flaps closed (so a line can pass between a wing and the body below it). */
  wings: HeightField;
  /** The same wings with the flaps open (Straight Mode). */
  wingsOpen: HeightField;
}

/** How much of its Corner Mode upwash each wing gives. */
interface Upwash {
  front: number;
  rear: number;
}
const CORNER: Upwash = { front: 1, rear: 1 };
const STRAIGHT: Upwash = { front: OPEN_UPWASH_FRONT, rear: OPEN_UPWASH_REAR };

const xAt = (i: number) => X_IN - i * DX;
const smoothstep = THREE.MathUtils.smoothstep;
const clamp = THREE.MathUtils.clamp;
const gauss = (d: number, sigma: number) => Math.exp(-0.5 * (d / sigma) ** 2);

export function traceStreamlines(env: CarEnvelope): Streamline[] {
  const lines: Streamline[] = [];
  for (const spec of SPECS) {
    const sides = spec.z > 0 ? [1, -1] : [1];
    for (const side of sides) {
      if (spec.kind === 'under') {
        const trace = traceUnder(spec, env);
        const path = toPath(trace, side);
        lines.push({ kind: spec.kind, corner: path, open: path, alpha: fades(spec.weight), xray: trace.xray });
      } else {
        const corner = toPath(traceOver(spec, env.body, env.wings, CORNER), side);
        const open = toPath(traceOver(spec, env.body, env.wingsOpen, STRAIGHT), side);
        lines.push({ kind: spec.kind, corner, open, alpha: fades(spec.weight), xray: new Float32Array(N) });
      }
    }
  }
  return lines;
}

interface Trace {
  y: Float32Array;
  z: Float32Array;
  speed: Float32Array;
}

function toPath(trace: Trace, side: number): FlowPath {
  const points = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) points.set([xAt(i), trace.y[i], side * trace.z[i]], i * 3);
  return { points, speed: trace.speed };
}

// ── under the floor ──────────────────────────────────────────────────────────────

/** The tunnels pinch inboard toward the diffuser (the floor narrows ahead of the rear tyres). */
function tunnelTaper(x: number): number {
  const pinch = 1 - smoothstep(x, -1.7, -0.9);
  const release = 1 - 0.5 * (1 - smoothstep(x, -4.2, -2.4));
  return 1 - 0.36 * pinch * release;
}

/**
 * Height of the roof over the road at (x, z): the floor's underside or the front wing's, if one is
 * low enough to count as a roof. Median of three probes across the line, so a thin fence or strake
 * hanging from the tunnel roof does not read as the roof itself.
 */
function roofOver(env: CarEnvelope, x: number, z: number): number {
  const probe = (dz: number) => Math.min(env.body.bottom(x, z + dz, 0), env.wings.bottom(x, z + dz, 0));
  const [, mid] = [probe(-0.03), probe(0), probe(0.03)].sort((p, q) => p - q);
  return mid < ROOF_MAX ? mid : Infinity;
}

function traceUnder(spec: LineSpec, env: CarEnvelope): Trace & { xray: Float32Array } {
  const z = new Float32Array(N);
  const gap = new Float32Array(N);
  let first = -1;
  let last = -1;
  for (let i = 0; i < N; i++) {
    const x = xAt(i);
    z[i] = spec.z * tunnelTaper(x);
    gap[i] = roofOver(env, x, z[i]);
    if (Number.isFinite(gap[i])) {
      if (first < 0) first = i;
      last = i;
    }
  }

  // Mid-gap under the car; level air ahead; behind the diffuser the flow keeps rising and
  // spreading as it slows back to free stream.
  const y = new Float32Array(N);
  let prev = spec.y;
  for (let i = 0; i < N; i++) {
    if (i < first) y[i] = spec.y;
    else if (i <= last) y[i] = Number.isFinite(gap[i]) ? Math.max(0.018, 0.5 * gap[i]) : prev;
    else y[i] = y[last] + 0.36 * smoothstep(xAt(last) - xAt(i), 0, 2.6);
    prev = y[i];
  }
  smooth(y, 3);
  for (let i = first; i <= last; i++) {
    if (Number.isFinite(gap[i])) y[i] = clamp(y[i], 0.016, gap[i] - 0.012);
  }
  smooth(y, 1);

  // Continuity: narrower gap → faster air. Strongest under the floor; the front wing, also in
  // ground effect, gets a milder share.
  const speed = new Float32Array(N);
  const xray = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = xAt(i);
    const covered = Number.isFinite(gap[i]);
    const squeeze = covered ? clamp((GAP_INLET - gap[i]) / (GAP_INLET - GAP_THROAT), 0, 1) : 0;
    const underFloor = x < FLOOR_FRONT_X;
    speed[i] = 1 + FLOOR_SPEEDUP * (underFloor ? 1 : 0.45) * squeeze;
    xray[i] = covered && x < XRAY_FROM_X ? 1 : 0;
  }
  smooth(speed, 4);
  smooth(xray, 3);
  return { y, z, speed, xray };
}

// ── over the body and wings ──────────────────────────────────────────────────────

/**
 * Lateral path: low lines out by the wheels part AROUND the tyres (and more so the closer they
 * pass), instead of climbing them; lines above the tyres and lines inboard of them run straight.
 */
function lateral(z0: number, y0: number, x: number): number {
  if (z0 < WHEEL_LINE_Z) return z0;
  const reach = Math.exp(-Math.abs(z0 - TYRE_MID_Z) / 0.35) * (1 - smoothstep(y0, 0.55, 0.9));
  return z0 + reach * (0.3 * gauss(x - AXLE_X, 0.42) + 0.26 * gauss(x + AXLE_X, 0.48));
}

/** A wing the line has just crossed: where it leaves the wing and how closely it touched it. */
interface Wake {
  end: number;
  rear: boolean;
  strength: number;
}

/**
 * Upwash: from the wing's trailing edge the air is turned upward. Behind the rear wing the rise
 * persists (the wake leaves the tunnel high); behind the front wing it is a local lift that
 * relaxes again, since the car's own body takes over the shaping further back.
 */
function applyUpwash(y: Float32Array, wake: Wake, upwash: Upwash): void {
  const y0 = y[wake.end];
  const x0 = xAt(wake.end);
  for (let i = wake.end + 1; i < N; i++) {
    const d = x0 - xAt(i);
    const rise = wake.rear
      ? upwash.rear * 0.42 * smoothstep(d, 0, 2.4)
      : upwash.front * 0.14 * smoothstep(d, 0, 0.6) * (1 - smoothstep(d, 0.9, 2.4));
    y[i] = Math.max(y[i], y0 + wake.strength * rise);
  }
}

function traceOver(spec: LineSpec, body: HeightField, wings: HeightField, upwash: Upwash): Trace {
  const z = new Float32Array(N);
  const bodyTop = new Float32Array(N);
  const wingTop = new Float32Array(N);
  const wingBottom = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = xAt(i);
    z[i] = lateral(spec.z, spec.y, x);
    bodyTop[i] = body.top(x, z[i], BAND);
    wingTop[i] = wings.top(x, z[i], BAND);
    wingBottom[i] = wings.bottom(x, z[i], BAND);
  }

  const lo = bodyTop.map((t) => t + CLEARANCE);
  const hi = new Float32Array(N).fill(Infinity);
  // A first pass over the body alone tells us at what height the line meets each wing.
  const pre = coneMax(lo).map((v) => Math.max(v, spec.y));
  const over = new Uint8Array(N);
  const wakes: Wake[] = [];

  for (const [a, b] of runs(wingTop)) {
    let meanPre = 0;
    let meanTop = 0;
    let meanBottom = 0;
    for (let i = a; i <= b; i++) {
      meanPre += pre[i];
      meanTop += wingTop[i];
      meanBottom += wingBottom[i];
    }
    const n = b - a + 1;
    meanPre /= n;
    meanTop /= n;
    meanBottom /= n;
    const under = meanPre < meanBottom;
    for (let i = a; i <= b; i++) {
      if (under) hi[i] = Math.min(hi[i], wingBottom[i] - CLEARANCE);
      else {
        lo[i] = Math.max(lo[i], wingTop[i] + CLEARANCE);
        over[i] = 1;
      }
    }
    // Upwash is strongest for the air that actually touched the wing.
    const dist = under ? Math.max(0, meanBottom - meanPre) : Math.max(0, meanPre - meanTop);
    wakes.push({ end: b, rear: xAt(b) < 0, strength: Math.exp(-dist / 0.3) });
  }

  const floorE = coneMax(lo);
  const ceilE = coneMin(hi);
  const y = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const want = Math.max(spec.y, floorE[i]);
    // The body always wins over a wing's ceiling (e.g. where a pylon joins them).
    y[i] = Math.max(Math.min(want, ceilE[i]), floorE[i] > ceilE[i] ? floorE[i] : -Infinity);
  }
  for (const wake of wakes) applyUpwash(y, wake, upwash);
  smooth(y, 2);
  for (let i = 0; i < N; i++) y[i] = Math.max(y[i], lo[i] - CLEARANCE * 0.4);
  smooth(y, 1);

  const speed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const surface = over[i] ? Math.max(bodyTop[i], wingTop[i]) : bodyTop[i];
    const near = Number.isFinite(surface) && surface < y[i] ? Math.exp(-(y[i] - surface) / 0.12) : 0;
    const climb = i + 1 < N ? Math.max(0, (y[i + 1] - y[i]) / DX) : 0;
    const suction =
      Number.isFinite(wingBottom[i]) && y[i] < wingBottom[i]
        ? 0.35 * Math.exp(-(wingBottom[i] - y[i]) / 0.12)
        : 0;
    speed[i] = clamp(1 + near * (0.14 - 0.75 * climb) + suction, 0.55, 1.5);
  }
  smooth(speed, 3);
  return { y, z, speed };
}

// ── helpers ──────────────────────────────────────────────────────────────────────

/**
 * Upper envelope of cones hung from each obstacle sample: the line rises RISE_AHEAD per metre
 * before an obstacle and falls SETTLE_BEHIND per metre after it. Index grows downstream.
 */
function coneMax(v: Float32Array): Float32Array {
  const out = new Float32Array(N).fill(-Infinity);
  for (let j = 0; j < N; j++) {
    if (!Number.isFinite(v[j])) continue;
    for (let i = 0; i < N; i++) {
      const d = (j - i) * DX; // > 0: obstacle is still ahead of sample i
      const h = v[j] - (d > 0 ? RISE_AHEAD * d : -SETTLE_BEHIND * d);
      if (h > out[i]) out[i] = h;
    }
  }
  return out;
}

/** Mirror of coneMax for ceilings: the line dips before passing under a wing. */
function coneMin(v: Float32Array): Float32Array {
  const out = new Float32Array(N).fill(Infinity);
  for (let j = 0; j < N; j++) {
    if (!Number.isFinite(v[j])) continue;
    for (let i = 0; i < N; i++) {
      const d = (j - i) * DX;
      const h = v[j] + (d > 0 ? RISE_AHEAD * d : -SETTLE_BEHIND * d);
      if (h < out[i]) out[i] = h;
    }
  }
  return out;
}

/** Contiguous index ranges where `v` is finite (one per wing crossed). */
function runs(v: Float32Array): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= N; i++) {
    const on = i < N && Number.isFinite(v[i]);
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  }
  return out;
}

/** In-place Gaussian blur with clamped ends; sigma in samples. */
function smooth(v: Float32Array, sigma: number): void {
  const r = Math.ceil(sigma * 2.5);
  const src = v.slice();
  for (let i = 0; i < N; i++) {
    let sum = 0;
    let wsum = 0;
    for (let k = -r; k <= r; k++) {
      const w = gauss(k, sigma);
      sum += src[clamp(i + k, 0, N - 1)] * w;
      wsum += w;
    }
    v[i] = sum / wsum;
  }
}

/** Fade in over the first metre, out over the last 1.5 m, scaled by the line's weight. */
function fades(weight: number): Float32Array {
  const a = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = xAt(i);
    a[i] = weight * smoothstep(X_IN - x, 0, 1) * smoothstep(x - X_OUT, 0, 1.5);
  }
  return a;
}
