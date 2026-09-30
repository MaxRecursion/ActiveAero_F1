/**
 * Station 4 helpers shared by the controls, the readouts and the chart: display ranges, shares of
 * a range, what the stop is called at each state, and tidy axes. Pure functions over what the
 * station sends; nothing here knows any physics.
 */
import type { BrakeState, BrakeTrace } from './types';
import type { IconName } from './icons';

/** Axle bars run 0 to here: the front axle at the fastest zone carries about 15 kN. Fixed, so zones compare. */
export const AXLE_MAX_N = 16_000;
/** Disc thermometers run 0 to here; the hottest disc of any zone peaks near 820 °C. */
export const DISC_MAX_C = 900;
/** Playback rates the station accepts, slowest first. */
export const BRAKE_RATES = [0.25, 0.5, 1] as const;

export const share = (value: number, max: number): number => (max > 0 ? Math.min(1, Math.max(0, value / max)) : 0);

/** A share as the string a CSS custom property takes. */
export const cssShare = (value: number, max: number): string => share(value, max).toFixed(4);

/** One word for what the stop is doing. */
export function stateWord(state: BrakeState, playing: boolean): string {
  if (state === 'ready') return 'Ready';
  if (state === 'done') return 'Stopped';
  return playing ? 'Braking' : 'Paused';
}

/** What the play button will do when pressed. */
export interface BrakeAction {
  label: string;
  icon: IconName;
}

const ACTIONS = {
  ready: { label: 'Brake', icon: 'play' },
  pause: { label: 'Pause', icon: 'pause' },
  resume: { label: 'Resume', icon: 'play' },
  done: { label: 'Brake again', icon: 'replay' },
} as const satisfies Record<string, BrakeAction>;

export function brakeAction(state: BrakeState, playing: boolean): BrakeAction {
  if (state === 'ready') return ACTIONS.ready;
  if (state === 'done') return ACTIONS.done;
  return playing ? ACTIONS.pause : ACTIONS.resume;
}

/** The speed axis tops out at the entry speed rounded up to a tidy step. */
export function speedAxis(fromKmh: number): { max: number; step: number } {
  const max = Math.max(50, Math.ceil(fromKmh / 50) * 50);
  return { max, step: max <= 200 ? 50 : 100 };
}

/** The braking axis (g): whole g up to the peak, labelled every other one when it is tall. */
export function gAxis(peakG: number): { max: number; step: number } {
  const max = Math.max(1, Math.ceil(peakG));
  return { max, step: max > 4 ? 2 : 1 };
}

const TIME_STEPS = [0.1, 0.25, 0.5, 1, 2];

/** Time ticks for a zone of `timeS` seconds in a plot `plotW` px wide: as fine as fits, about 46 px apart. */
export function timeTicks(timeS: number, plotW: number): number[] {
  const room = Math.max(2, Math.floor(plotW / 46));
  const step = TIME_STEPS.find((st) => timeS / st <= room) ?? TIME_STEPS[TIME_STEPS.length - 1];
  const ticks: number[] = [];
  for (let i = 0; i * step <= timeS + 1e-9; i++) ticks.push(Number((i * step).toFixed(2)));
  return ticks;
}

/** Shares of the zone's kinetic energy, for the ledger bar. */
export function ledgerShares(zone: BrakeTrace): { drag: number; harvest: number; heat: number } {
  const total = zone.dragMJ + zone.harvestMJ + zone.heatMJ;
  return total > 0
    ? { drag: zone.dragMJ / total, harvest: zone.harvestMJ / total, heat: zone.heatMJ / total }
    : { drag: 0, harvest: 0, heat: 0 };
}
