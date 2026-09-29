/**
 * "How it works" — a native modal <dialog> laid out as the model's spec sheet, one group of
 * sections per station, then sources and keys.
 * Every number is read from src/physics so the page can never disagree with the simulation,
 * and estimates are badged so they are never mistaken for published facts.
 */
import { ESTIMATES, PHYS, REGS, SOURCES } from '../physics/constants';
import { ceilingSpeedKmh } from '../physics/aero';
import { BRAKE_RESERVE_J, CLIP_SECONDS_PER_LAP, simulateLap } from '../physics/lap';
import { motorTaper, topSpeedKmh, type MotorTaper } from '../physics/powertrain';
import { CIRCUIT_NAME } from '../physics/track';
import { SLOW_MOTION_FACTOR } from '../scene/motion';
import type { StationId, StationMeta } from './types';
import { h } from './dom';
import { fmtKmh, fmtKmhAtLeast, fmtLimit, fmtMJ, fmtS } from './format';
import { icon } from './icons';

export interface AboutDialog {
  el: HTMLDialogElement;
  readonly isOpen: boolean;
  /** Open at the given station's group (the top for the first station). */
  open(station: StationId | null): void;
  close(): void;
  dispose(): void;
}

const DISCLAIMER =
  'UNSEEN is an independent fan project. It is unofficial and is not associated in any way with the Formula 1 companies. ' +
  'F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are trade marks of ' +
  "Formula One Licensing B.V. No team's car is depicted; the model is generic, built from the published 2026 dimensions.";

type Kind = 'estimate' | 'reg' | 'phys' | 'result';

function section(n: string, title: string, body: Node[]): HTMLElement {
  return h('section', 'about-sec', [
    h('h3', 'about-h', [h('span', { class: 'idx', text: n }), title]),
    ...body,
  ]);
}

const p = (text: string, cls = '') => h('p', { class: cls, text });

/** A run of text with coloured key words, e.g. "blue arrows" in the downforce colour. */
function para(parts: (string | [string, string])[]): HTMLElement {
  return h('p', {}, parts.map((x) => (typeof x === 'string' ? x : h('span', { class: `tone-${x[0]}`, text: x[1] }))));
}

function tag(kind: Kind, text: string): HTMLElement {
  return h('span', { class: `src-tag src-tag--${kind}`, text });
}

const formula = (lhs: string, rhs: string, note: string) =>
  h('div', 'formula-row', [h('span', { class: 'formula', text: `${lhs} = ${rhs}` }), h('span', { class: 'formula-note', text: note })]);

const row = (quantity: string, value: string, source: HTMLElement) =>
  h('tr', {}, [h('th', { text: quantity, attrs: { scope: 'row' } }), h('td', { class: 'num', text: value }), h('td', {}, [source])]);

function assumptionsTable(rows: HTMLElement[]): HTMLElement {
  return h('div', 'table-wrap', [
    h('table', 'assumptions', [
      h('thead', {}, [
        h('tr', {}, [
          h('th', { text: 'Quantity', attrs: { scope: 'col' } }),
          h('th', { text: 'Value', attrs: { scope: 'col' } }),
          h('th', { text: 'Source', attrs: { scope: 'col' } }),
        ]),
      ]),
      h('tbody', {}, rows),
    ]),
  ]);
}

const list = (items: string[]) => h('ul', 'about-list', items.map((text) => h('li', { text })));
const pct = (x: number) => Math.round(x * 100);

