/**
 * Station 2 words: presets and the one-line "why" captions.
 *
 * Like Station 1, captions change by band (mode × where the speed sits relative to the two top
 * speeds), never every frame; live numbers belong to the readouts.
 */
import { ESTIMATES, REGS } from '../../physics/constants';
import type { PowerStatus } from '../../physics/powertrain';
import type { AeroMode, CaptionRun, SpeedPreset } from '../../ui/types';

export const PRESETS: SpeedPreset[] = [
  { kmh: 180, label: 'Corner exit' },
  { kmh: 260, label: 'Mid-straight' },
  { kmh: 290, label: 'Taper starts' },
  { kmh: 320, label: 'Fast straight' },
  { kmh: 340, label: 'Longest straight' },
];

const pct = (factor: number) => `${Math.round((1 - factor) * 100)}%`;
const DRAG_CUT = pct(ESTIMATES.straightMode.cdAFactor);
const DOWNFORCE_CUT = pct(ESTIMATES.straightMode.clAFactor);
const MOTOR_KW = `${REGS.mguKMaxKw.value} kW`;
export interface CaptionContext {
  kmh: number;
  mode: AeroMode;
  /** Flap position 0–1; strictly between means the flaps are moving. */
  straightT: number;
  status: PowerStatus;
  topCornerKmh: number;
  topStraightKmh: number;
}

export function captionFor({ kmh, mode, straightT, status, topCornerKmh, topStraightKmh }: CaptionContext): CaptionRun[] {
  // Same rounding as the readouts, so the caption's gain matches the numbers on screen.
  const gain = `${Math.round(topStraightKmh) - Math.round(topCornerKmh)} km/h`;

  if (straightT > 0.02 && straightT < 0.98) {
    return [
      { text: 'Flaps moving. The rules allow ' },
      { text: '400 ms at most', tone: 'strong' },
      { text: ', and any failure snaps the wings back to Corner Mode.' },
    ];
  }

  if (mode === 'corner') {
    if (kmh < 200) {
      return [
        { text: 'Corner Mode: flaps closed for ' },
        { text: 'maximum downforce', tone: 'down' },
        { text: ' — the grip a car needs through turns. Now drag the speed up a straight.' },
      ];
    }
    if (kmh < 290) {
      return [
        { text: 'The power the air takes grows with ' },
        { text: 'speed³', tone: 'drag' },
        { text: '. Up to 290 km/h the electric motor may still give its ' },
        { text: `full ${MOTOR_KW}`, tone: 'strong' },
        { text: '.' },
      ];
    }
    if (status === 'accelerating') {
      return [
        { text: 'Above 290 km/h the rules ' },
        { text: 'turn the electric motor down', tone: 'strong' },
        { text: ' while ' },
        { text: 'drag', tone: 'drag' },
        { text: ' keeps climbing. Try Straight Mode.' },
      ];
    }
    if (status === 'top') {
      return [
        { text: 'Here the air takes every kilowatt the car has: ' },
        { text: `Corner Mode tops out near ${Math.round(topCornerKmh)} km/h`, tone: 'strong' },
        { text: '.' },
      ];
    }
    if (kmh > topStraightKmh) {
      return [
        { text: 'On track the car ' },
        { text: 'can’t reach this', tone: 'strong' },
        { text: ' in either mode: the air would take more power than it has, even with the wings open.' },
      ];
    }
    return [
      { text: 'On track the car ' },
      { text: 'can’t reach this', tone: 'strong' },
      { text: ' in Corner Mode: the air would take more power than it has. ' },
      { text: 'Open the wings', tone: 'drag' },
      { text: '.' },
    ];
  }

  // Straight Mode
  if (kmh < 200) {
    return [
      { text: 'Open wings save little at low speed, and in a corner the car would miss ' },
      { text: `${DOWNFORCE_CUT} of its downforce`, tone: 'down' },
      { text: '. That’s why Straight Mode only works in marked zones.' },
    ];
  }
  if (status === 'accelerating') {
    return [
      { text: 'Flaps open: ' },
      { text: `${DRAG_CUT} less drag`, tone: 'drag' },
      { text: ' for ' },
      { text: `${DOWNFORCE_CUT} less downforce`, tone: 'down' },
      { text: '. On a straight, that trade buys about ' },
      { text: gain, tone: 'strong' },
      { text: '.' },
    ];
  }
  if (status === 'top') {
    return [
      { text: 'Straight Mode tops out near ' },
      { text: `${Math.round(topStraightKmh)} km/h`, tone: 'strong' },
      { text: '. Without Overtake, by 345 km/h the rules allow the electric motor nothing at all.' },
    ];
  }
  return [
    { text: 'Even with the wings open the car ' },
    { text: 'runs out of power', tone: 'strong' },
    { text: ` here: the motor’s allowance has shrunk to a fraction of its ${MOTOR_KW} (FIA C5.2.8).` },
  ];
}
