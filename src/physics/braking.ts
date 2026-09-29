/**
 * Station 4 physics: what full braking does to the car.
 *
 * Tyres can push back on the road with μ · (weight + downforce), and the air adds drag:
 *
 *   F_tyre = μ_long · (m·g + L)          force the brakes let the tyres deliver
 *   a      = (F_tyre + D) / m            total deceleration (the same envelope Station 3's lap uses)
 *   P      = F_tyre · v                  power the brakes remove from the car (drag removes D · v more)
 *
 * Braking throws weight forward: the car's inertia acts at the centre of gravity, height h above the
 * road, so ΔN = m·a·h / wheelbase moves from the rear axle to the front one. The best brake balance is
 * the one that splits F_tyre in proportion to the axle loads. At the start of a zone the wings are still
 * at full downforce, so speed is the whole story: 4× the speed² → 4× the downforce → much harder braking.
 *
 * Where the energy goes: the rear axle's brake is blended with the electric motor-generator, which can
 * take at most 350 kW back into the battery; everything else is heat in the carbon discs.
 * Laid out as an illustration; grip, mass and disc numbers are estimates (see ESTIMATES).
 */
import { aeroFrontShare, aeroState, kmhToMs, msToKmh } from './aero';
import { CAR_FRAME, ESTIMATES, PHYS, REGS } from './constants';

const WHEELBASE_M = CAR_FRAME.frontAxleX - CAR_FRAME.rearAxleX;
const B = ESTIMATES.brakes;
const KELVIN = 273.15;

export interface BrakingState {
  speedKmh: number;
  /** Deceleration with the pedal fully down, in g and m/s². */
  decelG: number;
  decelMs2: number;
  /** Force at the tyre contact patches that the brakes produce, N. */
  tyreForceN: number;
  dragN: number;
  downforceN: number;
  /** Power the brakes remove from the car, W (tyre force × speed). */
  brakePowerW: number;
  /** Power the air removes on top, W. */
  dragPowerW: number;
  /** Power the motor-generator takes back into the battery, W (≤ 350 kW). */
  harvestW: number;
  /** Power that turns into heat in the discs, W. */
  heatW: number;
  /** Share of the brake power that is harvested (0–1). */
  harvestShare: number;
  /** Axle loads under braking, N (static + aero + transfer). */
  frontLoadN: number;
  rearLoadN: number;
  frontStaticN: number;
  rearStaticN: number;
  /** Load moved from the rear axle to the front by braking, N. */
  transferN: number;
  /** Front share of the total load = the ideal front brake bias (0–1). */
  frontShare: number;
  /** Suspension travel this transfer causes (nose down, tail up), m. Before any exaggeration for the picture. */
  noseDropM: number;
  tailRiseM: number;
  /** Nose-down pitch, rad. */
  pitchRad: number;
}

export function brakingState(speedKmh: number): BrakingState {
  const v = kmhToMs(Math.max(0, speedKmh));
  const m = REGS.minMassKg.value;
  // Wings closed for braking: Corner Mode, the flaps have shut before the driver reaches the pedal.
  const a0 = aeroState(speedKmh);
  const downforceN = a0.downforceN;
  const dragN = a0.dragN;
  const tyreForceN = ESTIMATES.gripLongitudinal * (a0.weightN + downforceN);
  const decelMs2 = (tyreForceN + dragN) / m;

  const brakePowerW = tyreForceN * v;
  const frontStaticN = a0.weightN * ESTIMATES.staticFrontShare;
  const rearStaticN = a0.weightN - frontStaticN;
  const aeroFront = downforceN * aeroFrontShare();
  const transferN = ((tyreForceN + dragN) * ESTIMATES.cgHeightM) / WHEELBASE_M;
  const frontLoadN = frontStaticN + aeroFront + transferN;
  const rearLoadN = rearStaticN + (downforceN - aeroFront) - transferN;
  const frontShare = frontLoadN / (frontLoadN + rearLoadN);

  // The motor takes over rear-axle braking up to its limit; the rest of the rear axle and the whole front axle are discs.
  const rearBrakeW = brakePowerW * (1 - frontShare);
  const harvestW = Math.min(REGS.mguKMaxKw.value * 1000, rearBrakeW);
  const heatW = brakePowerW - harvestW;

  const noseDropM = transferN / (B.frontAxleRateNPerMm * 1000);
  const tailRiseM = transferN / (B.rearAxleRateNPerMm * 1000);
  return {
    speedKmh,
    decelG: decelMs2 / PHYS.g,
    decelMs2,
    tyreForceN,
    dragN,
    downforceN,
    brakePowerW,
    dragPowerW: dragN * v,
    harvestW,
    heatW,
    harvestShare: brakePowerW > 0 ? harvestW / brakePowerW : 0,
    frontLoadN,
    rearLoadN,
    frontStaticN,
    rearStaticN,
    transferN,
    frontShare,
    noseDropM,
    tailRiseM,
    pitchRad: Math.atan2(noseDropM + tailRiseM, WHEELBASE_M),
  };
}

