/**
 * Drives for the engine sound, as the app would feed them: the same cues the stations send
 * (speed, flap position, load, brake, motor power), sampled at 60 Hz. Used by the offline render
 * rig (dev/sound.html) and by tests; not part of the shipped app.
 */
import { ESTIMATES, REGS } from '../src/physics/constants';
import { sampleAt as lapAt, simulateLap } from '../src/physics/lap';
import { simulateBrakeZone, sampleAt as zoneAt } from '../src/physics/braking';
import type { SoundInput } from '../src/app/engineSound';

export interface Frame {
  /** Seconds from the start of the scenario. */
  t: number;
  input: SoundInput;
}

export const FRAME_RATE = 60;
const clamp01 = (n: number) => (n <= 0 ? 0 : n >= 1 ? 1 : n);
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const FLAP_S = REGS.activeAeroSwitchMs.value / 1000;

function frames(seconds: number, at: (t: number) => SoundInput): Frame[] {
  const out: Frame[] = [];
  for (let i = 0; i * (1 / FRAME_RATE) <= seconds; i++) {
    const t = i / FRAME_RATE;
    out.push({ t, input: at(t) });
  }
  return out;
}

/** Parked: the engine ticks over. */
export const idle = (seconds = 6): Frame[] => frames(seconds, () => ({ kmh: 0, straightT: 0 }));

/** The Play sweep of the first two stations: eased up to 330 km/h and back, with no station cue. */
export const sweep = (): Frame[] =>
  frames(4.5 + 1.5 + 4.5, (t) => {
    const k = t < 4.5 ? ease(t / 4.5) : t < 6 ? 1 : 1 - ease((t - 6) / 4.5);
    return { kmh: 330 * k, straightT: 0 };
  });

/** A pull through the gears at full power from rest to 300 km/h in about 14 s, load given. */
export const pull = (): Frame[] =>
  frames(16, (t) => {
    const k = Math.min(1, t / 14);
    return { kmh: 300 * (1 - (1 - k) ** 1.8), straightT: 0, load: 1, brake: 0, mguKKw: 250 };
  });

/** Flat out at 250 km/h, then the driver lifts and the car coasts down: the same speed range, the engine working differently. */
export const lift = (): Frame[] =>
  frames(10, (t) => {
    if (t < 3) return { kmh: 250, straightT: 0, load: 1, brake: 0, mguKKw: 200 };
    const k = Math.min(1, (t - 3) / 7);
    return { kmh: 250 - 90 * k, straightT: 0, load: 0, brake: 0, mguKKw: -60 };
  });

/** Station 04: a flat-out stop from `fromKmh` with the cues the braking station sends. */
export function brakeStop(fromKmh = 300): Frame[] {
  const zone = simulateBrakeZone(fromKmh);
  const lead = 1.5;
  return frames(lead + zone.timeS + 1.5, (t) => {
    if (t < lead) return { kmh: fromKmh, straightT: 0, load: 1, brake: 0, mguKKw: 100 };
    const s = zoneAt(zone, t - lead);
    return { kmh: s.kmh, straightT: 0, load: 0.04, brake: clamp01(s.brakePowerW / 1000 / 3200), mguKKw: -s.harvestW / 1000 };
  });
}

/** Cruising at 280 km/h while the wings open to Straight Mode and close again (steady speed, so the engine barely changes). */
export const straightMode = (): Frame[] =>
  frames(10, (t) => {
    const open = t > 2 && t < 6;
    const k = open ? clamp01((t - 2) / FLAP_S) : t >= 6 ? 1 - clamp01((t - 6) / FLAP_S) : 0;
    return { kmh: 280, straightT: k };
  });

/** The whole energy lap as station 03 plays it. */
export function energyLap(): Frame[] {
  const lap = simulateLap({ clipping: true });
  return frames(lap.lapTimeS, (t) => {
    const x = lapAt(lap, t);
    return {
      kmh: x.kmh,
      straightT: x.straightT,
      load: clamp01(x.engineKw / ESTIMATES.iceKw),
      brake: x.phase === 'brake' ? 1 : 0,
      mguKKw: x.mguKKw,
    };
  });
}

export const SCENARIOS: Record<string, () => Frame[]> = { idle, sweep, pull, lift, brakeStop, straightMode, energyLap };
