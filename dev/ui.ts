/**
 * Dev page for the UI: the real shell over a harness stage with a stand-in clay block.
 * Views are synthesised from the physics, so every readout is live; tabs, the mode switch,
 * the slider and the toggles all work.
 *
 * Query params: ?station=downforce|activeAero|energy  ?speed=0–350  ?mode=corner|straight  ?t=0–1 (flap
 * position; default follows the mode)  ?ceiling=off|sticks|falls  ?about=1 (&aboutScroll=px)  ?graph=1  ?numbers=1  ?tip=1 (focus
 * the first toolbar button to show its tooltip)  (+ harness params)
 * With ?ceiling=sticks|falls the ceiling test starts on and the speed decides the actual state.
 * Station 3 (energy): ?t= seconds into the lap  ?clip=0|1 (super clipping, default 1)  ?playing=0|1 (default 1:
 * the page plays the lap itself)  ?rate=0.5|1|2  ?xray=0|1 (default 1). The lap is built the way the app builds it:
 * every 5th sample of simulateLap() for the map and the trace.
 */
import * as THREE from 'three';
import { createHarness, num, params } from './harness';
import { aeroState } from '../src/physics/aero';
import { ESTIMATES, PHYS, REGS, SPEED_RANGE_KMH } from '../src/physics/constants';
import { sampleAt, simulateLap, type LapPhase, type LapResult } from '../src/physics/lap';
import { availablePowerW, mguKLimitKw, requiredPowerW, topSpeedKmh } from '../src/physics/powertrain';
import { CIRCUIT_NAME } from '../src/physics/track';
import { createUI } from '../src/ui/createUI';
import type {
  AeroMode,
  CaptionRun,
  LapTrace,
  Station1View,
  Station2View,
  Station3View,
  StationId,
  StationUIConfig,
  StationView,
  ToggleId,
} from '../src/ui/types';

const stage = createHarness({ plainFloor: true });

const clay = new THREE.MeshStandardMaterial({ color: 0xd8d4cb, roughness: 0.85 });
const block = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.7, 1.8), clay);
block.position.y = 0.35;
block.castShadow = true;
stage.scene.add(block);

const STATIONS: StationUIConfig[] = [
  {
    meta: { id: 'downforce', number: '01', title: 'Downforce', prompt: 'Drag the speed. Watch the air push down.' },
    presets: [
      { kmh: 0, label: 'Parked' },
      { kmh: 70, label: 'Hairpin' },
      { kmh: 150, label: 'Medium corner' },
      { kmh: 250, label: 'Fast corner' },
      { kmh: 330, label: 'End of straight' },
    ],
    toggles: ['airflow', 'exploded', 'ceiling'],
    conditions: `ISA sea level · ρ ${PHYS.rho} kg/m³ · ${REGS.minMassKg.value} kg · ClA ${ESTIMATES.clA} m² est. · CdA ${ESTIMATES.cdA} m² est.`,
  },
  {
    meta: { id: 'activeAero', number: '02', title: 'Active aero', prompt: 'Open the wings. Watch top speed climb.' },
    presets: [
      { kmh: 180, label: 'Corner exit' },
      { kmh: 260, label: 'Mid-straight' },
      { kmh: 290, label: 'Taper starts' },
      { kmh: 320, label: 'Fast straight' },
      { kmh: 340, label: 'Longest straight' },
    ],
    toggles: ['airflow'],
    conditions: `ISA sea level · ${REGS.minMassKg.value} kg · engine ${ESTIMATES.iceKw} kW est. · motor ≤ ${REGS.mguKMaxKw.value} kW (${REGS.mguKTaper.ref} taper) · η ${ESTIMATES.drivelineEfficiency} est.`,
  },
  {
    meta: { id: 'energy', number: '03', title: 'Energy', prompt: 'Watch a lap. See where the battery fills — and where it runs dry.' },
    control: 'lap',
    presets: [],
    toggles: ['xray', 'clipping', 'airflow'],
    conditions: `${CIRCUIT_NAME} · ${REGS.minMassKg.value} kg · engine ${ESTIMATES.iceKw} kW est. · motor ≤ ${REGS.mguKMaxKw.value} kW · battery window ${REGS.energyStoreWindowMJ.value} MJ · recovery ≤ ${REGS.harvestPerLapMJ.value} MJ/lap · grip μ ${ESTIMATES.gripLateral}/${ESTIMATES.gripLongitudinal} est.`,
  },
];

