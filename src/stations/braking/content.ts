/**
 * Station 4 words: the presets, and the one-line "why" for each part of a stop.
 *
 * A caption follows the phase of the stop (ready, early, mid, late, done) and whether the playhead is
 * parked, so it changes a handful of times per stop and never while a slider or the playhead moves.
 * That keeps the polite live region calm. Every number in a caption belongs to the whole zone (its peak,
 * its end, its energy totals), never to the moment, so a phase's text is the same all the way through it.
 * Grip, mass, disc and suspension figures are guesses, so every model number is worded as an estimate.
 */
import { REGS } from '../../physics/constants';
import { fmtKN, fmtMJ, fmtRatio, fmtS } from '../../ui/format';
import type { BrakeState, BrakeTrace, CaptionRun, SpeedPreset } from '../../ui/types';

/** Brake-from speeds, each named for where a driver would brake from it. */
export const PRESETS: SpeedPreset[] = [
  { kmh: 150, label: 'Chicane' },
  { kmh: 200, label: 'Slow corner' },
  { kmh: 250, label: 'Hairpin' },
  { kmh: 300, label: 'End of straight' },
  { kmh: 330, label: 'Flat out' },
];

/** ready: pedal up. early / mid / late: thirds of the speed the stop sheds. done: reached the corner speed. */
export type BrakePhase = 'ready' | 'early' | 'mid' | 'late' | 'done';

/** Share of the speed shed (0 = pedal down, 1 = corner speed) at which the story moves on. */
const EARLY_UNTIL = 0.35;
const MID_UNTIL = 0.75;

export function phaseOf(state: BrakeState, zone: BrakeTrace, kmh: number): BrakePhase {
  if (state === 'ready') return 'ready';
  if (state === 'done') return 'done';
  const shed = (zone.fromKmh - kmh) / Math.max(1e-9, zone.fromKmh - zone.toKmh);
  if (shed < EARLY_UNTIL) return 'early';
  return shed < MID_UNTIL ? 'mid' : 'late';
}

export interface CaptionContext {
  phase: BrakePhase;
  /** The playhead is parked part-way (paused, or dropped there by a scrub). Ignored for ready and done. */
  paused: boolean;
  zone: BrakeTrace;
  /** Load moved from the rear axle to the front at the moment the pedal goes down, N. */
  transferN: number;
  /** How many times bigger than real the 3D view draws the dive. */
  diveExaggeration: number;
}

const MOTOR_KW = REGS.mguKMaxKw.value;
/** Keep a number with its unit on one line. */
const nb = (n: string | number, unit: string) => `${n} ${unit}`;
/** Disc temperatures are guesses: round them so they do not look measured. */
const tens = (c: number) => String(Math.round(c / 10) * 10);
const last = <T>(a: ReadonlyArray<T>): T => a[a.length - 1];

function body({ phase, zone, transferN, diveExaggeration }: CaptionContext): CaptionRun[] {
  switch (phase) {
    case 'ready':
      return [
        { text: 'Pick a speed, then press ' },
        { text: 'Brake', tone: 'strong' },
        { text: `. The car brakes flat out down to ${nb(zone.toKmh, 'km/h')}. The faster it starts, the harder it stops: ` },
        { text: 'downforce', tone: 'down' },
        { text: ' presses it onto the road.' },
      ];
    case 'early':
      return [
        { text: `Pedal down: about ${nb(fmtRatio(zone.peakDecelG), 'g')} at first (an estimate). Braking moves about ` },
        { text: nb(fmtKN(transferN), 'kN') + ' of load', tone: 'weight' },
        { text: ` from the rear tyres to the front, so the nose dips. The dip is drawn ${diveExaggeration} times bigger.` },
      ];
    case 'mid':
      return [
        { text: `The carbon discs heat up: about ${nb(tens(zone.peakFrontDiscC), '°C')} at the front by the end (an estimate). The motor takes back at most ` },
        { text: nb(MOTOR_KW, 'kW'), tone: 'energy' },
        { text: ' as charge. The rest of the braking power becomes ' },
        { text: 'heat', tone: 'heat' },
        { text: '.' },
      ];
    case 'late':
      return [
        { text: 'Braking eases: less speed means less ' },
        { text: 'downforce', tone: 'down' },
        { text: `, so the tyres get less grip. It ends near ${nb(fmtRatio(last(zone.points).decelG), 'g')} (an estimate).` },
      ];
    case 'done':
    default:
      return [
        { text: `Done: ${nb(zone.fromKmh, 'km/h')} to ${nb(zone.toKmh, 'km/h')} in about ${nb(fmtS(zone.timeS), 's')} and ${nb(Math.round(zone.distanceM), 'm')}. Of ${nb(fmtMJ(zone.kineticMJ), 'MJ')} of motion energy, about ` },
        { text: nb(fmtMJ(zone.harvestMJ), 'MJ') + ' went into the battery', tone: 'energy' },
        { text: ' and ' },
        { text: nb(fmtMJ(zone.heatMJ), 'MJ') + ' became heat', tone: 'heat' },
        { text: '. The air took the rest. All estimates.' },
      ];
  }
}

export function captionFor(ctx: CaptionContext): CaptionRun[] {
  const runs = body(ctx);
  if (!ctx.paused || ctx.phase === 'ready' || ctx.phase === 'done') return runs;
  return [{ text: 'Paused. ', tone: 'muted' }, ...runs];
}
