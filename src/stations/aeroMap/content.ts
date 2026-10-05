/**
 * Station 6 words: the one-line "why" for each state of the car on its aero map, and the facts about
 * a set-up those lines quote.
 *
 * A caption follows the band the car is in (parked, settling on its springs with the floor attached,
 * at the floor's peak, stalled, porpoising, bottoming), never the frame: the live numbers sit in the
 * readouts and on the map. Every number a caption prints belongs to the set-up (how far it squats by
 * 300 km/h, from what speed it stalls) or is rounded coarsely (the bounce to the nearest half hertz),
 * so a band's text stays put while the speed moves and the polite live region stays calm.
 */
import type { Platform } from '../../physics/aeromap';
import { fmtKmh, fmtMm, fmtPct, fmtRatio } from '../../ui/format';
import type { CaptionRun, FloorRegime, RideHeights } from '../../ui/types';

export type AeroMapBand = 'parked' | 'attached' | 'peak' | 'stalled' | 'porpoising' | 'bottoming';

/** Below this the car is parked: no air, no squat. */
export const PARKED_BELOW_KMH = 1;
/** The speed the "attached" caption quotes a set-up at: a long straight, and where 2022 cars porpoised. */
export const QUOTE_KMH = 300;

/** What a set-up does as speed builds, read off its platform sweep (0 → top speed). */
export interface SetupFacts {
  setup: RideHeights;
  /** How far the car has sunk from its static heights by QUOTE_KMH, mm. */
  squatFrontMm: number;
  squatRearMm: number;
  /** ClA at QUOTE_KMH over ClA at the static heights, minus one (0.15: 15 % more). */
  downforceGain: number;
  /** Front share at QUOTE_KMH minus at the static heights, percentage points (+: toward the front). */
  balanceShiftPts: number;
  /** The floor's state at QUOTE_KMH, and whether the plank is on the road there. */
  quoteRegime: FloorRegime;
  quoteBottoming: boolean;
  /** Lowest sweep speed at which the floor is at its peak, stalled, or the plank is on the road (null: never). */
  peakKmh: number | null;
  stallKmh: number | null;
  bottomKmh: number | null;
}

/** Facts from a platform sweep that starts at rest (sweep[0] is 0 km/h). */
export function setupFacts(setup: RideHeights, sweep: readonly Platform[]): SetupFacts {
  const rest = sweep[0];
  // The sweep point nearest the quoted speed (the sweep steps in 5 km/h, so it lands on it).
  let quote = sweep[sweep.length - 1];
  for (const p of sweep) if (Math.abs(p.speedKmh - QUOTE_KMH) < Math.abs(quote.speedKmh - QUOTE_KMH)) quote = p;
  const first = (test: (p: Platform) => boolean) => sweep.find(test)?.speedKmh ?? null;
  return {
    setup: { frontMm: setup.frontMm, rearMm: setup.rearMm },
    squatFrontMm: rest.dynamic.frontMm - quote.dynamic.frontMm,
    squatRearMm: rest.dynamic.rearMm - quote.dynamic.rearMm,
    downforceGain: quote.point.clA / rest.point.clA - 1,
    balanceShiftPts: (quote.point.frontShare - rest.point.frontShare) * 100,
    quoteRegime: quote.point.floor.regime,
    quoteBottoming: quote.bottoming,
    peakKmh: first((p) => p.point.floor.regime !== 'attached'),
    stallKmh: first((p) => p.point.floor.regime === 'stalled'),
    bottomKmh: first((p) => p.bottoming),
  };
}

export interface BandInputs {
  kmh: number;
  regime: FloorRegime;
  bottoming: boolean;
  /** The least-damped body mode has gone unstable. */
  porpoising: boolean;
}

/** The car's state for the caption. Bottoming outranks porpoising (the plank stops the bounce), which outranks the floor. */
export function bandOf({ kmh, regime, bottoming, porpoising }: BandInputs): AeroMapBand {
  if (kmh < PARKED_BELOW_KMH) return 'parked';
  if (bottoming) return 'bottoming';
  if (porpoising) return 'porpoising';
  return regime;
}

export interface CaptionContext {
  band: AeroMapBand;
  facts: SetupFacts;
  /** Frequency of the bounce (the least-damped mode), Hz. Only quoted while porpoising. */
  bounceHz: number;
  /** How many times bigger the 3D view draws the bounce (1: to scale). */
  bounceDrawn: number;
}

