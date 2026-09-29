/**
 * Station 3 words: the one-line "why" for each moment of the lap.
 *
 * Captions follow the lap phase (with a couple of refinements: an empty battery, a slow corner
 * exit), so they change a few times per lap, never every frame.
 */
import { ESTIMATES, REGS } from '../../physics/constants';
import type { LapPhase } from '../../physics/lap';
import type { CaptionRun } from '../../ui/types';

export interface CaptionContext {
  phase: LapPhase;
  kmh: number;
  socMJ: number;
  clipping: boolean;
  /** Combustion engine output at this moment, kW (tells a flat-out fast corner from a lift). */
  engineKw?: number;
}

/** Below this charge the motor is about to stop helping. */
const EMPTY_MJ = 0.05;

const MOTOR_KW = `${REGS.mguKMaxKw.value} kW`;
/** The regulated motor limit starts to fall here (FIA C5.2.8). */
const MOTOR_FADE_KMH = 290;
/** At or above this share of the engine's output the driver is effectively flat out. */
const FLAT_OUT_SHARE = 0.95;

export function captionFor({ phase, kmh, socMJ, clipping, engineKw }: CaptionContext): CaptionRun[] {
  switch (phase) {
    case 'brake':
      return [
        { text: 'Braking: the motor-generator turns the car’s kinetic energy into up to ' },
        { text: MOTOR_KW, tone: 'energy' },
        { text: ' of ' },
        { text: 'charging power', tone: 'energy' },
        { text: '. The brakes turn the rest into heat.' },
      ];
    case 'clip':
      return [
        { text: 'Super clipping: still flat out, but the motor turns part of the ' },
        { text: 'engine’s power', tone: 'engine' },
        { text: ' back into ' },
        { text: 'charge', tone: 'energy' },
        { text: '. The car slows before it even brakes.' },
      ];
    case 'deploy':
      return [
        { text: 'Full throttle: the battery adds up to ' },
        { text: MOTOR_KW, tone: 'energy' },
        { text: ' through the motor, as much as the tyres can use — until the rules fade it out above ' },
        { text: `${MOTOR_FADE_KMH} km/h`, tone: 'strong' },
        { text: '.' },
      ];
    case 'lift':
      if (engineKw !== undefined && engineKw >= FLAT_OUT_SHARE * ESTIMATES.iceKw) {
        return [
          { text: 'Fast corner: still on the power, but ' },
          { text: 'grip', tone: 'strong' },
          { text: ' sets the speed, not power.' },
        ];
      }
      return [
        { text: 'Mid-corner the driver is partly off the throttle: here speed is set by ' },
        { text: 'grip', tone: 'strong' },
        { text: ', not power.' },
      ];
    case 'engine':
    default:
      if (socMJ < EMPTY_MJ && kmh > 150) {
        return [
          { text: 'Battery empty', tone: 'strong' },
          { text: `: no motor power left (up to ${MOTOR_KW} lost). This is how 2026 cars run out of speed mid-straight` },
          ...(clipping ? [] : [{ text: ' — turn super clipping back on', tone: 'muted' as const }]),
          { text: '.' },
        ];
      }
      return [
        { text: 'Out of a slow corner the tyres can’t use more power yet, so the motor ' },
        { text: 'waits', tone: 'strong' },
        { text: ' — deploying now would only spin the wheels.' },
      ];
  }
}
