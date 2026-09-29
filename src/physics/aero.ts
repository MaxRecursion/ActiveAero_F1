/**
 * Station 1 physics: aerodynamic force from speed.
 *
 *   q = ½ ρ v²               dynamic pressure (Pa)
 *   L = q · ClA              downforce (N)
 *   D = q · CdA              drag (N)
 *   P = D · v                power needed just to push through the air (W)
 *
 * Double the speed → four times the force → eight times the drag power.
 */
import { CAR_FRAME, ESTIMATES, PHYS, REGS, type AeroSurfaceId } from './constants';

export const kmhToMs = (kmh: number): number => kmh / 3.6;
export const msToKmh = (ms: number): number => ms * 3.6;

export function dynamicPressure(speedMs: number, rho: number = PHYS.rho): number {
  return 0.5 * rho * speedMs * speedMs;
}

export interface AeroInputs {
  massKg: number;
  clA: number;
  cdA: number;
  rho: number;
}

export const DEFAULT_AERO_INPUTS: AeroInputs = {
  massKg: REGS.minMassKg.value,
  clA: ESTIMATES.clA,
  cdA: ESTIMATES.cdA,
  rho: PHYS.rho,
};

export interface SurfaceLoad {
  id: AeroSurfaceId;
  label: string;
  downforceN: number;
}

export interface AeroState {
  speedKmh: number;
  speedMs: number;
  /** Dynamic pressure, Pa. */
  q: number;
  downforceN: number;
  dragN: number;
  /** Power absorbed by drag, W. */
  dragPowerW: number;
  weightN: number;
  /** Downforce as a multiple of the car's weight. */
  downforceToWeight: number;
  /** Mass that would press down as hard as the downforce, kg. */
  downforceEquivalentKg: number;
  /** Share of downforce acting on the front axle (0–1). */
  aeroFrontShare: number;
  /** Speed above which downforce exceeds weight — the "drive on the ceiling" speed. */
  ceilingSpeedKmh: number;
  surfaces: SurfaceLoad[];
}

/** Speed at which downforce equals weight: m·g = ½ρv²·ClA → v = √(2mg / (ρ·ClA)). */
export function ceilingSpeedKmh(inputs: AeroInputs = DEFAULT_AERO_INPUTS): number {
  const v = Math.sqrt((2 * inputs.massKg * PHYS.g) / (inputs.rho * inputs.clA));
  return msToKmh(v);
}

/** Fraction of downforce carried by the front axle, from each surface's centre of pressure. */
export function aeroFrontShare(): number {
  const wheelbase = CAR_FRAME.frontAxleX - CAR_FRAME.rearAxleX;
  return ESTIMATES.surfaces.reduce(
    (sum, s) => sum + s.share * ((s.cpX - CAR_FRAME.rearAxleX) / wheelbase),
    0,
  );
}

/**
 * Active aero (2026). `straightT` blends Corner Mode (0) into Straight Mode (1) so numbers move
 * in step with the flaps. Only the wings open: the floor keeps its downforce, so the wings
 * absorb the whole downforce reduction.
 */
export function modeCoefficients(straightT: number, inputs: AeroInputs = DEFAULT_AERO_INPUTS) {
  const t = Math.min(1, Math.max(0, straightT));
  const { clAFactor, cdAFactor } = ESTIMATES.straightMode;
  const floorShare = ESTIMATES.surfaces.find((s) => s.id === 'floor')!.share;
  const wingFactorStraight = (clAFactor - floorShare) / (1 - floorShare);
  return {
    clA: inputs.clA * (1 + (clAFactor - 1) * t),
    cdA: inputs.cdA * (1 + (cdAFactor - 1) * t),
    /** Multiplier on each wing's Corner Mode downforce. */
    wingFactor: 1 + (wingFactorStraight - 1) * t,
  };
}

export function aeroState(
  speedKmh: number,
  inputs: AeroInputs = DEFAULT_AERO_INPUTS,
  straightT = 0,
): AeroState {
  const speedMs = kmhToMs(Math.max(0, speedKmh));
  const q = dynamicPressure(speedMs, inputs.rho);
  const mode = modeCoefficients(straightT, inputs);
  const downforceN = q * mode.clA;
  const dragN = q * mode.cdA;
  const weightN = inputs.massKg * PHYS.g;
  const cornerDownforceN = q * inputs.clA;
  return {
    speedKmh,
    speedMs,
    q,
    downforceN,
    dragN,
    dragPowerW: dragN * speedMs,
    weightN,
    downforceToWeight: downforceN / weightN,
    downforceEquivalentKg: downforceN / PHYS.g,
    aeroFrontShare: aeroFrontShare(),
    ceilingSpeedKmh: ceilingSpeedKmh(inputs),
    surfaces: ESTIMATES.surfaces.map((s) => ({
      id: s.id,
      label: s.label,
      downforceN: cornerDownforceN * s.share * (s.id === 'floor' ? 1 : mode.wingFactor),
    })),
  };
}
