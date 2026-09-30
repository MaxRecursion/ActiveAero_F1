/**
 * Station 4, zone B — what the stop does to the car, most important first: how hard it slows (g),
 * where the braking power goes (battery, capped, versus heat in the discs), how the weight moves
 * onto the front axle, how hot the discs get against their working window, and where the energy of
 * the whole stop ends up.
 *
 * Every bar runs on a fixed scale for the zone (or for every zone), so a bar that grows or shrinks
 * is a real change. Like the other stations' readouts these are not aria-live; the caption carries
 * the spoken summary.
 */
import { REGS } from '../physics/constants';
import type { BrakeState, BrakeTrace, Station4View } from './types';
import { h, styleSlot, textSlot } from './dom';
import { fmtC, fmtG, fmtKilowatts, fmtKmh, fmtKN, fmtMetres, fmtMJ2, fmtMm, fmtPct, fmtS } from './format';
import { AXLE_MAX_N, cssShare, DISC_MAX_C, ledgerShares, share, stateWord } from './brakeMath';

export interface BrakeReadouts {
  el: HTMLElement;
  render(view: Station4View): void;
}

const bar = (kids: HTMLElement[], cls = '') => h('span', { class: `rb-track ${cls}`, attrs: { 'aria-hidden': 'true' } }, kids);
const row = (name: string, track: HTMLElement, num: HTMLElement) =>
  h('div', 'rb-row', [h('span', { class: 'rb-name', text: name }), track, h('span', 'rb-num', [num])]);
const title = (text: string, aside?: Node | string) => h('span', 'micro brake-title', aside === undefined ? [h('span', { text })] : [h('span', { text }), h('span', 'brake-aside', [aside])]);
const key = (swatch: string, name: string, ...rest: (Node | string)[]) =>
  h('span', 'rb-key', [h('i', { class: `rb-swatch ${swatch}`, attrs: { 'aria-hidden': 'true' } }), name, ...rest]);
const unit = (text: string) => h('span', { class: 'meter-unit', text });