const toggles: Record<ToggleId, boolean> = {
  airflow: true,
  exploded: false,
  ceiling: params.get('ceiling') !== null && params.get('ceiling') !== 'off',
  xray: params.get('xray') !== '0',
  clipping: params.get('clip') !== '0',
};
const stationParam = params.get('station');
let station: StationId = stationParam === 'activeAero' || stationParam === 'energy' ? stationParam : 'downforce';
let speed = num('speed', 300);
let mode: AeroMode = params.get('mode') === 'straight' ? 'straight' : 'corner';
/** ?t is the flap position on Stations 1–2 and seconds into the lap on Station 3. */
const flapParam = station !== 'energy' && params.has('t');
let straightT = flapParam ? num('t', 0) : mode === 'straight' ? 1 : 0;
let playing = params.has('playing') ? params.get('playing') === '1' : station === 'energy';
let lapT = station === 'energy' ? num('t', 0) : 0;
let lapRate = [0.5, 1, 2].includes(num('rate', 1)) ? num('rate', 1) : 1;
const tops = { corner: topSpeedKmh(0), straight: topSpeedKmh(1) };

/** Band captions in the station's style: short "why" sentences, no live numbers. */
function caption1(s: ReturnType<typeof aeroState>, ceiling: Station1View['ceiling']): CaptionRun[] {
  if (ceiling === 'falls')
    return [{ text: 'Upside down, ' }, { text: 'gravity', tone: 'weight' }, { text: ' is winning: the air isn’t pushing hard enough to hold the car up yet.' }];
  if (ceiling === 'sticks')
    return [{ text: 'The wings and floor now push harder than ' }, { text: 'gravity', tone: 'weight' }, { text: ' pulls. In theory the car could ' }, { text: 'drive on the ceiling', tone: 'strong' }, { text: '.' }];
  if (s.speedKmh < 1) return [{ text: 'Parked, a wing is just a shape. ' }, { text: 'Air has to move', tone: 'strong' }, { text: ' before it can push.' }];
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

const CAPTION_2: CaptionRun[] = [
  { text: 'Flaps open: ' },
  { text: '18% less drag', tone: 'drag' },
  { text: ' for ' },
  { text: '25% less downforce', tone: 'down' },
  { text: '. On a straight, that trade buys about ' },
  { text: '11 km/h', tone: 'strong' },
  { text: '.' },
];

function view1(): Station1View {
  const s = aeroState(speed);
  const ceiling: Station1View['ceiling'] = !toggles.ceiling ? 'off' : s.downforceN > s.weightN ? 'sticks' : 'falls';
  return {
    speedKmh: s.speedKmh,
    downforceN: s.downforceN,
    dragN: s.dragN,
    dragPowerW: s.dragPowerW,
    weightN: s.weightN,
    downforceToWeight: s.downforceToWeight,
    downforceEquivalentKg: s.downforceEquivalentKg,
    ceilingSpeedKmh: s.ceilingSpeedKmh,
    surfaces: s.surfaces,
    caption: caption1(s, ceiling),
    ceiling,
  };
}

function view2(): Station2View {
  const s = aeroState(speed, undefined, straightT);
  const corner = aeroState(speed);
  const need = requiredPowerW(speed, straightT).totalW;
  const has = availablePowerW(speed);
  return {
    speedKmh: speed,
    mode,
    straightT,
    downforceN: s.downforceN,
    cornerDownforceN: corner.downforceN,
    dragN: s.dragN,
    cornerDragN: corner.dragN,
    surfaces: s.surfaces,
    dragPowerW: s.dragPowerW,
    requiredPowerW: need,
    availablePowerW: has,
    mguKLimitKw: mguKLimitKw(speed),
    iceKw: ESTIMATES.iceKw,
    topSpeedCornerKmh: tops.corner,
    topSpeedStraightKmh: tops.straight,
    reachable: has >= need,
    caption: CAPTION_2,
  };
}

// ── Station 3: the lap, built the way the app builds it ─────────────────────────────
const DECIMATE = 5;
const laps = new Map<boolean, { result: LapResult; trace: LapTrace }>();
let noClipLapTimeS: number | null = null;
function lapFor(clipping: boolean) {
  let entry = laps.get(clipping);
  if (!entry) {
    const result = simulateLap({ clipping });
    noClipLapTimeS ??= clipping ? simulateLap({ clipping: false }).lapTimeS : result.lapTimeS;
    const pick = result.samples.filter((_, i) => i % DECIMATE === 0);
    const trace: LapTrace = {
      lengthM: result.track.length,
      lapTimeS: result.lapTimeS,
      map: pick.map((p) => ({ x: p.x, y: p.y })),
      trace: pick.map((p) => ({ s: p.s, t: p.t, kmh: p.kmh, socMJ: p.socMJ, mguKKw: p.mguKKw, phase: p.phase })),
      corners: result.track.corners.map((c) => ({ label: c.label, s: c.s, x: c.x, y: c.y })),
      harvestedMJ: result.harvestedMJ,
      brakeHarvestMJ: result.brakeHarvestMJ,
      clipHarvestMJ: result.clipHarvestMJ,
      deployedMJ: result.deployedMJ,
      topSpeedKmh: result.topSpeedKmh,
      harvestCapMJ: result.harvestCapMJ,
      windowMJ: REGS.energyStoreWindowMJ.value,
      noClipLapTimeS,
      clipping,
    };
    entry = { result, trace };
    laps.set(clipping, entry);
  }
  return entry;
}

/** Sample captions in the station's voice, one per phase. */
const CAPTION_3: Record<LapPhase, CaptionRun[]> = {
  brake: [
    { text: 'Braking: the motor-generator catches up to ' },
    { text: '350 kW', tone: 'energy' },
    { text: ' of the car’s momentum and ' },
    { text: 'stores it', tone: 'energy' },
    { text: '. The brakes turn the rest into heat.' },
  ],
  deploy: [
    { text: 'Full throttle: the battery sends up to ' },
    { text: '350 kW', tone: 'energy' },
    { text: ' through the motor, on top of the ' },
    { text: 'engine', tone: 'engine' },
    { text: '. Watch the charge fall.' },
  ],
  clip: [
    { text: 'Super clipping: still flat out, but the motor-generator takes ' },
    { text: '350 kW', tone: 'energy' },
    { text: ' of the ' },
    { text: 'engine’s', tone: 'engine' },
    { text: ' power to ' },
    { text: 'charge the battery', tone: 'energy' },
    { text: '.' },
  ],
  engine: [
    { text: 'The ' },
    { text: 'engine', tone: 'engine' },
    { text: ' alone is enough here — more power would only spin the tyres — so the battery ' },
    { text: 'keeps its charge', tone: 'energy' },
    { text: '.' },
  ],
  lift: [{ text: 'Mid-corner the tyres are at their limit: ' }, { text: 'no power to add', tone: 'strong' }, { text: ', nothing to harvest.' }],
};

function view3(): Station3View {
  const { result, trace } = lapFor(toggles.clipping);
  const p = sampleAt(result, lapT);
  return {
    lap: trace,
    tS: p.t,
    sM: p.s,
    kmh: p.kmh,
    phase: p.phase,
    mguKKw: p.mguKKw,
    engineKw: p.engineKw,
    socMJ: p.socMJ,
    harvestedMJ: p.harvestedMJ,
    deployedMJ: p.deployedMJ,
    playing,
    rate: lapRate,
    caption: CAPTION_3[p.phase],
  };
}

const view = (): StationView =>
  station === 'downforce' ? { station, view: view1() } : station === 'activeAero' ? { station, view: view2() } : { station, view: view3() };

/** X-ray stand-in: the clay block turns see-through. */
function applyXray() {
  const on = station === 'energy' && toggles.xray;
  clay.transparent = on;
  clay.opacity = on ? 0.35 : 1;
  clay.depthWrite = !on;
}

const ui = createUI({
  root: document.getElementById('ui')!,
  stations: STATIONS,
  initialStation: station,
  minKmh: SPEED_RANGE_KMH.min,
  maxKmh: SPEED_RANGE_KMH.max,
  handlers: {
    onSpeedInput(kmh) {
      speed = kmh;
      playing = false;
      ui.setPlaying(false);
    },
    onToggle(id, on) {
      toggles[id] = on;
      if (id === 'xray') applyXray();
      // Switching super clipping swaps the lap; keep the car at the same share of the lap.
      if (id === 'clipping') {
        const before = lapFor(!on).result.lapTimeS;
        lapT = (lapT / before) * lapFor(on).result.lapTimeS;
      }
    },
    onPlayToggle() {
      playing = !playing;
      ui.setPlaying(playing);
    },
    onResetView() {
      void stage.goTo('hero');
    },
    onStationChange(id) {
      station = id;
      ui.setStation(id);
      applyXray();
    },
    onAeroMode(next) {
      mode = next;
    },
    onLapScrub(tS) {
      lapT = Math.min(Math.max(0, tS), lapFor(toggles.clipping).result.lapTimeS);
    },
    onLapRate(rate) {
      lapRate = rate;
    },
  },
});

for (const id of Object.keys(toggles) as ToggleId[]) ui.setToggle(id, toggles[id]);
ui.setPlaying(playing);
applyXray();
ui.setSpeedControl(speed);
ui.setAeroMode(mode);
const applyInsets = () => stage.setInsets(ui.getInsets());
ui.onLayoutChange(applyInsets);
applyInsets();

/** Flaps travel end to end in the regulated maximum time. */
const FLAP_RATE = 1000 / REGS.activeAeroSwitchMs.value;
let sweepT = 0;
stage.onFrame((dt) => {
  if (playing && station === 'energy') {
    const lapTime = lapFor(toggles.clipping).result.lapTimeS;
    lapT = (lapT + dt * lapRate) % lapTime;
  } else if (playing) {
    sweepT += dt;
    speed = SPEED_RANGE_KMH.max * (0.5 - 0.5 * Math.cos(sweepT * 0.5));
    ui.setSpeedControl(speed);
  }
  const target = mode === 'straight' ? 1 : 0;
  if (!flapParam) straightT += Math.sign(target - straightT) * Math.min(Math.abs(target - straightT), FLAP_RATE * dt);
  ui.render(view());
});

if (params.get('about') === '1') document.querySelector<HTMLButtonElement>('[aria-keyshortcuts="Shift+? H"]')?.click();
// Scroll the open dialog further by N px (to screenshot later sections).
if (params.has('aboutScroll')) document.querySelector('.about-body')?.scrollBy(0, num('aboutScroll', 0));
if (params.get('tip') === '1') document.querySelector<HTMLButtonElement>('.ui-toolbar .icon-btn')?.focus();
if (params.get('graph') === '1') document.querySelector<HTMLButtonElement>('.graph-toggle')?.click();
if (params.get('numbers') === '1') document.querySelector<HTMLButtonElement>('.numbers-toggle')?.click();
