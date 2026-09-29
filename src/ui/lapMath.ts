/**
 * Station 3 helpers shared by the lap timeline, the track map and the readouts: phase names,
 * distance ↔ time lookups on a LapTrace, and the cumulative harvest split at the playhead.
 * Pure functions over the trace the station sends; nothing here runs the simulation.
 */
import type { LapPhase } from '../physics/lap';
import type { LapTrace } from './types';

/** What each phase is called on screen. One meaning per colour: see energy.css. */
export const PHASES: Record<LapPhase, { label: string; spoken: string }> = {
  deploy: { label: 'Deploying', spoken: 'deploying: the motor adds power' },
  brake: { label: 'Harvesting — brakes', spoken: 'braking: the motor harvests' },
  clip: { label: 'Super clipping', spoken: 'super clipping: harvesting at full throttle' },
  engine: { label: 'Engine only', spoken: 'engine only' },
  lift: { label: 'Mid-corner', spoken: 'mid-corner' },
};

/** Draw order and legend order. */
export const PHASE_ORDER: readonly LapPhase[] = ['deploy', 'clip', 'brake', 'engine', 'lift'];

type Trace = LapTrace['trace'];

/** Index of the last trace point at or before distance s (0 before the first). */
export function indexAtDistance(trace: Trace, s: number): number {
  let lo = 0;
  let hi = trace.length - 1;
  if (hi < 0 || s <= trace[0].s) return 0;
  if (s >= trace[hi].s) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (trace[mid].s <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Lap time at a distance: linear between trace points; the last point blends to the line. */
export function timeAtDistance(lap: LapTrace, s: number): number {
  const tr = lap.trace;
  if (!tr.length) return 0;
  const d = Math.min(lap.lengthM, Math.max(0, s));
  const i = indexAtDistance(tr, d);
  const a = tr[i];
  const b = i + 1 < tr.length ? tr[i + 1] : { s: lap.lengthM, t: lap.lapTimeS };
  const k = b.s > a.s ? Math.min(1, Math.max(0, (d - a.s) / (b.s - a.s))) : 0;
  return Math.min(lap.lapTimeS, a.t + (b.t - a.t) * k);
}

/** Distance at a lap time (inverse of timeAtDistance). */
export function distanceAtTime(lap: LapTrace, t: number): number {
  const tr = lap.trace;
  if (!tr.length) return 0;
  let lo = 0;
  let hi = tr.length - 1;
  if (t >= tr[hi].t) {
    const a = tr[hi];
    const k = lap.lapTimeS > a.t ? Math.min(1, (t - a.t) / (lap.lapTimeS - a.t)) : 0;
    return a.s + (lap.lengthM - a.s) * k;
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tr[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = tr[lo];
  const b = tr[hi];
  const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
  return a.s + (b.s - a.s) * k;
}

/** Name of the last corner passed at distance s: "after T3", or "before T1" on the opening straight. */
export function whereOnLap(lap: LapTrace, s: number): string {
  let last: string | null = null;
  for (const c of lap.corners) if (c.s <= s) last = c.label;
  if (last) return `after ${last}`;
  return lap.corners.length ? `before ${lap.corners[0].label}` : 'on the lap';
}

/** Contiguous runs of one phase, as [from, to] trace indices (inclusive). */
export function phaseRuns(trace: Trace): { phase: LapPhase; from: number; to: number }[] {
  const runs: { phase: LapPhase; from: number; to: number }[] = [];
  for (let i = 0; i < trace.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.phase === trace[i].phase) last.to = i;
    else runs.push({ phase: trace[i].phase, from: i, to: i });
  }
  return runs;
}

/**
 * How the energy recovered so far splits between braking and super clipping. The trace only
 * carries power, so energy is integrated along it and scaled so the full lap matches the
 * simulation's own totals exactly.
 */
export interface HarvestSplit {
  /** Fraction of the harvest so far that came from super clipping, at a lap time. */
  clipShareAt(t: number): number;
}

export function harvestSplit(lap: LapTrace): HarvestSplit {
  const tr = lap.trace;
  const n = tr.length;
  const brake = new Float64Array(n + 1);
  const clip = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const t1 = i + 1 < n ? tr[i + 1].t : lap.lapTimeS;
    const e = Math.max(0, -tr[i].mguKKw) * Math.max(0, t1 - tr[i].t); // kJ
    brake[i + 1] = brake[i] + (tr[i].phase === 'brake' ? e : 0);
    clip[i + 1] = clip[i] + (tr[i].phase === 'clip' ? e : 0);
  }
  const kb = brake[n] > 0 ? lap.brakeHarvestMJ / brake[n] : 0;
  const kc = clip[n] > 0 ? lap.clipHarvestMJ / clip[n] : 0;
  return {
    clipShareAt(t) {
      if (!n) return 0;
      // Energy up to trace point i, plus the part of point i's step already run.
      let lo = 0;
      let hi = n - 1;
      if (t >= tr[hi].t) lo = hi;
      else {
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (tr[mid].t <= t) lo = mid;
          else hi = mid;
        }
      }
      const t1 = lo + 1 < n ? tr[lo + 1].t : lap.lapTimeS;
      const k = t1 > tr[lo].t ? Math.min(1, Math.max(0, (t - tr[lo].t) / (t1 - tr[lo].t))) : 0;
      const b = kb * (brake[lo] + (brake[lo + 1] - brake[lo]) * k);
      const c = kc * (clip[lo] + (clip[lo + 1] - clip[lo]) * k);
      return b + c > 0 ? c / (b + c) : 0;
    },
  };
}
