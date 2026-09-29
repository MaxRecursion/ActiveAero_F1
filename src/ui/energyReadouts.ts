/**
 * Station 3, zone B — the numbers the broadcast stopped showing: the battery's charge inside its
 * regulated 4 MJ window, what the motor-generator is doing (and which way the energy flows), the
 * engine's share, the energy recovered and used so far this lap against the 8.5 MJ cap, and what
 * super clipping is worth in lap time.
 *
 * Like the other stations' readouts these are not aria-live (they change every frame); the
 * caption carries the spoken summary.
 */
import { ESTIMATES, REGS } from '../physics/constants';
import { simulateLap } from '../physics/lap';
import type { LapTrace, Station3View } from './types';
import { h, styleSlot, textSlot } from './dom';
import { fmtKmh, fmtKW, fmtLimit, fmtMJ, fmtS, fmtSignedKw, MINUS } from './format';
import { harvestSplit, type HarvestSplit } from './lapMath';

export interface EnergyReadouts {
  el: HTMLElement;
  render(view: Station3View): void;
}

/** Battery gauge segments across the window (4 MJ → 0.25 MJ each). */
const SEGMENTS = 16;
/** The recovery bars run a little past the cap so the cap line sits inside them. */
const HARVEST_SCALE = 1.12;
/** Below this the motor reads as idle, kW. */
const IDLE_KW = 0.5;

type Dir = 'deploy' | 'harvest' | 'idle';
const DIR_TEXT: Record<Dir, string> = { deploy: '→ to the wheels', harvest: '→ into the battery', idle: 'idle' };

const label = (text: string, extra: Node[] = []) =>
  h('span', 'micro ro-label', [h('i', { class: 'swatch', attrs: { 'aria-hidden': 'true' } }), text, ...extra]);

/**
 * Lap time with super clipping, for the comparison when clipping is off. The lap the station
 * sends then has no clipping, so the last clipping lap seen is remembered; if there has not been
 * one yet, the reference lap is simulated once.
 */
let clipLapTimeS: number | null = null;
function clippingLapTime(lap: LapTrace): number {
  if (lap.clipping) clipLapTimeS = lap.lapTimeS;
  if (clipLapTimeS === null) clipLapTimeS = simulateLap({ clipping: true }).lapTimeS;
  return clipLapTimeS;
}