/** Station 1 — force from speed. */
function downforceSections(): HTMLElement[] {
  const ceiling = fmtKmhAtLeast(ceilingSpeedKmh());
  const split = ESTIMATES.surfaces.map((s) => pct(s.share)).join(' / ');
  return [
    section('01', "What you're seeing", [
      p('A generic 2026 grand-prix car stands on a wind-tunnel rolling road. The belt and the air move at the speed you choose, as they would past a car on track.'),
      para([
        ['down', 'Blue arrows'],
        ' are downforce — the air pressing the car into the road — on the front wing, the floor and the rear wing. The ',
        ['drag', 'orange arrow'],
        ' is drag, the air holding the car back. The ',
        ['weight', 'graphite arrow'],
        ' is the car’s weight. All arrows share one scale, so their lengths compare honestly.',
      ]),
      p(`Exploded lifts the bodywork away so you can see the floor, which makes about half of the downforce. Ceiling test turns the car upside down: from ${ceiling} km/h up the downforce is larger than the weight, so in principle it would stay up.`),
    ]),
    section('02', 'The model', [
      h('div', 'formulas', [
        formula('q', '½ ρ v²', 'dynamic pressure of the oncoming air'),
        formula('L', 'q · ClA', 'downforce'),
        formula('D', 'q · CdA', 'drag'),
        formula('P', 'D · v', 'power spent pushing through the air'),
        formula('v', '√(2mg / (ρ · ClA))', `ceiling speed, where downforce equals weight: ≈ ${ceiling} km/h`),
      ]),
      p('Double the speed and the force is four times larger; the power to overcome drag is eight times larger.'),
    ]),
    section('03', 'Assumptions', [
      p('Teams do not publish their aerodynamic numbers. Values marked estimate are calibrated guesses; regulation values come from the FIA 2026 Technical Regulations.'),
      assumptionsTable([
        row('Downforce area, ClA (corner mode)', `${ESTIMATES.clA} m²`, tag('estimate', 'Estimate')),
        row('Drag area, CdA (corner mode)', `${ESTIMATES.cdA} m²`, tag('estimate', 'Estimate')),
        row('Minimum mass, with driver', `${REGS.minMassKg.value} kg`, tag('reg', `Reg ${REGS.minMassKg.ref}`)),
        row('Air density, ρ (sea level, 15 °C)', `${PHYS.rho} kg/m³`, tag('phys', 'ISA standard')),
        row('Downforce split: front wing / floor / rear wing', `${split} %`, tag('estimate', 'Estimate')),
        row('Centre-of-gravity height', `${ESTIMATES.cgHeightM} m`, tag('estimate', 'Estimate')),
      ]),
    ]),
    section('04', 'What is simplified', [
      list([
        `Airflow lines are illustrative, not CFD. Motion is shown ≈${Math.round(SLOW_MOTION_FACTOR)}× slower than real.`,
        '2026 cars make about 30% less downforce than 2022–25 cars.',
        'Coefficients are held constant; on a real car they change with ride height, yaw and wing mode.',
      ]),
    ]),
  ];
}

const lineText = (l: { intercept: number; slope: number }) => `${l.intercept} − ${l.slope}v kW`;

const taperRows = (t: MotorTaper) => {
  const src = () => tag('reg', `Reg ${REGS.mguKTaper.ref}`);
  return [
    row(`Motor limit, ${t.start}–${t.knee}\u00a0km/h`, lineText(t.first), src()),
    row(`Motor limit, ${t.knee}–${t.zero}\u00a0km/h`, lineText(t.second), src()),
    row(`Motor limit above ${t.zero}\u00a0km/h`, '0 kW', src()),
  ];
};

