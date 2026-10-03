/**
 * Station 4 data: one brake zone turned into what the UI draws (a thinned trace for the chart) and
 * what every frame shows (the numbers at the playhead). All physics comes from src/physics/braking.ts;
 * this file only picks, thins and renames.
 */
import { brakingState, sampleAt, simulateBrakeZone, type BrakeSample, type BrakeZone } from '../../physics/braking';
import { ESTIMATES } from '../../physics/constants';
import type { BrakePoint, BrakeTrace, Station4View } from '../../ui/types';

/** The physics steps every 5 ms; one chart point per 25 ms is plenty for a 3 s stop. */
const POINT_EVERY = 5;

export const DISC_WINDOW_C = ESTIMATES.brakes.workingWindowC;

const toPoint = (x: BrakeSample): BrakePoint => ({
  t: x.t,
  kmh: x.kmh,
  decelG: x.decelG,
  brakeKw: x.brakePowerW / 1000,
  harvestKw: x.harvestW / 1000,
  heatKw: x.heatW / 1000,
  frontDiscC: x.frontDiscC,
  rearDiscC: x.rearDiscC,
});

export function makeBrakeTrace(fromKmh: number, zone: BrakeZone = simulateBrakeZone(fromKmh)): BrakeTrace {
  const last = zone.samples.length - 1;
  return {
    fromKmh: zone.fromKmh,
    toKmh: zone.toKmh,
    timeS: zone.timeS,
    distanceM: zone.distanceM,
    points: zone.samples.filter((_, i) => i % POINT_EVERY === 0 || i === last).map(toPoint),
    peakDecelG: zone.peakDecelG,
    kineticMJ: zone.kineticMJ,
    dragMJ: zone.dragMJ,
    harvestMJ: zone.harvestMJ,
    heatMJ: zone.heatMJ,
    peakFrontDiscC: zone.peakFrontDiscC,
    peakRearDiscC: zone.peakRearDiscC,
    discWindowC: DISC_WINDOW_C,
  };
}

type MomentKey =
  | 'tS' | 'sM' | 'kmh' | 'decelG' | 'brakeKw' | 'harvestKw' | 'heatKw'
  | 'frontLoadN' | 'rearLoadN' | 'frontStaticN' | 'rearStaticN' | 'transferN' | 'frontBiasPct' | 'noseDropMm'
  | 'frontDiscC' | 'rearDiscC' | 'harvestedMJ' | 'heatMJ';

/** The live numbers of Station4View at one instant, plus what the caption and the 3D scene need beyond them. */
export interface BrakeMoment extends Pick<Station4View, MomentKey> {
  /** Downforce at this speed, N. */
  downforceN: number;
  /** Real body dip at the front axle and rise at the rear axle, m (the garage exaggerates them). */
  noseDropM: number;
  tailRiseM: number;
}

/** Loads, transfer and body pose at a speed. With the pedal up nothing is thrown forward. */
function poseAt(kmh: number, pedalDown: boolean) {
  const b = brakingState(kmh);
  const transferN = pedalDown ? b.transferN : 0;
  // The physics keeps the weight-only share as "static"; the UI's static load includes the downforce.
  const frontStaticN = b.frontLoadN - b.transferN;
  const rearStaticN = b.rearLoadN + b.transferN;
  const frontLoadN = frontStaticN + transferN;
  const rearLoadN = rearStaticN - transferN;
  return {
    downforceN: b.downforceN,
    transferN,
    frontStaticN,
    rearStaticN,
    frontLoadN,
    rearLoadN,
    frontBiasPct: (100 * frontLoadN) / (frontLoadN + rearLoadN),
    noseDropM: pedalDown ? b.noseDropM : 0,
    tailRiseM: pedalDown ? b.tailRiseM : 0,
  };
}

function moment(x: BrakeSample, pedalDown: boolean): BrakeMoment {
  const pose = poseAt(x.kmh, pedalDown);
  return {
    tS: x.t,
    sM: x.s,
    kmh: x.kmh,
    decelG: pedalDown ? x.decelG : 0,
    brakeKw: pedalDown ? x.brakePowerW / 1000 : 0,
    harvestKw: pedalDown ? x.harvestW / 1000 : 0,
    heatKw: pedalDown ? x.heatW / 1000 : 0,
    frontLoadN: pose.frontLoadN,
    rearLoadN: pose.rearLoadN,
    frontStaticN: pose.frontStaticN,
    rearStaticN: pose.rearStaticN,
    transferN: pose.transferN,
    frontBiasPct: pose.frontBiasPct,
    noseDropMm: pose.noseDropM * 1000,
    frontDiscC: x.frontDiscC,
    rearDiscC: x.rearDiscC,
    harvestedMJ: x.harvestMJ,
    heatMJ: x.heatMJ,
    downforceN: pose.downforceN,
    noseDropM: pose.noseDropM,
    tailRiseM: pose.tailRiseM,
  };
}

/** The numbers `tS` seconds after the pedal went down (clamped to the zone). */
export const viewAt = (zone: BrakeZone, tS: number): BrakeMoment => moment(sampleAt(zone, tS), true);

/** The car cruising at the entry speed, pedal up: no braking, no weight transfer, discs at their starting temperature. */
export const cruiseView = (zone: BrakeZone): BrakeMoment => moment(zone.samples[0], false);

/** One zone in the three forms the station needs. */
export interface BrakeRun {
  zone: BrakeZone;
  trace: BrakeTrace;
  /** The pedal-up moment at the entry speed. */
  cruise: BrakeMoment;
}

export function makeBrakeRun(fromKmh: number): BrakeRun {
  const zone = simulateBrakeZone(fromKmh);
  return { zone, trace: makeBrakeTrace(fromKmh, zone), cruise: cruiseView(zone) };
}
