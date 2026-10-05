/**
 * "How it works", Station 06 — the aero map. Every figure is read from src/physics/aeromap.ts (and the
 * estimates in constants.ts), so the page always agrees with the simulation. Built on first open: it
 * solves a few platforms and stability scans.
 */
import {
  AEROMAP,
  DEFAULT_SETUP,
  DIFFUSER_ANGLE_RAD,
  REFERENCE_RIDE,
  RIDE_PRESETS,
  aeroMapAt,
  bodyModes,
  platformAt,
  porpoiseRangeKmh,
} from '../physics/aeromap';
import { ESTIMATES, SOURCES } from '../physics/constants';
import { assumptionsTable, formula, list, p, para, row, section, sourced, tag } from './aboutParts';
import { h } from './dom';
import { fmtKmh, fmtMm } from './format';

const deg = (rad: number) => ((rad * 180) / Math.PI).toFixed(1);
const mmPair = (r: { frontMm: number; rearMm: number }) => `${fmtMm(r.frontMm)} / ${fmtMm(r.rearMm)} mm`;
const one = (x: number) => x.toFixed(1);

export function aeroMapSections(n: (i: number) => string): HTMLElement[] {
  const FW = AEROMAP.frontWing;
  const FL = AEROMAP.floor;
  const B = AEROMAP.bounce;
  const ref = aeroMapAt(REFERENCE_RIDE);
  const at300 = platformAt(300, DEFAULT_SETUP);
  const rest = platformAt(0, DEFAULT_SETUP);
  const low = RIDE_PRESETS.find((r) => r.id === 'low')!;
  const lowRange = porpoiseRangeKmh(low);
  const modes = bodyModes(0, DEFAULT_SETUP);
  const peakGapMm = FL.peakEta * FL.channelHalfWidthM * DIFFUSER_ANGLE_RAD * 1000;
  const gain = Math.round((at300.point.clA / rest.point.clA - 1) * 100);
  const shift = (at300.point.frontShare - rest.point.frontShare) * 100;

  return [
    section(n(0), "What you're seeing", [
      p('Aerodynamicists study a ground-effect car with an aero map: its downforce, drag and balance (the share of the downforce on the front axle) charted against the front and rear ride heights, the heights of the floor above the road at each axle. Wind tunnels and CFD fill these maps in; the car’s set-up decides where on the map it runs.'),
      para([
        'The chart colours the map by ',
        ['down', 'downforce'],
        ' (ClA, m²) with dashed lines of equal balance. The ring is the set-up you chose in the garage. As speed builds, downforce squashes the car on its springs and its ride heights fall: the line is the path the car takes across the map from rest to 350 km/h, and the filled dot is where it is now.',
      ]),
      p('Lower is more powerful — the floor sucks harder the closer it runs to the road — but only down to a point. Below it the air leaving the diffuser separates, the floor stalls and downforce falls away. Run there at speed and the car can porpoise: bounce on its springs a few times a second.'),
      p('The small plot is the pressure under the floor from its leading edge to the diffuser exit: suction peaks at the diffuser’s entrance and recovers along it. The pointer on the rolling road’s rail marks where the downforce acts; the dark tick marks where the weight acts.'),
    ]),
    section(n(1), 'The model', [
      h('div', 'formulas formulas--stacked', [
        formula('L', 'q · ClA(h_F, h_R)', 'downforce from the map, front wing + floor + rear wing'),
        formula('front wing', 'ClA_ref · G(h/c) · (1 + s·Δpitch)', 'ground-effect gain G measured on a race-wing element (Zerihan); nose-down pitch adds incidence'),
        formula('floor', 'F(h_t / (d·θ))', `measured diffuser curve (Ruhrmann & Zhang): most downforce at h_t ≈ 0.7·d·θ, here a throat gap of ≈ ${fmtMm(peakGapMm)} mm when level`),
        formula('Cp(x)', '∝ (h_t / gap)²', 'continuity: where the floor is closer to the road the air runs faster and pushes less; it recovers along the diffuser'),
        formula('h', 'h₀ − F_axle / k', 'the platform: each axle sinks until its springs hold the downforce on it'),
        formula('porpoising', 'L_h · τ / (1 + ω²τ²) > c', 'below the peak, downforce grows as the car rises; the floor answers τ late, so the push feeds the bounce faster than the dampers c remove it'),
      ]),
      list([
        `At the reference heights, ${mmPair(REFERENCE_RIDE)}, the map gives exactly the numbers the other stations use: ClA ${ref.clA.toFixed(1)} m², CdA ${ref.cdA.toFixed(1)} m², ${one(ref.frontShare * 100)} % front.`,
        `The baseline set-up (${mmPair(DEFAULT_SETUP)} at rest) sinks ${fmtMm(rest.dynamic.frontMm - at300.dynamic.frontMm)} mm at the front and ${fmtMm(rest.dynamic.rearMm - at300.dynamic.rearMm)} mm at the rear by 300 km/h; its downforce coefficient is ${gain} % higher there than at its static heights and its balance moves ${one(Math.abs(shift))} points ${shift >= 0 ? 'forward' : 'rearward'}.`,
        lowRange === null
          ? 'In this model the low 2022-style set-up does not porpoise.'
          : `The low 2022-style set-up (${mmPair(low)} at rest) porpoises between about ${fmtKmh(lowRange[0])} and ${fmtKmh(lowRange[1])} km/h, while its floor sits on the stall’s drop; faster, the plank lands and the ground holds it. The baseline and high-rake set-ups never porpoise, as 2026 cars are expected not to.`,
      ]),
      h('ul', 'about-list', [
        sourced(
          `The car’s body modes at rest: ${modes.map((m) => `${one(m.frequencyHz)} Hz`).join(' and ')} (heave and pitch). Real 2022 porpoising was timed at 4.8–5.4 Hz:`,
          SOURCES.symondsPorpoising2022,
        ),
      ]),
    ]),
    section(n(2), 'Assumptions', [
      p('Teams keep their aero maps secret. This one is built from published wind-tunnel physics, scaled to the 2026 rules and calibrated to this app’s estimates; values marked estimate are judgement calls.'),
      assumptionsTable([
        row('Front-wing ground effect, CL vs height/chord', 'measured curve', tag('phys', 'Zerihan 2001')),
        row('Front-wing lowest point above the floor’s reference plane', `${fmtMm(FW.lowestZM * 1000)} mm`, tag('reg', 'Reg App C2 §22')),
        row('Front-wing chord (three elements)', `${FW.chordM} m`, tag('estimate', 'Estimate')),
        row('Diffuser downforce vs throat gap (10° ramp)', 'measured curve', tag('phys', 'Ruhrmann & Zhang 2003')),
        row('Flat floor and diffuser: from 450 mm behind the front axle to 300 mm behind the rear', 'regulation volumes', tag('reg', 'Reg App C2 §4, §34')),
        row('Diffuser exit roof above the floor, and the ramp it makes', `${fmtMm(FL.exitRoofM * 1000)} mm · ${deg(DIFFUSER_ANGLE_RAD)}°`, tag('estimate', 'Estimate')),
        row('Effective half-width of one diffuser channel, d', `${FL.channelHalfWidthM} m`, tag('estimate', 'Estimate')),
        row('Air pressure at the diffuser exit, Cp', String(FL.exitCp), tag('estimate', 'Estimate')),
        row('How steep the stall drop is (sets whether the car can porpoise)', 'modelled', tag('estimate', 'Estimate')),
        row('Extra drag per unit of floor downforce, ΔCdA/ΔClA', String(FL.dragPerDownforce), tag('estimate', 'Estimate · GP2 map')),
        row('Plank thickness (its top is the reference plane)', `${fmtMm(AEROMAP.plank.thicknessM * 1000)} mm`, tag('reg', 'Reg C3.6.1')),
        row('Floor stiffness when the plank touches the road', `${AEROMAP.plank.rateNPerMm / 1000} kN/mm`, tag('estimate', 'Estimate · Reg C3.18 minimum')),
        row('Ride rate of each axle, front / rear (springs and tyres)', `${ESTIMATES.brakes.frontAxleRateNPerMm} / ${ESTIMATES.brakes.rearAxleRateNPerMm} N/mm`, tag('estimate', 'Estimate')),
        row('Height at which drag acts', `${AEROMAP.platform.dragHeightM} m`, tag('estimate', 'Estimate')),
        row('Damper damping ratio', String(B.dampingRatio), tag('estimate', 'Estimate')),
        row('Delay of the floor’s force, in times the air takes to cross the floor', String(B.lagConvectiveTimes), tag('estimate', 'Estimate')),
        row('Pitch radius of gyration', `${B.pitchRadiusM} m`, tag('estimate', 'Estimate')),
        row('Set-ups: baseline, low 2022-style, high rake (static, front / rear)', RIDE_PRESETS.map((r) => `${r.frontMm}/${r.rearMm}`).join(' · ') + ' mm', tag('estimate', 'Estimate')),
        row('Reference heights where the map equals the other stations', mmPair(REFERENCE_RIDE), tag('result', 'Model result')),
      ]),
    ]),
    section(n(3), 'What is simplified', [
      list([
        'The map is a physics-shaped estimate, not a team’s data. Its shapes come from wind-tunnel tests of a single wing and of a simple body with a diffuser, scaled to a 2026 floor; its size is set to match this app’s ClA and balance.',
        'Only ride height and pitch. Real maps also vary with yaw, roll and steering, and with speed through the bodywork’s flex.',
        'Linear springs, no bump stops or heave springs, and a rigid body on two axles; tyres are lumped into the axle rates.',
        'The porpoising here is small, a couple of millimetres, and depends on how steep the stall drop is, which the measurements only bracket. The 3D view draws the bounce three times bigger and says so. Real 2022 porpoising was far larger.',
        'Drag and downforce act through fixed points per surface; the balance moves because the surfaces’ loads change, not because their centres move (except the floor’s).',
      ]),
    ]),
    section(n(4), 'The rules', [
      h('ul', 'about-list', [
        h('li', { text: 'Ride height itself is free, but it cannot be adjusted while the car runs: no ride-height control or self-levelling (C10.2.6c) and no inerters or mass dampers (C10.2.6).' }),
        h('li', { text: 'The plank under the floor is 10 mm thick and may wear to 8 mm (C3.6.1): run too low and it wears through, and the car is disqualified.' }),
        h('li', { text: 'The 2026 floor is partly flat by rule and its diffuser is smaller: the FIA wanted less reliance on very low, very stiff set-ups.' }),
        sourced('2026 cars are not expected to porpoise:', SOURCES.shovlinPorpoising2025),
        sourced('How porpoising was explained in 2022:', SOURCES.symondsPorpoising2022),
      ]),
    ]),
  ];
}
