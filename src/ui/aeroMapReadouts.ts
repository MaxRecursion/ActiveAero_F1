/**
 * Station 6, zone B — what the ride heights do to the car at this speed, most important first:
 * how much downforce (and how its coefficient compares with the car parked at its static heights),
 * where it acts (aero balance), how far the car has sunk on its springs, what the floor is doing on
 * its ground-effect curve, whether the body is bouncing — plus the pressure under the floor.
 *
 * Like the other stations' readouts these are not aria-live (they change every frame); the caption
 * carries the spoken summary.
 */
import { aeroMapAt } from '../physics/aeromap';
import { SPEED_RANGE_KMH } from '../physics/constants';
import type { FloorRegime, Station6View } from './types';
import { h, textSlot } from './dom';
import { fmtKmh, fmtKN, fmtMm, MINUS } from './format';
import { createFloorPressureChart } from './floorPressureChart';

export interface AeroMapReadouts {
  el: HTMLElement;
  render(view: Station6View): void;
  dispose(): void;
}

const REGIME_WORD: Record<FloorRegime, string> = { attached: 'Attached', peak: 'At its peak', stalled: 'Stalled' };

const two = (x: number) => x.toFixed(2);
const one = (x: number) => x.toFixed(1);
/** Signed with a real minus, e.g. "+12 %", "−0.4 pt"; zero prints unsigned. */
const signed = (x: number, digits: number) => {
  const r = Number(x.toFixed(digits));
  return r > 0 ? `+${r.toFixed(digits)}` : r < 0 ? `${MINUS}${Math.abs(r).toFixed(digits)}` : (0).toFixed(digits);
};

function cell(cls: string, label: string, unit: string, subs: number) {
  const value = h('span', 'ro-num');
  const unitEl = h('span', { class: 'ro-unit', text: unit });
  const subEls = Array.from({ length: subs }, (_, i) => h('span', `ro-sub ro-sub-${i + 1}`));
  const el = h('div', `ro ${cls}`, [
    h('span', 'micro ro-label', [h('i', { class: 'swatch', attrs: { 'aria-hidden': 'true' } }), label]),
    h('span', 'ro-value', [value, unitEl]),
    ...subEls,
  ]);
  return { el, value: textSlot(value), unit: textSlot(unitEl), subs: subEls };
}

