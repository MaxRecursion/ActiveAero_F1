/**
 * Station 3 words: the one-line "why" for each moment of the lap.
 *
 * Captions follow the lap phase (with a couple of refinements: an empty battery, a slow corner
 * exit), so they change a few times per lap, never every frame.
 */
import type { LapPhase } from '../../physics/lap';
import type { CaptionRun } from '../../ui/types';

export interface CaptionContext {
  phase: LapPhase;
  kmh: number;
  socMJ: number;
  clipping: boolean;
}

/** Below this charge the motor is about to stop helping. */
const EMPTY_MJ = 0.05;

export function captionFor({ phase, kmh, socMJ, clipping }: CaptionContext): CaptionRun[] {
  switch (phase) {
    case 'brake':
      return [
        { text: 'Braking: the motor-generator catches up to ' },
        { text: '350 kW', tone: 'energy' },
        { text: ' of the car’s momentum and ' },
        { text: 'stores it', tone: 'energy' },
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
        { text: '350 kW', tone: 'energy' },
        { text: ' through the motor — nearly as much as the ' },
        { text: 'engine', tone: 'engine' },
        { text: ' makes on its own.' },
      ];
    case 'lift':
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
          { text: ': the car has just lost up to 350 kW. This is how 2026 cars run out of speed mid-straight' },
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