/** Keep a number with its unit on one line. */
const nb = (n: string, unit: string) => `${n} ${unit}`;
const mm = (x: number) => fmtMm(Math.round(x));
/** The bounce to the nearest half hertz: close enough to name, coarse enough not to flicker. */
export const roundHz = (hz: number) => Math.round(hz * 2) / 2;

function attached({ facts }: CaptionContext): CaptionRun[] {
  if (facts.quoteBottoming || facts.quoteRegime === 'stalled') {
    // A low set-up: say where it runs out of floor instead of quoting it at 300 km/h.
    const plankFirst = facts.bottomKmh !== null && (facts.stallKmh === null || facts.bottomKmh < facts.stallKmh);
    const at = plankFirst ? facts.bottomKmh! : facts.stallKmh!;
    return [
      { text: 'Downforce squashes the car on its springs, so it slides across the map. This set-up starts low: from about ' },
      { text: nb(fmtKmh(at), 'km/h'), tone: 'strong' },
      plankFirst
        ? { text: ' the plank under the floor touches the road.' }
        : { text: ' the floor runs so close to the road that its diffuser stalls.' },
    ];
  }
  const gain = Math.round(facts.downforceGain * 100);
  const shift = Math.round(facts.balanceShiftPts * 10) / 10;
  return [
    { text: `Downforce squashes the car on its springs. By ${nb(fmtKmh(QUOTE_KMH), 'km/h')} it sits ` },
    { text: `${nb(mm(facts.squatFrontMm), 'mm')} lower at the front and ${nb(mm(facts.squatRearMm), 'mm')} at the rear`, tone: 'strong' },
    { text: '. Nearer the road the floor sucks harder: ' },
    { text: `${nb(fmtPct(Math.abs(gain)), '%')} ${gain >= 0 ? 'more' : 'less'} downforce`, tone: 'down' },
    {
      text:
        shift === 0
          ? ' than at the static heights, and the balance barely moves.'
          : ` than at the static heights, and the balance moves ${fmtRatio(Math.abs(shift))} ${Math.abs(shift) === 1 ? 'point' : 'points'} ${shift > 0 ? 'forward' : 'rearward'}.`,
    },
  ];
}

export function captionFor(ctx: CaptionContext): CaptionRun[] {
  const { band, facts } = ctx;
  switch (band) {
    case 'parked':
      return [
        { text: 'Parked at ' },
        { text: `${nb(mm(facts.setup.frontMm), 'mm')} front, ${nb(mm(facts.setup.rearMm), 'mm')} rear`, tone: 'strong' },
        { text: '. An aero map charts ' },
        { text: 'downforce', tone: 'down' },
        { text: ' against those two ride heights. Add speed and watch the car settle across it.' },
      ];
    case 'peak':
      return [
        { text: 'The floor is at its ' },
        { text: 'most powerful height', tone: 'down' },
        { text: ': the gap at the diffuser inlet is close to the one that sucks hardest. Little margin: a few millimetres lower and the flow lets go.' },
      ];
    case 'stalled':
      return [
        { text: 'Too low: the diffuser’s flow ' },
        { text: 'separates', tone: 'strong' },
        { text: ', so the floor ' },
        { text: 'loses downforce', tone: 'down' },
        { text: ' as the car sinks further. Raise the ride heights, or slow down.' },
      ];
    case 'porpoising': {
      const drawn = ctx.bounceDrawn > 1 ? ` (drawn ${ctx.bounceDrawn} times bigger)` : '';
      return [
        { text: 'Porpoising', tone: 'strong' },
        { text: ': below its peak the floor sucks harder as the car rises, and its flow answers a moment late, so each push feeds the bounce faster than the dampers soak it up. The car bounces at about ' },
        { text: nb(fmtRatio(roundHz(ctx.bounceHz)), 'Hz'), tone: 'strong' },
        { text: `${drawn}. This is what hit cars in 2022; 2026 floors are designed to avoid it.` },
      ];
    }
    case 'bottoming':
      return [
        { text: 'Bottoming', tone: 'strong' },
        { text: ': the plank under the floor is on the road. The ground now holds the car up, the floor can get no closer, and the plank wears.' },
      ];
    case 'attached':
    default:
      return attached(ctx);
  }
}

/** What a caption depends on, as one string: rebuild the caption only when this changes. */
export function captionKey(ctx: CaptionContext, factsVersion: number): string {
  return `${ctx.band}|${factsVersion}|${ctx.band === 'porpoising' ? roundHz(ctx.bounceHz) : ''}|${ctx.bounceDrawn}`;
}