export function createAeroMapReadouts(): AeroMapReadouts {
  // ── downforce: the force, its coefficient and its change from the parked heights ──
  const down = cell('ro--down ro--main amr-down', 'Downforce', 'kN', 0);
  const claNum = h('span', 'amr-strong');
  const claChip = h('span', { class: 'delta-chip amr-chip', attrs: { hidden: '' } });
  const dragNum = h('span', 'amr-strong amr-drag');
  const ldNum = h('span', 'amr-strong');
  down.el.append(
    h('span', 'ro-sub amr-cla', ['ClA ', claNum, h('span', { class: 'ro-unit', text: ' m²' }), claChip]),
    h('span', 'ro-sub amr-dragline', ['Drag ', dragNum, h('span', { class: 'ro-unit', text: ' kN' }), h('span', { class: 'amr-sep', text: ' · ' }), 'L/D ', ldNum]),
  );
  const setCla = textSlot(claNum);
  const setClaChip = textSlot(claChip);
  const setDrag = textSlot(dragNum);
  const setLd = textSlot(ldNum);

  // ── balance: share of the downforce on the front axle ─────────────────────────
  const bal = cell('ro--down amr-bal', 'Aero balance', '% front', 2);
  const setBalRef = textSlot(bal.subs[0]);
  const setBalWeight = textSlot(bal.subs[1]);

  // ── ride height now, and how far the car has sunk ───────────────────────────────
  const ride = cell('amr-ride', 'Ride height now', 'mm', 2);
  const setRideSquat = textSlot(ride.subs[0]);
  const setPlank = textSlot(ride.subs[1]);

  // ── the floor on its curve ───────────────────────────────────────────────────────
  const floor = cell('amr-floor', 'Floor', '', 2);
  const setThroat = textSlot(floor.subs[0]);
  const setPeakGap = textSlot(floor.subs[1]);

  // ── the body's bounce ─────────────────────────────────────────────────────────────
  const bounce = cell('amr-bounce', 'Bounce', '', 2);
  const setMode = textSlot(bounce.subs[0]);
  const setOnset = textSlot(bounce.subs[1]);

  const pressure = createFloorPressureChart();

  const el = h('section', { class: 'zone zone-read zone-read--amap', attrs: { 'aria-label': 'Aero at this speed' } }, [
    h('h2', 'micro zone-title', [h('span', { class: 'idx', text: 'B' }), 'Aero at this speed']),
    h('div', 'ro-grid ro-grid--amap', [down.el, bal.el, ride.el, floor.el, bounce.el, pressure.el]),
  ]);

  /** ClA of the set-up parked at its static heights: what "+12 %" is measured from. Cached per set-up. */
  let restFor = '';
  let restClA = 0;
  let chipShown = false;
  let regime: FloorRegime | null = null;
  let state = '';

  return {
    el,
    render(v) {
      const key = `${v.setup.frontMm}|${v.setup.rearMm}`;
      if (key !== restFor) {
        restFor = key;
        restClA = aeroMapAt(v.setup).clA;
      }
      down.value(fmtKN(v.downforceN));
      setCla(two(v.clA));
      const delta = restClA > 0 ? v.clA / restClA - 1 : 0;
      const show = Math.abs(delta) >= 0.005;
      if (show !== chipShown) {
        chipShown = show;
        claChip.hidden = !show;
      }
      if (show) setClaChip(`${signed(delta * 100, 0)} % vs parked`);
      setDrag(fmtKN(v.dragN));
      setLd(v.dragN > 1 ? one(v.efficiency) : '–');

      bal.value(one(v.frontSharePct));
      setBalRef(`${signed(v.frontSharePct - v.refFrontSharePct, 1)} pt vs reference`);
      setBalWeight(`weight ${Math.round(v.weightFrontPct)} % front`);

      // Signed: with the rear high, the reference plane extended to the front axle can dip below the road.
      ride.value(`${signed(v.dynamic.frontMm, 0)} / ${signed(v.dynamic.rearMm, 0)}`.replace(/\+/g, ''));
      setRideSquat(`sunk ${fmtMm(v.setup.frontMm - v.dynamic.frontMm)} / ${fmtMm(v.setup.rearMm - v.dynamic.rearMm)} mm`);
      setPlank(v.bottoming ? 'plank on the road' : `plank ${fmtMm(v.plankClearanceMm)} mm clear`);

      if (v.floor.regime !== regime) {
        regime = v.floor.regime;
        floor.value(REGIME_WORD[regime]);
      }
      setThroat(`throat gap ${fmtMm(v.floor.throatGapMm)} mm`);
      setPeakGap(`peak at ${fmtMm(v.floor.peakGapMm)} mm`);

      const b = v.bounce;
      bounce.value(b.unstable ? 'Porpoising' : 'Stable');
      // Non-breaking spaces keep each number with its unit when the narrow column wraps.
      setMode(b.unstable ? `${one(b.frequencyHz)}\u00a0Hz · ${one(b.amplitudeMm)}\u00a0mm swing` : `ζ\u00a0${two(b.dampingRatio)} · ${one(b.frequencyHz)}\u00a0Hz`);
      setOnset(
        b.onsetKmh === null
          ? `none up to ${SPEED_RANGE_KMH.max} km/h`
          : `porpoises ${fmtKmh(b.onsetKmh)}–${fmtKmh(b.untilKmh ?? SPEED_RANGE_KMH.max)} km/h`,
      );

      const nextState = `${v.floor.regime}|${b.unstable ? 'porpoise' : 'stable'}|${v.bottoming ? 'bottom' : 'clear'}`;
      if (nextState !== state) {
        state = nextState;
        el.dataset.floor = v.floor.regime;
        el.dataset.bounce = b.unstable ? 'porpoising' : 'stable';
        el.dataset.plank = v.bottoming ? 'down' : 'clear';
      }
      pressure.render(v.pressure);
    },
    dispose() {
      pressure.dispose();
    },
  };
}
