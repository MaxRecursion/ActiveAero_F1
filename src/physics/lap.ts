/**
 * Station 3 physics: one lap of the fictional circuit, with the 2026 energy rules.
 *
 * A classic point-mass lap simulation, sampled every 2 m:
 *   1. Corner limit      m·v²/r = μ_lat·(m·g + ½ρ·ClA·v²)            (grip grows with downforce)
 *   2. Braking envelope  backward pass with a = (μ_long·(m·g + L) + D) / m
 *   3. Forward pass      full throttle: F = min(η·(P_ICE + P_K)/v, traction) − D − rolling
 * and an energy manager layered on the forward pass:
 *   · braking harvests up to 350 kW through the motor-generator (the rest is brake heat),
 *   · on full throttle the motor deploys up to its regulated limit P_K(v) while the battery has
 *     charge — but only where the engine alone can't already spin the tyres (deploying into
 *     wheelspin would waste it),
 *   · "super clipping": at the end of the longest straights the motor harvests at full throttle,
 *     topping the lap up to the 8.5 MJ recovery limit that braking alone doesn't reach,
 *   · the battery never swings more than 4 MJ, and Straight Mode opens on long straights.
 * Laps are repeated until the battery charge at the line settles, so the shown lap is periodic.
 *
 * It is an illustrative model: grip, power and aero numbers are estimates (see ESTIMATES).
 */
import { DEFAULT_AERO_INPUTS, modeCoefficients } from './aero';
import { ESTIMATES, PHYS, REGS } from './constants';
import { mguKLimitKw } from './powertrain';
import { buildTrack, type Track } from './track';

export type LapPhase = 'deploy' | 'engine' | 'clip' | 'lift' | 'brake';

export interface LapOptions {
  /** Harvest at full throttle at the end of long straights. Default true. */
  clipping?: boolean;
}

export interface LapSample {
  s: number;
  x: number;
  y: number;
  /** Time since the line, s. */
  t: number;
  kmh: number;
  phase: LapPhase;
  /** Motor-generator power: + deploying to the wheels, − harvesting into the battery (kW). */
  mguKKw: number;
  /** Engine power going to the wheels (kW, before driveline losses; less while clipping). */
  engineKw: number;
  /** Battery state of charge within its 4 MJ window, MJ. */
  socMJ: number;
  /** Cumulative this lap, MJ. */
  harvestedMJ: number;
  deployedMJ: number;
  /** Flap position used by the physics here: 0 Corner Mode, 1 Straight Mode. */
  straightT: number;
}

export interface LapResult {
  track: Track;
  samples: LapSample[];
  lapTimeS: number;
  topSpeedKmh: number;
  harvestedMJ: number;
  brakeHarvestMJ: number;
  clipHarvestMJ: number;
  deployedMJ: number;
  harvestCapMJ: number;
  options: Required<LapOptions>;
}

const DS = 2;
/** Straights at least this long get a Straight Mode activation zone. */
const ACTIVATION_MIN_M = 300;
/** Flaps open this far after a straight begins (corner exit). */
const ACTIVATION_DELAY_M = 60;
/** Only straights at least this long are used for super clipping. */
const CLIP_MIN_STRAIGHT_M = 600;
/** Teams aim for roughly 2–4 s of super clipping a lap (2026 reports); use the upper end. */
const CLIP_SECONDS_PER_LAP = 4;
/** Clipping stops with this much room left in the battery, so the next braking zone can still harvest. */
const BRAKE_RESERVE_J = 0.9e6;
const MIN_V = 5;
const LAPS = 4;

const kmh = (ms: number) => ms * 3.6;