export interface BrakeSample {
  /** Time since the pedal went down, s. */
  t: number;
  /** Distance covered, m. */
  s: number;
  kmh: number;
  decelG: number;
  brakePowerW: number;
  harvestW: number;
  heatW: number;
  /** Disc temperatures, °C (front and rear axle; the two wheels of an axle share one). */
  frontDiscC: number;
  rearDiscC: number;
  /** Energy since the pedal went down, MJ. */
  heatMJ: number;
  harvestMJ: number;
}

export interface BrakeZone {
  fromKmh: number;
  toKmh: number;
  samples: BrakeSample[];
  timeS: number;
  distanceM: number;
  peakDecelG: number;
  /** Kinetic energy shed, MJ: ½·m·(v₀² − v₁²). Drag, the motor and the discs share it. */
  kineticMJ: number;
  dragMJ: number;
  harvestMJ: number;
  heatMJ: number;
  peakFrontDiscC: number;
  peakRearDiscC: number;
}

const DT = 0.005;

/** Brake flat out from `fromKmh` down to `toKmh` and follow the energy, the discs and the distance. */
export function simulateBrakeZone(fromKmh: number, toKmh: number = B.apexKmh): BrakeZone {
  const m = REGS.minMassKg.value;
  const v1 = kmhToMs(toKmh);
  let v = kmhToMs(Math.max(fromKmh, toKmh));
  let t = 0;
  let s = 0;
  let harvestJ = 0;
  let heatJ = 0;
  let dragJ = 0;
  let peakG = 0;
  const kelvin = (c: number) => c + KELVIN;
  let frontT: number = B.startDiscC;
  let rearT: number = B.startDiscC;
  let peakFront = frontT;
  let peakRear = rearT;
  const samples: BrakeSample[] = [];

  const push = (st: BrakingState) =>
    samples.push({
      t,
      s,
      kmh: msToKmh(v),
      decelG: st.decelG,
      brakePowerW: st.brakePowerW,
      harvestW: st.harvestW,
      heatW: st.heatW,
      frontDiscC: frontT,
      rearDiscC: rearT,
      heatMJ: heatJ / 1e6,
      harvestMJ: harvestJ / 1e6,
    });

  let st = brakingState(msToKmh(v));
  push(st);
  while (v > v1 && t < 60) {
    st = brakingState(msToKmh(v));
    peakG = Math.max(peakG, st.decelG);
    const step = Math.min(DT, (v - v1) / st.decelMs2);
    // Heat is made where the brake is: the front axle's share of the tyre force, and the rear axle's minus what the motor takes.
    const frontHeatW = st.brakePowerW * st.frontShare;
    const rearHeatW = st.heatW - frontHeatW;
    const cool = (tempC: number) => B.discCoolingWPerK * (kelvin(tempC) - kelvin(B.ambientC));
    // Each axle's heat is shared by two wheels; each wheel's disc keeps `discHeatShare` of it.
    frontT += ((((frontHeatW / 2) * B.discHeatShare - cool(frontT)) / (B.frontDiscKg * B.discSpecificHeat)) * step);
    rearT += ((((Math.max(0, rearHeatW) / 2) * B.discHeatShare - cool(rearT)) / (B.rearDiscKg * B.discSpecificHeat)) * step);
    peakFront = Math.max(peakFront, frontT);
    peakRear = Math.max(peakRear, rearT);
    harvestJ += st.harvestW * step;
    heatJ += st.heatW * step;
    dragJ += st.dragPowerW * step;
    s += v * step - 0.5 * st.decelMs2 * step * step;
    v -= st.decelMs2 * step;
    t += step;
    push(brakingState(msToKmh(v)));
  }
  const kineticJ = 0.5 * m * (kmhToMs(Math.max(fromKmh, toKmh)) ** 2 - v1 * v1);
  return {
    fromKmh,
    toKmh,
    samples,
    timeS: t,
    distanceM: s,
    peakDecelG: peakG,
    kineticMJ: kineticJ / 1e6,
    dragMJ: dragJ / 1e6,
    harvestMJ: harvestJ / 1e6,
    heatMJ: heatJ / 1e6,
    peakFrontDiscC: peakFront,
    peakRearDiscC: peakRear,
  };
}

/** The sample at time `t` seconds into the zone (linear between samples; clamped to the ends). */
export function sampleAt(zone: BrakeZone, t: number): BrakeSample {
  const a = zone.samples;
  if (t <= 0) return a[0];
  if (t >= zone.timeS) return a[a.length - 1];
  const i = Math.min(a.length - 2, Math.floor(t / DT));
  const p = a[i];
  const q = a[i + 1];
  const k = q.t === p.t ? 0 : (t - p.t) / (q.t - p.t);
  const lerp = (x: number, y: number) => x + (y - x) * k;
  return {
    t,
    s: lerp(p.s, q.s),
    kmh: lerp(p.kmh, q.kmh),
    decelG: lerp(p.decelG, q.decelG),
    brakePowerW: lerp(p.brakePowerW, q.brakePowerW),
    harvestW: lerp(p.harvestW, q.harvestW),
    heatW: lerp(p.heatW, q.heatW),
    frontDiscC: lerp(p.frontDiscC, q.frontDiscC),
    rearDiscC: lerp(p.rearDiscC, q.rearDiscC),
    heatMJ: lerp(p.heatMJ, q.heatMJ),
    harvestMJ: lerp(p.harvestMJ, q.harvestMJ),
  };
}