/** Station 2 — active aero and top speed. */
function activeAeroSections(): HTMLElement[] {
  const top = { corner: topSpeedKmh(0), straight: topSpeedKmh(1) };
  const taper = motorTaper();
  const { clAFactor, cdAFactor } = ESTIMATES.straightMode;
  const cutDown = 100 - pct(clAFactor);
  const cutDrag = 100 - pct(cdAFactor);
  // Printed as the difference of the printed numbers, like the readouts, so it always adds up.
  const gain = Math.round(top.straight) - Math.round(top.corner);
  const ms = REGS.activeAeroSwitchMs;
  return [
    section('05', "What you're seeing", [
      p(`In 2026 the front-wing flaps and the rear-wing flap move. In Corner Mode they are closed for maximum downforce. In Straight Mode they open: in this model about ${cutDown}% less downforce and ${cutDrag}% less drag.`),
      para([
        'The chart compares two kinds of power. The ',
        ['weight', 'graphite line'],
        ' is the power that reaches the tyres. The ',
        ['drag', 'orange lines'],
        ' are the power the air and the road take to hold each speed — solid in Corner Mode, dashed in Straight Mode. Where they cross, every kilowatt is spent: that is the top speed.',
      ]),
      p(`Above ${taper.start} km/h the rules turn the electric motor down while the power the air takes keeps growing with speed³, so saved drag is worth a lot: about ${fmtKmh(top.corner)} km/h in Corner Mode against ${fmtKmh(top.straight)} km/h in Straight Mode (+${gain} km/h).`),
    ]),
    section('06', 'The model', [
      h('div', 'formulas formulas--stacked', [
        formula('P_avail', 'η · (P_ICE + P_K(v))', 'power reaching the tyres'),
        formula('P_need', '(½ρ·CdA·v² + C_rr·(m·g + ½ρ·ClA·v²)) · v', 'drag, plus rolling resistance on weight and downforce'),
        formula('P_K(v)', lineText(taper.first), `electric motor limit from ${taper.start} to ${taper.knee} km/h, v in km/h: ${taper.max} kW below ${taper.start} (FIA ${REGS.mguKTaper.ref})`),
        formula('P_K(v)', lineText(taper.second), `from ${taper.knee} to ${taper.zero} km/h; zero above ${taper.zero} km/h`),
        formula('v_top', 'where P_avail = P_need', `≈ ${fmtKmh(top.corner)} km/h in Corner Mode, ${fmtKmh(top.straight)} km/h in Straight Mode`),
      ]),
      p('Straight Mode lowers CdA and ClA together, and the flaps move over a fraction of a second, so the numbers blend between the two modes as the flaps travel.'),
    ]),
    section('07', 'Assumptions', [
      p('The power unit and Straight Mode numbers are model estimates; the motor limits and the switching time are regulations.'),
      assumptionsTable([
        row('Combustion engine power, P_ICE', `${ESTIMATES.iceKw} kW`, tag('estimate', 'Estimate')),
        row('Driveline efficiency, η', String(ESTIMATES.drivelineEfficiency), tag('estimate', 'Estimate')),
        row('Rolling resistance, C_rr', String(ESTIMATES.rollingResistance), tag('estimate', 'Estimate')),
        row('Straight Mode downforce, vs Corner Mode (Raceteq / Bramble CFD)', `−${cutDown} %`, tag('estimate', 'Estimate')),
        row('Straight Mode drag, vs Corner Mode (Raceteq / Bramble CFD)', `−${cutDrag} %`, tag('estimate', 'Estimate')),
        row('Electric motor (MGU-K) maximum', `${REGS.mguKMaxKw.value} kW`, tag('reg', `Reg ${REGS.mguKMaxKw.ref}`)),
        ...taperRows(taper),
        row('Corner ↔ Straight transition', `≤ ${ms.value} ms`, tag('reg', `Reg ${ms.ref}`)),
      ]),
    ]),
    section('08', 'The rules', [
      list([
        'DRS no longer exists. It opened one rear-wing flap, and only for a car within a second of the one ahead.',
        'Straight Mode is available to every driver, not just the one chasing: the wings may open inside the FIA’s marked Activation Zones.',
        `The switch takes at most ${ms.value} ms, and any failure returns the wings to Corner Mode.`,
        'Top speeds here are steady-state with the battery deploying at its limit; on track a long straight can drain it first.',
      ]),
    ]),
  ];
}

/** A list item with a source link at its end. */
const sourced = (text: string, src: { label: string; url: string }) =>
  h('li', {}, [`${text} `, h('a', { class: 'about-cite', text: src.label, attrs: { href: src.url, target: '_blank', rel: 'noopener' } })]);

/**
 * Station 3 — energy over a lap. Its figures come from running the lap simulation (on and off
 * super clipping), so this group is built the first time the dialog opens, not at start-up.
 */