export function simulateLap(opts: LapOptions = {}): LapResult {
  const options = { clipping: opts.clipping ?? true };
  const track = buildTrack(DS);
  const pts = track.points;
  const n = pts.length;
  const m = DEFAULT_AERO_INPUTS.massKg;
  const rho = DEFAULT_AERO_INPUTS.rho;
  const g = PHYS.g;
  const eta = ESTIMATES.drivelineEfficiency;
  const iceW = ESTIMATES.iceKw * 1000;
  const motorMaxW = REGS.mguKMaxKw.value * 1000;
  const windowJ = REGS.energyStoreWindowMJ.value * 1e6;
  const capJ = REGS.harvestPerLapMJ.value * 1e6;
  const corner = modeCoefficients(0);

  // ── Straight Mode zones (geometry only; flaps close when braking starts) ─────
  const onZoneStraight = new Uint8Array(n);
  for (const st of track.straights) {
    if (st.length < ACTIVATION_MIN_M) continue;
    for (let i = 0; i < n; i++) {
      const d = pts[i].s - st.start;
      if (d >= ACTIVATION_DELAY_M && d < st.length) onZoneStraight[i] = 1;
    }
  }

  // ── 1. corner limit ───────────────────────────────────────────────────────────
  const vLimit = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = pts[i].curvature;
    const denom = m * k - 0.5 * ESTIMATES.gripLateral * rho * corner.clA;
    vLimit[i] = k === 0 || denom <= 0 ? Infinity : Math.sqrt((ESTIMATES.gripLateral * m * g) / denom);
  }

  // ── 2. braking envelope (periodic: two passes backward round the loop) ─────
  const vBrake = Float64Array.from(vLimit, (v) => Math.min(v, 120));
  for (let pass = 0; pass < 2; pass++) {
    for (let j = n - 1; j >= 0; j--) {
      const next = vBrake[(j + 1) % n];
      const q = 0.5 * rho * next * next;
      const decel = (ESTIMATES.gripLongitudinal * (m * g + q * corner.clA) + q * corner.cdA) / m;
      vBrake[j] = Math.min(vLimit[j], Math.sqrt(next * next + 2 * decel * DS));
    }
  }

  // ── 3. forward pass with energy management ────────────────────────────────────
  let clipFrom = new Float64Array(0); // per straight: clip from this distance to its braking point

  function forward(soc0: number, record: boolean, allowClip: boolean) {
    let v = MIN_V * 4;
    let soc = soc0;
    let harvested = 0;
    let deployed = 0;
    let brakeHarvest = 0;
    let clipHarvest = 0;
    let t = 0;
    const samples: LapSample[] = record ? new Array(n) : [];
    const brakeStart = new Map<number, number>();
    // Run the lap twice: the first pass only settles the speed at the line.
    for (let lap = 0; lap < 2; lap++) {
      if (lap === 1) {
        harvested = deployed = brakeHarvest = clipHarvest = t = 0;
      }
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        const vNextCap = vBrake[(i + 1) % n];
        const straightIdx = track.straights.findIndex((st) => st.segment === p.segment);
        const clipping =
          allowClip &&
          straightIdx >= 0 &&
          p.s >= clipFrom[straightIdx] &&
          harvested < capJ &&
          soc < windowJ - BRAKE_RESERVE_J;
        const zone = onZoneStraight[i] === 1;

        // Candidate: full throttle.
        const flap = zone ? 1 : 0;
        const aero = modeCoefficients(flap);
        const q = 0.5 * rho * v * v;
        const drag = q * aero.cdA;
        const rolling = ESTIMATES.rollingResistance * (m * g + q * aero.clA);
        const traction = ESTIMATES.gripLongitudinal * ESTIMATES.rearAxleShare * (m * g + q * aero.clA);
        const vSafe = Math.max(v, MIN_V);
        let motorW = 0;
        if (clipping) {
          motorW = -Math.min(motorMaxW, capJ - harvested, windowJ - soc); // J capped per step below
        } else if (soc > 0 && (eta * iceW) / vSafe < traction) {
          motorW = mguKLimitKw(kmh(v)) * 1000;
        }
        const wheelW = eta * (iceW + motorW);
        const drive = Math.min(wheelW / vSafe, traction);
        const accel = (drive - drag - rolling) / m;
        const vFull = Math.sqrt(Math.max(MIN_V * MIN_V, v * v + 2 * accel * DS));

        let vNext: number;
        let phase: LapPhase;
        let harvestW = 0;
        let deployW = 0;
        let engineW = iceW;
        if (vFull <= vNextCap) {
          vNext = vFull;
          phase = clipping ? 'clip' : motorW > 0 ? 'deploy' : 'engine';
          if (motorW > 0) deployW = motorW;
          else if (motorW < 0) harvestW = -motorW;
        } else {
          vNext = vNextCap;
          if (vNext < v) {
            phase = 'brake';
            // Force the brakes must add beyond drag and rolling resistance.
            const brakeForce = (m * (v * v - vNext * vNext)) / (2 * DS) - drag - rolling;
            harvestW = Math.max(0, Math.min(motorMaxW, brakeForce * (v + vNext) * 0.5));
            engineW = 0;
            if (straightIdx >= 0 && !brakeStart.has(straightIdx)) brakeStart.set(straightIdx, p.s);
          } else {
            phase = 'lift';
            engineW = iceW * 0.4;
          }
        }

        const dt = DS / Math.max(MIN_V, (v + vNext) / 2);
        // Energy bookkeeping with the regulated caps.
        if (harvestW > 0) {
          const room = Math.min(capJ - harvested, windowJ - soc);
          const e = Math.max(0, Math.min(harvestW * dt, room));
          harvestW = e / dt;
          soc += e;
          harvested += e;
          if (phase === 'brake') brakeHarvest += e;
          else clipHarvest += e;
        }
        if (deployW > 0) {
          const e = Math.min(deployW * dt, soc);
          deployW = e / dt;
          soc -= e;
          deployed += e;
        }
        if (phase === 'clip') engineW = iceW - harvestW;

        if (record && lap === 1) {
          samples[i] = {
            s: p.s,
            x: p.x,
            y: p.y,
            t,
            kmh: kmh(v),
            phase,
            mguKKw: (deployW - harvestW) / 1000,
            engineKw: engineW / 1000,
            socMJ: soc / 1e6,
            harvestedMJ: harvested / 1e6,
            deployedMJ: deployed / 1e6,
            straightT: zone && phase !== 'brake' ? 1 : 0,
          };
        }
        t += dt;
        v = vNext;
      }
    }
    return { samples, soc, lapTimeS: t, harvested, deployed, brakeHarvest, clipHarvest, brakeStart };
  }

  // Settle a lap without clipping first: it tells us where each straight's braking starts and
  // how much braking alone recovers. Super clipping then tops up toward the lap cap, limited to a
  // few seconds at 350 kW, placed at the end of the long straights (shared out by length).
  clipFrom = Float64Array.from(track.straights, () => Infinity);
  let soc = ESTIMATES.startChargeMJ * 1e6;
  let run = forward(soc, false, false);
  for (let iter = 0; iter < LAPS; iter++) {
    soc = Math.min(windowJ, Math.max(0, run.soc));
    run = forward(soc, false, false);
  }
  if (options.clipping) {
    const budgetJ = Math.min(Math.max(0, capJ - run.brakeHarvest), motorMaxW * CLIP_SECONDS_PER_LAP);
    const longOnes = track.straights
      .map((st, idx) => ({ st, idx }))
      .filter(({ st, idx }) => st.length >= CLIP_MIN_STRAIGHT_M && run.brakeStart.has(idx));
    const total = longOnes.reduce((sum, { st }) => sum + st.length, 0);
    for (const { st, idx } of longOnes) {
      const seconds = (budgetJ * st.length) / total / motorMaxW;
      // Clipping happens near top speed; ~310 km/h converts seconds to metres.
      clipFrom[idx] = Math.max(st.start + ACTIVATION_DELAY_M, run.brakeStart.get(idx)! - seconds * (310 / 3.6));
    }
    for (let iter = 0; iter < LAPS; iter++) {
      soc = Math.min(windowJ, Math.max(0, run.soc));
      run = forward(soc, false, true);
    }
  }
  const final = forward(Math.min(windowJ, Math.max(0, run.soc)), true, options.clipping);
  const samples = final.samples;

  return {
    track,
    samples,
    lapTimeS: final.lapTimeS,
    topSpeedKmh: samples.reduce((max, x) => Math.max(max, x.kmh), 0),
    harvestedMJ: final.harvested / 1e6,
    brakeHarvestMJ: final.brakeHarvest / 1e6,
    clipHarvestMJ: final.clipHarvest / 1e6,
    deployedMJ: final.deployed / 1e6,
    harvestCapMJ: capJ / 1e6,
    options,
  };
}

/** Sample at a lap time (binary search + linear blend of the numbers). */
export function sampleAt(lap: LapResult, tS: number): LapSample {
  const s = lap.samples;
  const t = ((tS % lap.lapTimeS) + lap.lapTimeS) % lap.lapTimeS;
  let lo = 0;
  let hi = s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = s[lo];
  const b = s[hi];
  const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
  const mix = (x: number, y: number) => x + (y - x) * k;
  return {
    ...a,
    t,
    s: mix(a.s, b.s),
    x: mix(a.x, b.x),
    y: mix(a.y, b.y),
    kmh: mix(a.kmh, b.kmh),
    mguKKw: mix(a.mguKKw, b.mguKKw),
    engineKw: mix(a.engineKw, b.engineKw),
    socMJ: mix(a.socMJ, b.socMJ),
    harvestedMJ: mix(a.harvestedMJ, b.harvestedMJ),
    deployedMJ: mix(a.deployedMJ, b.deployedMJ),
  };
}
