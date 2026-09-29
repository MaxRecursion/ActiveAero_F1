/**
 * Station 1 words: speed presets and the one-line "why" captions.
 *
 * Captions change by band, not every frame: the live numbers already sit in the readouts, and a
 * caption that rewrote itself on every slider tick would make the aria-live region chatter.
 */
import type { AeroState } from '../../physics/aero';
import { fmtKmhAtLeast } from '../../ui/format';
import type { CaptionRun, SpeedPreset } from '../../ui/types';

export const PRESETS: SpeedPreset[] = [
  { kmh: 0, label: 'Parked' },
  { kmh: 70, label: 'Hairpin' },
  { kmh: 150, label: 'Medium corner' },
  { kmh: 250, label: 'Fast corner' },
  { kmh: 330, label: 'End of straight' },
];

export interface CaptionContext {
  aero: AeroState;
  exploded: boolean;
  ceiling: 'off' | 'sticks' | 'falls';
}

/** Downforce grows with speed², so it reaches k × weight at ceilingSpeed × √k. */
const speedForRatio = (ceilingKmh: number, ratio: number): number => ceilingKmh * Math.sqrt(ratio);

export function captionFor({ aero, exploded, ceiling }: CaptionContext): CaptionRun[] {
  const v = aero.speedKmh;
  const vc = aero.ceilingSpeedKmh;

  if (ceiling === 'falls') {
    return [
      { text: 'Upside down, ' },
      { text: 'gravity', tone: 'weight' },
      { text: ' is winning: the air isn’t pushing hard enough to hold the car up. It needs ' },
      { text: `at least ${fmtKmhAtLeast(vc)} km/h`, tone: 'down' },
      { text: '.' },
    ];
  }
  if (ceiling === 'sticks') {
    return [
      { text: 'From ' },
      { text: `${fmtKmhAtLeast(vc)} km/h`, tone: 'down' },
      { text: ' up, the wings and floor push harder than ' },
      { text: 'gravity', tone: 'weight' },
      { text: ' pulls. In theory, the car could ' },
      { text: 'drive on this ceiling', tone: 'strong' },
      { text: '.' },
    ];
  }
  if (exploded) {
    return [
      { text: 'Bodywork off: the ' },
      { text: 'floor', tone: 'down' },
      { text: ' makes more than half the downforce. Air squeezed through its tunnels ' },
      { text: 'speeds up', tone: 'strong' },
      { text: ', its pressure drops, and the car is sucked toward the road.' },
    ];
  }
  if (v < 1) {
    return [
      { text: 'Parked, a wing is just a shape. ' },
      { text: 'Air has to move', tone: 'strong' },
      { text: ' before it can push. Drag the speed.' },
    ];
  }
  if (v < 100) {
    return [
      { text: 'At low speed the air barely pushes. Grip comes almost entirely from the car’s own ' },
      { text: 'weight', tone: 'weight' },
      { text: '.' },
    ];
  }
  if (v < vc - 15) {
    return [
      { text: 'Double the speed and the push ' },
      { text: 'quadruples', tone: 'down' },
      { text: ': downforce grows with ' },
      { text: 'speed²', tone: 'strong' },
      { text: '. So does ' },
      { text: 'drag', tone: 'drag' },
      { text: '.' },
    ];
  }
  if (v <= vc + 15) {
    return [
      { text: 'Around ' },
      { text: `${fmtKmhAtLeast(vc)} km/h`, tone: 'down' },
      { text: ' the air pushes down as hard as ' },
      { text: 'gravity', tone: 'weight' },
      { text: ' pulls. Try the ' },
      { text: 'ceiling test', tone: 'strong' },
      { text: '.' },
    ];
  }
  if (v < speedForRatio(vc, 2)) {
    return [
      { text: 'Downforce now ' },
      { text: 'outweighs the car', tone: 'down' },
      { text: '. The tyres are pressed down harder than gravity alone could, so the car can corner faster.' },
    ];
  }
  return [
    { text: 'Now the air presses down with ' },
    { text: 'more than twice the car’s weight', tone: 'down' },
    { text: '. But pushing through it costs ' },
    { text: 'drag power', tone: 'drag' },
    { text: ', which grows with speed³.' },
  ];
}