function energySections(): HTMLElement[] {
  const on = simulateLap({ clipping: true });
  const off = simulateLap({ clipping: false });
  const n = on.samples.length;
  let clipS = 0;
  for (let i = 0; i < n; i++) {
    if (on.samples[i].phase !== 'clip') continue;
    clipS += (i + 1 < n ? on.samples[i + 1].t : on.lapTimeS) - on.samples[i].t;
  }
  const peakSoc = on.samples.reduce((m, x) => Math.max(m, x.socMJ), 0);
  const km = (on.track.length / 1000).toFixed(2);
  const motor = REGS.mguKMaxKw;
  const store = REGS.energyStoreWindowMJ;
  const cap = REGS.harvestPerLapMJ;
  const taper = motorTaper();
  const gain = off.lapTimeS - on.lapTimeS;
  return [
    section('09', "What you're seeing", [
      p(`A simulated lap of ${CIRCUIT_NAME}, ${km} km, plays on the rolling road: the belt runs at the car's speed at each point of the lap. The timeline under the car is the whole lap — drag it, or click the map, to move the car.`),
      para([
        'X-ray makes the bodywork see-through so the power unit shows. Particles follow the energy: ',
        ['engine', 'slate'],
        ' from the engine to the rear wheels, ',
        ['energy', 'green'],
        ' between the battery, the motor-generator and the wheels — out of the battery when the motor deploys, back in when the car brakes, and from the engine into the battery while super clipping.',
      ]),
      p(`In 2026 the electric motor gives or takes up to ${motor.value} kW (FIA ${motor.ref}), close to half the car's power. But the battery may swing only ${fmtLimit(store.value)} MJ (${store.ref}) and recover at most ${fmtLimit(cap.value)} MJ a lap (${cap.ref}), so the energy has to be managed corner by corner. Broadcasts stopped showing the battery; this station makes it visible.`),
    ]),
    section('10', 'The model', [
      p('A point-mass lap simulation, sampled every couple of metres round the lap:'),
      h('div', 'formulas formulas--stacked', [
        formula('m·v²/r', 'μ_lat · (m·g + ½ρ·ClA·v²)', 'corner limit: grip grows with downforce, so fast corners can be taken faster'),
        formula('a_brake', '(μ_long · (m·g + L) + D) / m', 'braking envelope, worked backwards from every corner'),
        formula('F', 'min(η·(P_ICE + P_K)/v, traction) − D − rolling', 'full throttle, limited by power or by the rear tyres'),
      ]),
      list([
        `Braking: the motor-generator harvests up to ${motor.value} kW; the brakes turn the rest into heat.`,
        `Deploying: on full throttle the motor adds power up to its regulated limit, which fades above ${taper.start} km/h (${REGS.mguKTaper.ref}) — but only where the engine alone can't already spin the rear tyres, because power into wheelspin is wasted.`,
        `Super clipping: near the end of the long straights the motor harvests at full throttle, topping up what braking alone recovers — about ${fmtS(clipS)} s on this lap at up to ${motor.value} kW, allowed only while at least ${fmtMJ(BRAKE_RESERVE_J / 1e6)} MJ of room remains in the battery, so the next braking zone can still charge it.`,
        `The battery's charge never swings more than ${fmtLimit(store.value)} MJ, and no more than ${fmtLimit(cap.value)} MJ is recovered in a lap.`,
        'Laps are repeated until the charge at the line settles, so the lap shown is one the car could drive again and again.',
      ]),
      p(`Result: ${fmtS(on.lapTimeS)} s with super clipping, ${fmtS(off.lapTimeS)} s without — super clipping ${gain >= 0 ? 'is worth' : 'costs'} ${fmtS(Math.abs(gain))} s a lap here. Braking recovers ${fmtMJ(on.brakeHarvestMJ)} MJ; super clipping adds ${fmtMJ(on.clipHarvestMJ)} MJ.`),
    ]),
    section('11', 'Assumptions', [
      p('Grip and the energy strategy are model estimates; the energy limits are regulations.'),
      assumptionsTable([
        row('Tyre grip, cornering, μ_lat', String(ESTIMATES.gripLateral), tag('estimate', 'Estimate')),
        row('Tyre grip, braking and traction, μ_long', String(ESTIMATES.gripLongitudinal), tag('estimate', 'Estimate')),
        row('Share of weight and downforce on the driven rear axle', String(ESTIMATES.rearAxleShare), tag('estimate', 'Estimate')),
        row('Combustion engine power, P_ICE', `${ESTIMATES.iceKw} kW`, tag('estimate', 'Estimate')),
        row('Super clipping aimed for per lap (reports: 2–4 s)', `${CLIP_SECONDS_PER_LAP} s`, tag('estimate', 'Estimate')),
        row('Super clipping this lap', `≈ ${fmtS(clipS)} s`, tag('result', 'Model result')),
        row('Least battery room allowed while clipping', `${fmtMJ(BRAKE_RESERVE_J / 1e6)} MJ`, tag('estimate', 'Estimate')),
        row('Peak battery charge this lap', `${fmtMJ(peakSoc)} of ${fmtLimit(store.value)} MJ`, tag('result', 'Model result')),
        row('Electric motor (MGU-K) maximum, deploy or harvest', `${motor.value} kW`, tag('reg', `Reg ${motor.ref}`)),
        ...taperRows(taper),
        row('Battery window (highest minus lowest charge)', `${fmtLimit(store.value)} MJ`, tag('reg', `Reg ${store.ref}`)),
        row('Energy recovered per lap, at most', `${fmtLimit(cap.value)} MJ`, tag('reg', `Reg ${cap.ref}`)),
      ]),
    ]),
    section('12', 'The rules', [
      h('ul', 'about-list', [
        sourced(`Super clipping — harvesting while the driver stays flat out — is allowed at up to ${motor.value} kW from the 2026 Miami Grand Prix.`, SOURCES.raceteqEnergy),
        h('li', { text: 'The circuit is fictional; real teams’ energy strategies are far more sophisticated — this is an illustrative model.' }),
        h('li', { text: 'No tyre wear, fuel burn, wind, traffic or gear shifts; the car is a point on an ideal racing line.' }),
      ]),
    ]),
  ];
}

