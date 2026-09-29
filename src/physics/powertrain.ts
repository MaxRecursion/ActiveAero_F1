/**
 * Station 2 physics: how fast can the car go, and why opening the wings helps.
 *
 * Top speed is where the power reaching the tyres equals the power the car spends against
 * the air and the road:
 *
 *   available(v) = η · (P_ICE + P_K(v))
 *   required(v)  = (½ρ·CdA·v² + C_rr·(m·g + ½ρ·ClA·v²)) · v
 *
 * P_K(v) is the regulated electric motor limit (FIA C5.2.8), which fades to zero between
 * 290 and 345 km/h, so drag saved by Straight Mode is worth more the faster the car goes.
 */
import { DEFAULT_AERO_INPUTS, kmhToMs, modeCoefficients, type AeroInputs } from './aero';
import { ESTIMATES, PHYS, REGS } from './constants';

/** Maximum ERS-K (electric motor) power allowed at a given speed, kW. FIA C5.2.8 (i) and (ii). */
export function mguKLimitKw(speedKmh: number, overtake = false): number {
  const v = speedKmh;
  const max = REGS.mguKMaxKw.value;
  if (overtake) return clamp(7100 - 20 * v, 0, max);
  if (v < 340) return clamp(1800 - 5 * v, 0, max);
  if (v < 345) return clamp(6900 - 20 * v, 0, max);
  return 0;
}

export interface PowerOptions {
  /** Electric motor deploying at its regulated limit (battery has charge). Default true. */
  deploy?: boolean;
}

/** Power reaching the tyres, W. */
export function availablePowerW(speedKmh: number, { deploy = true }: PowerOptions = {}): number {
  const kw = ESTIMATES.iceKw + (deploy ? mguKLimitKw(speedKmh) : 0);
  return ESTIMATES.drivelineEfficiency * kw * 1000;
}

export interface PowerNeed {
  dragW: number;
  rollingW: number;
  totalW: number;
}

/** Power spent against drag and rolling resistance at a steady speed, W. */
export function requiredPowerW(
  speedKmh: number,
  straightT = 0,
  inputs: AeroInputs = DEFAULT_AERO_INPUTS,
): PowerNeed {
  const v = kmhToMs(Math.max(0, speedKmh));
  const q = 0.5 * inputs.rho * v * v;
  const { clA, cdA } = modeCoefficients(straightT, inputs);
  const dragW = q * cdA * v;
  const rollingW = ESTIMATES.rollingResistance * (inputs.massKg * PHYS.g + q * clA) * v;
  return { dragW, rollingW, totalW: dragW + rollingW };
}

/** Highest steady speed the power allows, km/h (bisection; available − required falls with speed). */
export function topSpeedKmh(straightT = 0, opts: PowerOptions = {}, inputs: AeroInputs = DEFAULT_AERO_INPUTS): number {
  let lo = 50;
  let hi = 420;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (availablePowerW(mid, opts) >= requiredPowerW(mid, straightT, inputs).totalW) lo = mid;
    else hi = mid;
  }
  return lo;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
