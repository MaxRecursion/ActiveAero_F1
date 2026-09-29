/**
 * Station 2, zone B — what opening the wings buys: top speed, drag and downforce (with the change
 * against Corner Mode), and the power balance that decides top speed.
 *
 * Like Station 1's readouts these are not aria-live (they change every frame); the caption
 * carries the spoken summary.
 */
import { REGS } from '../physics/constants';
import { powerStatus, type PowerStatus } from '../physics/powertrain';
import type { Station2View } from './types';
import { h, styleSlot, textSlot } from './dom';
import { fmtKmh, fmtKN, fmtKW } from './format';

export interface AeroReadouts {
  el: HTMLElement;
  render(view: Station2View): void;
}

/** Power meter full scale, kW (matches the chart's y axis). */
export const POWER_SCALE_KW = 800;
/** Deltas smaller than this (fraction) are not worth a chip. */
const MIN_DELTA = 0.005;

type Tone = 'down' | 'drag' | 'weight';
const STATUS: Record<PowerStatus, { long: string; short: string }> = {
  accelerating: { long: 'Enough power — still accelerating', short: 'Still accelerating' },
  top: { long: 'At top speed', short: 'At top speed' },
  short: { long: 'Can’t hold this speed — not enough power', short: 'Not enough power' },
};

const label = (text: string) => h('span', 'micro ro-label', [h('i', { class: 'swatch', attrs: { 'aria-hidden': 'true' } }), text]);

/** A force cell with a "vs Corner Mode" chip. */
function forceCell(tone: Tone, name: string, area: string) {
  const value = h('span', 'ro-num');
  const chip = h('span', { class: 'delta-chip', attrs: { hidden: '' } });
  const el = h('div', `ro ro--${tone} ${area}`, [
    label(name),
    h('span', 'ro-value', [value, h('span', { class: 'ro-unit', text: 'kN' }), chip]),
  ]);
  const setChip = textSlot(chip);
  const setValue = textSlot(value);
  let shown = false;
  return {
    el,
    render(n: number, cornerN: number) {
      setValue(fmtKN(n));
      const delta = cornerN > 50 ? n / cornerN - 1 : 0;
      const show = Math.abs(delta) >= MIN_DELTA;
      if (show !== shown) {
        shown = show;
        chip.hidden = !show;
      }
      if (show) setChip(`${delta < 0 ? '−' : '+'}${Math.round(Math.abs(delta) * 100)} %`);
    },
  };
}

/** One bar of the power meter: name, bar on the 0–800 kW scale, value. */
function meterRow(tone: Tone, name: string) {
  const fill = h('span', 'meter-fill');
  const value = h('span', 'meter-val');
  const track = h('span', 'meter-track', [fill]);
  const el = h('div', `meter-row meter-row--${tone}`, [
    h('span', { class: 'meter-name', text: name }),
    track,
    h('span', 'meter-num', [value, h('span', { class: 'meter-unit', text: ' kW' })]),
  ]);
  const setW = styleSlot(fill, '--w');
  const setV = textSlot(value);
  return {
    el,
    track,
    render(watts: number) {
      setW(Math.min(1, Math.max(0, watts / 1000 / POWER_SCALE_KW)).toFixed(4));
      setV(fmtKW(watts));
    },
  };
}

export function createAeroReadouts(): AeroReadouts {
  // Top speed: the headline of this station.
  const topNum = h('span', 'ro-num');
  const topCorner = h('span');
  const topStraight = h('span');
  const topGain = h('span');
  const cornerPart = h('span', 'top-part', ['Corner ', topCorner]);
  const straightPart = h('span', 'top-part', ['Straight ', topStraight]);
  const top = h('div', 'ro ro--weight ro--main ro--top', [
    h('span', 'micro ro-label', ['Top speed', h('span', { class: 'ro-est', text: 'est.' })]),
    h('span', 'ro-value', [topNum, h('span', { class: 'ro-unit', text: 'km/h' })]),
    h('span', 'ro-sub', [cornerPart, ' · ', straightPart]),
    h('span', 'ro-sub ro-gain', [topGain, h('span', { class: 'ro-gain-why', text: ' with the flaps open' })]),
  ]);

  const drag = forceCell('drag', 'Drag', 'ro--drag2');
  const down = forceCell('down', 'Downforce', 'ro--down2');

  const needs = meterRow('drag', 'Needs');
  const has = meterRow('weight', 'Has');
  // The "has" level repeated on the "needs" track makes the comparison one glance.
  const hasTick = h('span', 'meter-tick');
  needs.track.append(hasTick);
  const statusLong = h('span', 'status-long');
  const statusShort = h('span', 'status-short');
  const status = h('p', { class: 'power-status', attrs: { 'data-status': 'accelerating' } }, [
    h('i', { class: 'status-dot', attrs: { 'aria-hidden': 'true' } }),
    statusLong,
    statusShort,
  ]);
  const motorKw = h('span', 'motor-kw');
  const motor = h('p', 'motor-line', [
    'Electric motor allowed ',
    motorKw,
    ` of ${REGS.mguKMaxKw.value} kW `,
    h('span', { class: 'nowrap', text: `(FIA ${REGS.mguKTaper.ref})` }),
  ]);
  const power = h('div', 'power', [
    h('span', 'micro power-title', ['Power at the tyres', h('span', { class: 'split-unit', text: `0–${POWER_SCALE_KW} kW` })]),
    needs.el,
    has.el,
    status,
    motor,
  ]);

  const el = h('section', { class: 'zone zone-read zone-read--aero', attrs: { 'aria-label': 'Top speed, forces and power' } }, [
    h('h2', 'micro zone-title', [h('span', { class: 'idx', text: 'B' }), 'At this speed']),
    h('div', 'ro-grid ro-grid--aero', [top, drag.el, down.el, power]),
  ]);

  const setTop = textSlot(topNum);
  const setCorner = textSlot(topCorner);
  const setStraight = textSlot(topStraight);
  const setGain = textSlot(topGain);
  const setTick = styleSlot(hasTick, '--w');
  const setLong = textSlot(statusLong);
  const setShort = textSlot(statusShort);
  const setMotor = textSlot(motorKw);
  let lastStatus: PowerStatus | null = null;
  let lastMode: Station2View['mode'] | null = null;

  return {
    el,
    render(v) {
      const corner = Math.round(v.topSpeedCornerKmh);
      const straight = Math.round(v.topSpeedStraightKmh);
      setTop(fmtKmh(v.mode === 'straight' ? straight : corner));
      setCorner(fmtKmh(corner));
      setStraight(fmtKmh(straight));
      // The gain is the difference of the printed numbers, so the line always adds up.
      setGain(`+${fmtKmh(straight - corner)}\u00a0km/h`);
      if (v.mode !== lastMode) {
        lastMode = v.mode;
        cornerPart.classList.toggle('is-current', v.mode === 'corner');
        straightPart.classList.toggle('is-current', v.mode === 'straight');
      }

      drag.render(v.dragN, v.cornerDragN);
      down.render(v.downforceN, v.cornerDownforceN);

      needs.render(v.requiredPowerW);
      has.render(v.availablePowerW);
      setTick(Math.min(1, v.availablePowerW / 1000 / POWER_SCALE_KW).toFixed(4));

      const st = powerStatus(v);
      if (st !== lastStatus) {
        lastStatus = st;
        status.dataset.status = st;
        setLong(STATUS[st].long);
        setShort(STATUS[st].short);
      }
      setMotor(fmtKW(v.mguKLimitKw * 1000));
    },
  };
}
