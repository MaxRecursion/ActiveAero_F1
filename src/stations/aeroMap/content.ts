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
      { text: 'Downforce squashes the car on its springs, and this set-up starts low: from about ' },
      { text: nb(fmtKmh(at), 'km/h'), tone: 'strong' },
      plankFirst ? { text: ' the plank touches the road.' } : { text: ' the diffuser stalls.' },
    ];
  }
  const gain = Math.round(facts.downforceGain * 100);
  const shift = Math.round(facts.balanceShiftPts * 10) / 10;
  const balance =
    shift === 0 ? ', balance unchanged.' : `, balance ${fmtRatio(Math.abs(shift))} ${Math.abs(shift) === 1 ? 'point' : 'points'} ${shift > 0 ? 'forward' : 'back'}.`;
  const sunk = { text: `${nb(mm(facts.squatFrontMm), 'mm')} front, ${nb(mm(facts.squatRearMm), 'mm')} rear`, tone: 'strong' as const };
  if (gain < 0) {
    // Static heights already near the floor's best: sinking takes it past its peak.
    return [
      { text: `By ${nb(fmtKmh(QUOTE_KMH), 'km/h')} the springs let it sink ` },
      sunk,
      { text: ', past the floor’s best height: ' },
      { text: `${nb(fmtPct(-gain), '%')} less downforce`, tone: 'down' },
      { text: ` than at rest${balance}` },
    ];
  }
  return [
    { text: `By ${nb(fmtKmh(QUOTE_KMH), 'km/h')} the springs let it sink ` },
    sunk,
    { text: '. Nearer the road the floor sucks harder: ' },
    { text: `${nb(fmtPct(gain), '%')} more downforce`, tone: 'down' },
    { text: balance },
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
        { text: ' against these two ride heights. Add speed.' },
      ];
    case 'peak':
      return [
        { text: 'The floor is at its ' },
        { text: 'most powerful height', tone: 'down' },
        { text: '. Little margin: a few millimetres lower and the diffuser’s flow lets go.' },
      ];
    case 'stalled':
      return [
        { text: 'Too low: the diffuser’s flow ' },
        { text: 'separates', tone: 'strong' },
        { text: ' and the floor ' },
        { text: 'loses downforce', tone: 'down' },
        { text: ' as the car sinks. Raise the ride heights, or slow down.' },
      ];
    case 'porpoising': {
      const drawn = ctx.bounceDrawn > 1 ? ` (drawn ${ctx.bounceDrawn}× bigger)` : ctx.bounceDrawn === 0 ? ' (not animated)' : '';
      return [
        { text: 'Porpoising', tone: 'strong' },
        { text: ' at ' },
        { text: nb(fmtRatio(roundHz(ctx.bounceHz)), 'Hz'), tone: 'strong' },
        { text: `${drawn}: the stalling floor pulls a moment late, so each bounce feeds the next faster than the dampers kill it.` },
      ];
    }
    case 'bottoming':
      return [
        { text: 'Bottoming', tone: 'strong' },
        { text: ': the plank is on the road. The ground now holds the car up, and the plank wears away.' },
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
