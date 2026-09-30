/** Station 05: an illustrative straight-line wake model, not CFD. */
import { aeroState } from './aero';

export const TOW_MODEL = {
  wakeDecayM: 14,
  maxDragReduction: 0.3,
  maxDownforceLoss: 0.25,
} as const;

export interface TowState {
  speedKmh: number;
  gapM: number;
  /** Remaining wake strength at the following car (0–1). */
  wakeStrength: number;
  dragReduction: number;
  downforceLoss: number;
  leadingDragN: number;
  followingDragN: number;
  leadingDownforceN: number;
  followingDownforceN: number;
  /** Drag power saved by the following car, W. */
  powerSavedW: number;
}

export function towState(speedKmh: number, gapM: number): TowState {
  const speed = aeroState(Math.max(0, speedKmh));
  const gap = Math.max(0, gapM);
  const wakeStrength = Math.exp(-gap / TOW_MODEL.wakeDecayM);
  const dragReduction = TOW_MODEL.maxDragReduction * wakeStrength;
  const downforceLoss = TOW_MODEL.maxDownforceLoss * wakeStrength;
  const followingDragN = speed.dragN * (1 - dragReduction);
  const followingDownforceN = speed.downforceN * (1 - downforceLoss);

  return {
    speedKmh: speed.speedKmh,
    gapM: gap,
    wakeStrength,
    dragReduction,
    downforceLoss,
    leadingDragN: speed.dragN,
    followingDragN,
    leadingDownforceN: speed.downforceN,
    followingDownforceN,
    powerSavedW: (speed.dragN - followingDragN) * speed.speedMs,
  };
}