export function createEnergyReadouts(): EnergyReadouts {
  // ── battery ───────────────────────────────────────────────────────────────────
  const battNum = h('span', 'ro-num');
  const battUnit = h('span', 'ro-unit');
  const segFills = Array.from({ length: SEGMENTS }, () => h('i', 'batt-fill'));
  const gauge = h('span', { class: 'batt-gauge', attrs: { 'aria-hidden': 'true' } }, segFills.map((fill) => h('span', 'batt-seg', [fill])));
  const batt = h('div', 'ro ro--energy ro--batt', [
    label('Battery'),
    h('span', 'ro-value', [battNum, battUnit]),
    gauge,
    h('span', { class: 'ro-sub ro-rule', text: `Usable window · FIA ${REGS.energyStoreWindowMJ.ref}` }),
  ]);
  const setBattNum = textSlot(battNum);
  const setSegs = segFills.map((fill) => styleSlot(fill, '--f'));

  // ── motor and engine ─────────────────────────────────────────────────────────
  const motorNum = h('span', 'ro-num');
  const motorDir = h('span', 'ro-dir');
  const flowFill = h('span', 'flow-fill');
  const flow = h('span', { class: 'flow-track', attrs: { 'aria-hidden': 'true' } }, [flowFill, h('span', 'flow-mid')]);
  const engineNum = h('span', 'eng-num');
  const engineFill = h('span', 'eng-fill');
  const motor = h('div', { class: 'ro ro--motor', attrs: { 'data-dir': 'idle' } }, [
    label('Motor', [h('span', { class: 'ro-label-aside', text: `≤ ${REGS.mguKMaxKw.value} kW` })]),
    h('span', 'ro-value', [motorNum, h('span', { class: 'ro-unit', text: 'kW' }), motorDir]),
    flow,
    h('span', 'eng-row', [
      h('span', 'eng-label', [h('i', { class: 'swatch', attrs: { 'aria-hidden': 'true' } }), 'Engine']),
      h('span', { class: 'eng-track', attrs: { 'aria-hidden': 'true' } }, [engineFill]),
      h('span', 'eng-val', [engineNum, h('span', { class: 'meter-unit', text: ' kW' })]),
    ]),
  ]);
  const setMotorNum = textSlot(motorNum);
  const setMotorDir = textSlot(motorDir);
  const setFlowL = styleSlot(flowFill, '--l');
  const setFlowR = styleSlot(flowFill, '--r');
  const setEngine = textSlot(engineNum);
  const setEngineW = styleSlot(engineFill, '--w');

  // ── this lap: recovered (brakes + super clipping) and used, against the cap ──────
  const capPct = `${((1 / HARVEST_SCALE) * 100).toFixed(2)}%`;
  const recBrake = h('span', 'hv-fill hv-fill--brake');
  const recClip = h('span', 'hv-fill hv-fill--clip');
  const recGhost = h('span', 'hv-ghost');
  const recTrack = h('span', { class: 'hv-track', attrs: { 'aria-hidden': 'true' } }, [recGhost, recBrake, recClip, h('span', 'hv-cap')]);
  recTrack.style.setProperty('--cap', capPct);
  const usedFill = h('span', 'hv-fill hv-fill--used');
  const usedGhost = h('span', 'hv-ghost');
  const usedTrack = h('span', { class: 'hv-track', attrs: { 'aria-hidden': 'true' } }, [usedGhost, usedFill]);
  const recNum = h('span');
  const usedNum = h('span');
  const hvRow = (name: string, track: HTMLElement, value: HTMLElement, extra: string) =>
    h('div', `hv-row ${extra}`, [
      h('span', { class: 'hv-name', text: name }),
      track,
      h('span', 'hv-num', [value, h('span', { class: 'meter-unit', text: ' MJ' })]),
    ]);
  const harvest = h('div', 'harvest', [
    h('span', 'micro harvest-title', ['This lap', h('span', { class: 'split-unit', text: `cap ${fmtLimit(REGS.harvestPerLapMJ.value)} MJ · FIA ${REGS.harvestPerLapMJ.ref}` })]),
    hvRow('Recovered', recTrack, recNum, 'hv-row--rec'),
    hvRow('Used', usedTrack, usedNum, 'hv-row--used'),
    h('span', { class: 'hv-legend', attrs: { 'aria-hidden': 'true' } }, [
      h('span', 'hv-key', [h('i', 'hv-swatch hv-swatch--brake'), 'Braking']),
      h('span', 'hv-key', [h('i', 'hv-swatch hv-swatch--clip'), 'Super clipping']),
    ]),
  ]);
  const setRec = textSlot(recNum);
  const setUsed = textSlot(usedNum);
  const setRecB = styleSlot(recBrake, '--w');
  const setRecC0 = styleSlot(recClip, '--x');
  const setRecC = styleSlot(recClip, '--w');
  const setRecGhost = styleSlot(recGhost, '--w');
  const setUsedW = styleSlot(usedFill, '--w');
  const setUsedGhost = styleSlot(usedGhost, '--w');

  // ── lap time ─────────────────────────────────────────────────────────────────
  const timeNum = h('span', 'ro-num');
  const cmpName = h('span');
  const cmpTime = h('span', 'ro-strong');
  const cmpDelta = h('span');
  const topNum = h('span', 'ro-strong');
  const laptime = h('div', 'ro ro--weight ro--laptime', [
    h('span', 'micro ro-label', ['Lap time', h('span', { class: 'ro-est', text: 'est.' })]),
    h('span', 'ro-value', [timeNum, h('span', { class: 'ro-unit', text: 's' })]),
    h('span', 'ro-sub ro-cmp', [cmpName, ' ', cmpTime, ' ', cmpDelta]),
    h('span', 'ro-sub ro-top', ['Top speed ', topNum, ' km/h']),
  ]);
  const setTime = textSlot(timeNum);
  const setCmpName = textSlot(cmpName);
  const setCmpTime = textSlot(cmpTime);
  const setCmpDelta = textSlot(cmpDelta);
  const setTop = textSlot(topNum);

  const el = h('section', { class: 'zone zone-read zone-read--energy', attrs: { 'aria-label': 'Battery, motor and energy this lap' } }, [
    h('h2', 'micro zone-title', [h('span', { class: 'idx', text: 'B' }), 'Energy']),
    h('div', 'ro-grid ro-grid--energy', [batt, motor, harvest, laptime]),
  ]);

  let lap: LapTrace | null = null;
  let split: HarvestSplit | null = null;
  let lastDir: Dir | null = null;
  const setBattUnit = textSlot(battUnit);

  return {
    el,
    render(v) {
      const L = v.lap;
      if (L !== lap) {
        lap = L;
        split = harvestSplit(L);
        setBattUnit(`of ${fmtLimit(L.windowMJ)} MJ`);
        const scale = L.harvestCapMJ * HARVEST_SCALE;
        setRecGhost(Math.min(1, L.harvestedMJ / scale).toFixed(4));
        setUsedGhost(Math.min(1, L.deployedMJ / scale).toFixed(4));
        recTrack.style.setProperty('--cap', `${((L.harvestCapMJ / scale) * 100).toFixed(2)}%`);
        // The comparison: the same car with super clipping the other way round.
        const other = L.clipping ? L.noClipLapTimeS : clippingLapTime(L);
        const delta = other - L.lapTimeS;
        setTime(fmtS(L.lapTimeS));
        setCmpName(L.clipping ? 'Without super clipping' : 'With super clipping');
        setCmpTime(`${fmtS(other)} s`);
        setCmpDelta(`(${delta >= 0 ? '+' : MINUS}${fmtS(Math.abs(delta))} s)`);
        setTop(fmtKmh(L.topSpeedKmh));
      }

      // Battery: lit segments up to the charge, the last one partly.
      const frac = Math.min(1, Math.max(0, v.socMJ / L.windowMJ)) * SEGMENTS;
      setBattNum(fmtMJ(v.socMJ));
      for (let i = 0; i < SEGMENTS; i++) setSegs[i](Math.min(1, Math.max(0, frac - i)).toFixed(3));

      const kw = v.mguKKw;
      const dir: Dir = kw > IDLE_KW ? 'deploy' : kw < -IDLE_KW ? 'harvest' : 'idle';
      if (dir !== lastDir) {
        lastDir = dir;
        motor.dataset.dir = dir;
        setMotorDir(DIR_TEXT[dir]);
      }
      setMotorNum(fmtSignedKw(kw));
      const max = REGS.mguKMaxKw.value;
      setFlowL((Math.min(1, Math.max(0, -kw / max)) * 0.5).toFixed(4));
      setFlowR((Math.min(1, Math.max(0, kw / max)) * 0.5).toFixed(4));
      setEngine(fmtKW(v.engineKw * 1000));
      setEngineW(Math.min(1, Math.max(0, v.engineKw / ESTIMATES.iceKw)).toFixed(4));

      const scale = L.harvestCapMJ * HARVEST_SCALE;
      const rec = Math.max(0, v.harvestedMJ);
      const clipShare = split ? split.clipShareAt(v.tS) : 0;
      const recW = Math.min(1, rec / scale);
      setRecB((recW * (1 - clipShare)).toFixed(4));
      setRecC0((recW * (1 - clipShare)).toFixed(4));
      setRecC((recW * clipShare).toFixed(4));
      setRec(fmtMJ(rec));
      setUsed(fmtMJ(v.deployedMJ));
      setUsedW(Math.min(1, Math.max(0, v.deployedMJ) / scale).toFixed(4));
    },
  };
}