export function createBrakeReadouts(): BrakeReadouts {
  // ── how hard: g now, speed now ──────────────────────────────────────────────
  const gNum = h('span', 'ro-num');
  const kmhNum = h('span', 'rb-kmh');
  const state = h('span', 'brake-state');
  const peakLine = h('span', 'ro-sub ro-strong');
  const routeLine = h('span', 'ro-sub ro-route');
  const hero = h('div', 'ro ro--hero', [
    h('span', 'micro ro-label', ['Braking', h('span', 'ro-label-aside', [state])]),
    h('span', 'ro-value', [gNum, h('span', { class: 'ro-unit', text: 'g' }), h('span', 'rb-speed', [kmhNum, unit(' km/h')])]),
    peakLine,
    routeLine,
  ]);
  const setG = textSlot(gNum);
  const setKmh = textSlot(kmhNum);
  const setState = textSlot(state);
  const setPeak = textSlot(peakLine);
  const setRoute = textSlot(routeLine);

  // ── where the braking power goes ────────────────────────────────────────────
  const total = h('span');
  const toBattery = h('span', 'rb-fill rb-fill--battery');
  const toHeat = h('span', 'rb-fill rb-fill--heat');
  const capMark = h('span', 'rb-cap');
  const batteryNum = h('span', 'rb-strong');
  const heatNum = h('span', 'rb-strong');
  const power = h('div', 'brake-block brake-power', [
    title('Where the braking power goes'),
    h('div', 'rb-total-row', [bar([toBattery, toHeat, capMark], 'rb-track--power'), h('span', 'rb-num rb-total', [total, unit(' kW')])]),
    h('span', 'rb-keys', [key('rb-swatch--battery', 'To battery ', batteryNum, unit(' kW')), key('rb-swatch--heat', 'Disc heat ', heatNum, unit(' kW'))]),
    h('span', 'ro-sub rb-note', [h('i', { class: 'rb-cap-key', attrs: { 'aria-hidden': 'true' } }), ` Battery limit ${REGS.mguKMaxKw.value} kW, rear axle only`]),
  ]);
  const setTotal = textSlot(total);
  const setBatteryNum = textSlot(batteryNum);
  const setHeatNum = textSlot(heatNum);
  const setBatteryW = styleSlot(toBattery, '--w');
  const setHeatX = styleSlot(toHeat, '--x');
  const setHeatW = styleSlot(toHeat, '--w');
  const setCap = styleSlot(capMark, '--x');

  // ── the axles: load now against the load with no braking ────────────────────
  const axle = (name: string) => {
    const fill = h('span', 'rb-fill rb-fill--load');
    const move = h('span', 'rb-move');
    const tick = h('span', 'rb-tick');
    const num = h('span');
    const setNum = textSlot(num);
    const setFill = styleSlot(fill, '--w');
    const setMoveX = styleSlot(move, '--x');
    const setMoveW = styleSlot(move, '--w');
    const setTick = styleSlot(tick, '--x');
    return {
      el: row(name, bar([fill, move, tick]), num),
      set(nowN: number, staticN: number) {
        const now = share(nowN, AXLE_MAX_N);
        const st = share(staticN, AXLE_MAX_N);
        setNum(fmtKN(nowN));
        setFill(now.toFixed(4));
        setMoveX(Math.min(now, st).toFixed(4));
        setMoveW(Math.abs(now - st).toFixed(4));
        setTick(st.toFixed(4));
      },
    };
  };
  const front = axle('Front');
  const rear = axle('Rear');
  const biasNum = h('span', 'rb-strong');
  const transferNum = h('span', 'rb-strong');
  const noseNum = h('span', 'rb-strong');
  const noseScale = h('span');
  const axles = h('div', 'brake-block brake-axles', [
    title('Load on each axle', unit('kN')),
    front.el,
    rear.el,
    h('span', { class: 'rb-keys rb-keys--axle', attrs: { 'aria-hidden': 'true' } }, [key('rb-swatch--tick', 'Load with no braking'), key('rb-swatch--move', 'Weight moved')]),
    h('span', 'ro-sub rb-facts', [
      h('span', 'rb-fact', ['Weight moved forward ', transferNum, unit(' kN')]),
      h('span', 'rb-fact', ['Ideal front brake bias ', biasNum, unit(' %')]),
      h('span', 'rb-fact', ['Nose dips ', noseNum, unit(' mm'), noseScale]),
    ]),
  ]);
  const setTransfer = textSlot(transferNum);
  const setBias = textSlot(biasNum);
  const setNose = textSlot(noseNum);
  const setNoseScale = textSlot(noseScale);

  // ── the discs against their working window ───────────────────────────────────
  const disc = (name: string) => {
    const win = h('span', 'rb-window');
    const fill = h('span', 'rb-fill rb-fill--disc');
    const peak = h('span', 'rb-tick rb-tick--peak');
    const num = h('span');
    const setNum = textSlot(num);
    const setFill = styleSlot(fill, '--w');
    const setPeak = styleSlot(peak, '--x');
    const setWinX = styleSlot(win, '--x');
    const setWinW = styleSlot(win, '--w');
    return {
      el: row(name, bar([win, fill, peak]), num),
      setZone(peakC: number, zone: BrakeTrace) {
        setPeak(cssShare(peakC, DISC_MAX_C));
        setWinX(cssShare(zone.discWindowC.min, DISC_MAX_C));
        setWinW(cssShare(zone.discWindowC.max - zone.discWindowC.min, DISC_MAX_C));
      },
      set(c: number) {
        setNum(fmtC(c));
        setFill(cssShare(c, DISC_MAX_C));
      },
    };
  };
  const frontDisc = disc('Front');
  const rearDisc = disc('Rear');
  const windowText = h('span');
  const peakText = h('span');
  const discs = h('div', 'brake-block brake-discs', [
    title('Disc temperature', unit('°C')),
    frontDisc.el,
    rearDisc.el,
    h('span', { class: 'rb-keys', attrs: { 'aria-hidden': 'true' } }, [
      key('rb-swatch--window', 'Working window ', windowText, unit(' \u00b0C')),
      key('rb-swatch--peak', 'Peak ', peakText, unit(' \u00b0C')),
    ]),
  ]);
  const setWindowText = textSlot(windowText);
  const setPeakText = textSlot(peakText);

  // ── where the stop's energy goes ─────────────────────────────────────────────
  const ledgerTotal = h('span');
  const ledgerDrag = h('span', 'rb-ghost rb-ghost--drag');
  const ledgerBattery = h('span', 'rb-ghost rb-ghost--battery');
  const ledgerHeat = h('span', 'rb-ghost rb-ghost--heat');
  const runBattery = h('span', 'rb-fill rb-fill--battery');
  const runHeat = h('span', 'rb-fill rb-fill--heat');
  const dragNum = h('span', 'rb-strong');
  const batteryMJ = h('span', 'rb-strong');
  const batteryOf = h('span', 'rb-of');
  const heatMJ = h('span', 'rb-strong');
  const heatOf = h('span', 'rb-of');
  const ledger = h('div', 'brake-block brake-ledger', [
    title('Where the stop’s energy goes', h('span', {}, [ledgerTotal, unit(' MJ')])),
    bar([ledgerDrag, ledgerBattery, ledgerHeat, runBattery, runHeat], 'rb-track--ledger'),
    h('span', 'rb-keys', [
      key('rb-swatch--drag', 'Air drag ', dragNum),
      key('rb-swatch--battery', 'Battery ', batteryMJ, batteryOf),
      key('rb-swatch--heat', 'Disc heat ', heatMJ, heatOf),
      unit(' MJ'),
    ]),
  ]);
  const setLedgerTotal = textSlot(ledgerTotal);
  const setDragNum = textSlot(dragNum);
  const setBatteryMJ = textSlot(batteryMJ);
  const setBatteryOf = textSlot(batteryOf);
  const setHeatMJ = textSlot(heatMJ);
  const setHeatOf = textSlot(heatOf);
  const seg = (el: HTMLElement) => ({ x: styleSlot(el, '--x'), w: styleSlot(el, '--w') });
  const segDrag = seg(ledgerDrag);
  const segBattery = seg(ledgerBattery);
  const segHeat = seg(ledgerHeat);
  const setRunBatteryX = styleSlot(runBattery, '--x');
  const setRunBatteryW = styleSlot(runBattery, '--w');
  const setRunHeatX = styleSlot(runHeat, '--x');
  const setRunHeatW = styleSlot(runHeat, '--w');

  const el = h('section', { class: 'zone zone-read zone-read--brake', attrs: { 'aria-label': 'What the stop does to the car' } }, [
    h('h2', 'micro zone-title', [h('span', { class: 'idx', text: 'B' }), 'Braking']),
    h('div', 'ro-grid ro-grid--brake', [hero, power, axles, discs, ledger]),
  ]);

  let zone: BrakeTrace | null = null;
  let powerMax = 1;
  let dragShare = 0;
  let batteryShare = 0;
  let kinetic = 1;
  let lastState: BrakeState | null = null;

  function newZone(z: BrakeTrace) {
    zone = z;
    powerMax = z.points.reduce((m, p) => Math.max(m, p.brakeKw), 1);
    const sh = ledgerShares(z);
    dragShare = sh.drag;
    batteryShare = sh.harvest;
    kinetic = z.kineticMJ || 1;
    setPeak(`Peak ${fmtG(z.peakDecelG)} g`);
    setRoute(`${fmtKmh(z.fromKmh)} → ${fmtKmh(z.toKmh)} km/h · ${fmtS(z.timeS)} s · ${fmtMetres(z.distanceM)} m`);
    setCap(cssShare(REGS.mguKMaxKw.value, powerMax));
    frontDisc.setZone(z.peakFrontDiscC, z);
    rearDisc.setZone(z.peakRearDiscC, z);
    setWindowText(`${fmtC(z.discWindowC.min)}–${fmtC(z.discWindowC.max)}`);
    setPeakText(`${fmtC(z.peakFrontDiscC)} front · ${fmtC(z.peakRearDiscC)} rear`);
    setLedgerTotal(fmtMJ2(z.kineticMJ));
    setDragNum(fmtMJ2(z.dragMJ));
    setBatteryOf(` / ${fmtMJ2(z.harvestMJ)}`);
    setHeatOf(` / ${fmtMJ2(z.heatMJ)}`);
    segDrag.x('0');
    segDrag.w(sh.drag.toFixed(4));
    segBattery.x(sh.drag.toFixed(4));
    segBattery.w(sh.harvest.toFixed(4));
    segHeat.x((sh.drag + sh.harvest).toFixed(4));
    segHeat.w(sh.heat.toFixed(4));
    setRunBatteryX(sh.drag.toFixed(4));
    setRunHeatX((sh.drag + sh.harvest).toFixed(4));
  }

  return {
    el,
    render(v) {
      if (v.zone !== zone) newZone(v.zone);
      setState(stateWord(v.state, v.playing));
      if (v.state !== lastState) {
        lastState = v.state;
        el.dataset.state = v.state;
      }
      setG(fmtG(v.decelG));
      setKmh(fmtKmh(v.kmh));

      setTotal(fmtKilowatts(v.brakeKw));
      setBatteryNum(fmtKilowatts(v.harvestKw));
      setHeatNum(fmtKilowatts(v.heatKw));
      setBatteryW(cssShare(v.harvestKw, powerMax));
      setHeatX(cssShare(v.harvestKw, powerMax));
      setHeatW(cssShare(v.heatKw, powerMax));

      front.set(v.frontLoadN, v.frontStaticN);
      rear.set(v.rearLoadN, v.rearStaticN);
      setTransfer(fmtKN(v.transferN));
      setBias(fmtPct(v.frontBiasPct));
      setNose(fmtMm(v.noseDropMm));
      setNoseScale(` (shown ${fmtKmh(v.diveExaggeration)}× larger)`);
      frontDisc.set(v.frontDiscC);
      rearDisc.set(v.rearDiscC);

      setBatteryMJ(fmtMJ2(v.harvestedMJ));
      setHeatMJ(fmtMJ2(v.heatMJ));
      setRunBatteryW(Math.min(batteryShare, share(v.harvestedMJ, kinetic)).toFixed(4));
      setRunHeatW(Math.min(1 - dragShare - batteryShare, share(v.heatMJ, kinetic)).toFixed(4));
    },
  };
}