export function createAbout(stations: StationMeta[]): AboutDialog {
  const bodies: Record<StationId, () => HTMLElement[]> = { downforce: downforceSections, activeAero: activeAeroSections, energy: energySections };
  /** Groups whose content is expensive (it runs a simulation) are filled on first open. */
  const LAZY = new Set<StationId>(['energy']);
  const groups = new Map<StationId, HTMLElement>();
  const pending = new Map<StationId, HTMLElement>();
  const groupEls = stations.map((m) => {
    const g = h('div', 'about-group', [
      h('h3', 'about-group-head', [h('span', { class: 'micro', text: `Station ${m.number}` }), h('span', { class: 'about-group-title', text: m.title })]),
      ...(LAZY.has(m.id) ? [] : bodies[m.id]()),
    ]);
    if (LAZY.has(m.id)) pending.set(m.id, g);
    groups.set(m.id, g);
    return g;
  });
  const fillPending = () => {
    for (const [id, g] of pending) g.append(...bodies[id]());
    pending.clear();
  };

  const sources = section('13', 'Sources', [
    h(
      'ul',
      'about-list about-sources',
      Object.values(SOURCES).map((src) => h('li', {}, [h('a', { text: src.label, attrs: { href: src.url, target: '_blank', rel: 'noopener' } })])),
    ),
  ]);

  const key = (keys: string[], what: string) =>
    h('div', 'key-row', [
      h('span', 'keys', keys.flatMap((k, i) => [i ? h('span', { class: 'key-or', text: 'or' }) : null, h('kbd', { text: k })])),
      h('span', { text: what }),
    ]);
  const shortcuts = section('14', 'Keyboard', [
    h('div', 'keys-grid', [
      key(stations.map((_, i) => String(i + 1)), 'Switch station'),
      key(['Space'], 'Play / pause the speed sweep or the lap'),
      key(['←', '→'], 'Change speed (on the slider)'),
      key(['←', '→'], 'Step along the lap, 1 s — Shift: 5 s (on the timeline)'),
      key(['X'], 'X-ray: see through the bodywork (station 03)'),
      key(['S'], 'Super clipping on / off (station 03)'),
      key(['M'], 'Corner / Straight Mode (station 02)'),
      key(['A'], 'Airflow lines on / off'),
      key(['E'], 'Exploded view (station 01)'),
      key(['C'], 'Ceiling test (station 01)'),
      key(['R'], 'Reset the camera'),
      key(['?', 'H'], 'Open this sheet'),
      key(['Esc'], 'Close it'),
    ]),
  ]);

  const kicker = h('span', { class: 'micro', text: 'Spec sheet' });
  const closeBtn = h('button', { class: 'icon-btn about-close', attrs: { type: 'button', 'aria-label': 'Close' } }, [icon('close')]);
  const title = h('h2', { class: 'about-title', text: 'How it works', attrs: { id: 'about-title' } });
  const body = h('div', { class: 'about-body', attrs: { tabindex: '-1', autofocus: '' } }, [
    ...groupEls,
    h('div', 'about-group about-group--shared', [sources, shortcuts]),
    p(DISCLAIMER, 'about-disclaimer'),
  ]);
  const el = h('dialog', { class: 'about', attrs: { 'aria-labelledby': 'about-title' } }, [
    h('header', 'about-head', [h('div', {}, [kicker, title]), closeBtn]),
    body,
  ]);

  let returnFocus: HTMLElement | null = null;
  const onClose = () => {
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  };
  // A click that lands on the <dialog> itself (not its content) is a click on the backdrop.
  const onClick = (e: MouseEvent) => {
    if (e.target === el) el.close();
  };
  const onCloseBtn = () => el.close();
  el.addEventListener('close', onClose);
  el.addEventListener('click', onClick);
  closeBtn.addEventListener('click', onCloseBtn);

  return {
    el,
    get isOpen() {
      return el.open;
    },
    open(station) {
      if (el.open) return;
      const meta = stations.find((m) => m.id === station);
      kicker.textContent = meta ? `Spec sheet · Station ${meta.number} · ${meta.title}` : 'Spec sheet';
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      fillPending();
      el.showModal();
      const group = station && station !== stations[0]?.id ? groups.get(station) : undefined;
      body.scrollTo(0, group ? group.offsetTop - body.offsetTop : 0);
    },
    close() {
      if (el.open) el.close();
    },
    dispose() {
      el.removeEventListener('close', onClose);
      el.removeEventListener('click', onClick);
      closeBtn.removeEventListener('click', onCloseBtn);
      if (el.open) el.close();
    },
  };
}
