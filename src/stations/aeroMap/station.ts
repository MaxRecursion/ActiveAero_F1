/**
 * Station 06 — Aero map. Set the static ride heights, add speed, and watch the car settle across its
 * aero map: downforce squashes it on its springs, the floor nears the road and sucks harder, the balance
 * moves — until, run too low, the diffuser stalls and the car can porpoise.
 *
 *   set-up + speed ─► platformAt (where the springs balance the load)
 *                  ─► bounce sim (heave + pitch, the floor's force lagging) ─► ride heights now
 *                  ─► aeroMapAt + floorPressure ─► garage (pose · arrows · balance) + view + caption
 *
 * Every number comes from src/physics/aeromap.ts. What changes only with the set-up (the trajectory
 * across the map, the porpoising onset, the facts the captions quote) is worked out once per set-up.
 *
 * Scale: the 3D body is posed by its ride heights to scale (a 20–30 mm squat and the rake read at the
 * station's low camera). The porpoising limit cycle is only ≈ 2 mm peak to peak, invisible at that
 * scale, so the bounce alone — the ride heights' swing about where the springs balance — is drawn
 * BOUNCE_DRAWN times bigger, and the conditions strip and the porpoising caption say so.
 */
import type { RidePose } from '../../app/garage';
import { aeroState, type AeroState } from '../../physics/aero';
import {
  aeroMapAt,
  bounceModes,
  createBounceSim,
  DEFAULT_SETUP,
  FLOOR_SAMPLES,
  floorPressure,
  platformAt,
  platformSweep,
  porpoiseRangeKmh,
  REFERENCE_RIDE,
  RIDE_PRESETS,
  SETUP_RANGE,
  type BounceMode,
  type MapPoint,
  type Platform,
} from '../../physics/aeromap';
import { ESTIMATES, PHYS, REGS, SPEED_RANGE_KMH } from '../../physics/constants';
import { prefersReducedMotion, type Shot } from '../../scene/stage';
import type { CaptionRun, RideHeights, SpeedPreset, Station6View, StationUIConfig, StationView } from '../../ui/types';
import type { Station, StationContext } from '../types';
import { bandOf, captionFor, captionKey, setupFacts, type CaptionContext, type SetupFacts } from './content';

/**
 * Speed presets: the shared corners and straights, with the hairpin (where the air does little) swapped
 * for a long straight at 290 km/h — inside the low set-up's porpoising window, which is only ≈ 16 km/h wide.
 */
export const AERO_MAP_PRESETS: SpeedPreset[] = [
  { kmh: 0, label: 'Parked' },
  { kmh: 150, label: 'Medium corner' },
  { kmh: 250, label: 'Fast corner' },
  { kmh: 290, label: 'Long straight' },
  { kmh: 330, label: 'End of straight' },
];

/** The 3D view draws ride heights to scale (the view's rideExaggeration). */
export const RIDE_EXAGGERATION = 1;
/**
 * …and the bounce about the platform's equilibrium this many times bigger, so a 2 mm porpoising cycle
 * moves the car by about 6 mm on screen instead of a fraction of a pixel. The most the brief allows.
 */
export const BOUNCE_DRAWN = 3;
/** Platform sweep for the map's trajectory: rest to the top of the speed range in 5 km/h steps. */
const SWEEP_STEP_KMH = 5;
/** Below this change in the ride heights now (mm) the map point and the floor pressure are not re-evaluated. */
const SHOWN_EPS_MM = 1e-4;
const MM = 1e-3;

/**
 * A front three-quarter from the car's right, aimed behind the rear axle so the car sits in the right of
 * the free area, clear of the header and the caption on the left: the rake, the squat and the bounce read
 * against the rolling road, and the force arrows and the balance pointer on the rail stay in frame above
 * the tall dock.
 */
const SHOT: Shot = { position: [4.6, 1.55, 10.2], target: [-1.1, 0.95, 0] };
/** Phones (the single-column sheet, as ui.css): no room beside the car, so aim at its middle. */
const SHOT_NARROW: Shot = { position: [10.4, 3.1, 15.6], target: [-0.3, 0.5, 0] };
const NARROW_QUERY = '(max-width: 719.98px)';

export const AERO_MAP_CONFIG: StationUIConfig = {
  meta: {
    id: 'aeroMap',
    number: '06',
    title: 'Aero map',
    prompt: 'Set the ride heights. Add speed. Find where the floor stalls.',
  },
  presets: AERO_MAP_PRESETS,
  toggles: ['airflow'],
  conditions:
    `ISA sea level · ${REGS.minMassKg.value} kg · axle rates ${ESTIMATES.brakes.frontAxleRateNPerMm}/` +
    `${ESTIMATES.brakes.rearAxleRateNPerMm} N/mm est. · map from wind-tunnel ground-effect data, scaled (est.) · ` +
    `ride heights to scale, bounce drawn ${BOUNCE_DRAWN}× (still with reduced motion)`,
};

/** Clamp to the sliders' range and round to their 1 mm step. */
export function clampSetup(next: RideHeights): RideHeights {
  const f = Math.round(Math.min(SETUP_RANGE.frontMm[1], Math.max(SETUP_RANGE.frontMm[0], next.frontMm)));
  const r = Math.round(Math.min(SETUP_RANGE.rearMm[1], Math.max(SETUP_RANGE.rearMm[0], next.rearMm)));
  return { frontMm: f, rearMm: r };
}

export function createAeroMapStation({ garage, ui }: StationContext): Station {
  const reducedMotion = prefersReducedMotion();
  const state = { airflow: true, needsReset: true };
  /** Static set-up; the view carries this same object, so it is changed in place. */
  const setup: RideHeights = { frontMm: DEFAULT_SETUP.frontMm, rearMm: DEFAULT_SETUP.rearMm };
  const sim = createBounceSim();

  // ── per set-up ─────────────────────────────────────────────────────────────────
  let setupVersion = 0;
  let trajectory: Station6View['trajectory'] = [];
  let range: [number, number] | null = null;
  let facts!: SetupFacts;
  function recomputeSetup() {
    const sweep = platformSweep(setup, SPEED_RANGE_KMH.max, SWEEP_STEP_KMH);
    trajectory = sweep.map((p) => ({ kmh: p.speedKmh, frontMm: p.dynamic.frontMm, rearMm: p.dynamic.rearMm }));
    range = porpoiseRangeKmh(setup);
    facts = setupFacts(setup, sweep);
    setupVersion++;
  }
  recomputeSetup();

  // ── per speed (and set-up): the equilibrium and its least-damped mode ────────────
  let platform!: Platform;
  const platformOf = { kmh: Number.NaN, version: -1 };
  let mode!: BounceMode;
  const modeOf = { kmh: Number.NaN, version: -1 };

  // ── per frame, reused ─────────────────────────────────────────────────────────
  /** Ride heights now, mm (real scale): the sim's, or the equilibrium's with reduced motion. */
  const shown: RideHeights = { frontMm: Number.NaN, rearMm: Number.NaN };
  let point!: MapPoint;
  const pressureOut = {
    x: new Float64Array(FLOOR_SAMPLES),
    cp: new Float64Array(FLOOR_SAMPLES),
    widthM: new Float64Array(FLOOR_SAMPLES),
  };
  const pressure: Station6View['pressure'] = { x: pressureOut.x, cp: pressureOut.cp, throatX: 0, exitX: 0, separationX: null };
  const refFrontSharePct = aeroMapAt(REFERENCE_RIDE).frontShare * 100;

  /** The constant model's state, re-labelled with the map's numbers so the garage's arrows follow the map. */
  const aero: AeroState = aeroState(0);
  const surfaces = aero.surfaces;
  const pose: RidePose = { frontM: 0, rearM: 0 };

  let caption: CaptionRun[] = [];
  let captionWas = '';
  // With reduced motion the car is drawn at rest on its springs: nothing bounces, so nothing is "drawn bigger".
  const captionCtx: CaptionContext = { band: 'parked', facts, bounceHz: 0, bounceDrawn: reducedMotion ? 0 : BOUNCE_DRAWN };

  const view: Station6View = {
    speedKmh: 0,
    setup,
    dynamic: { frontMm: setup.frontMm, rearMm: setup.rearMm },
    trajectory,
    reference: REFERENCE_RIDE,
    clA: 0,
    cdA: 0,
    downforceN: 0,
    dragN: 0,
    efficiency: 0,
    frontSharePct: 0,
    refFrontSharePct,
    weightFrontPct: ESTIMATES.staticFrontShare * 100,
    surfaces,
    floor: { regime: 'attached', throatGapMm: 0, peakGapMm: 0 },
    pressure,
    plankClearanceMm: 0,
    bottoming: false,
    bounce: { unstable: false, frequencyHz: 0, dampingRatio: 1, amplitudeMm: 0, onsetKmh: null, untilKmh: null },
    rideExaggeration: RIDE_EXAGGERATION,
    presets: RIDE_PRESETS,
    caption,
  };
  const out: StationView = { station: 'aeroMap', view };

  function updatePlatform(kmh: number) {
    if (platformOf.kmh === kmh && platformOf.version === setupVersion) return;
    platformOf.kmh = kmh;
    platformOf.version = setupVersion;
    platform = platformAt(kmh, setup);
  }

  /** The least-damped mode, re-solved whenever the speed or set-up moved (≈ 0.03 ms). */
  function updateMode(kmh: number) {
    if (modeOf.kmh === kmh && modeOf.version === setupVersion) return;
    modeOf.kmh = kmh;
    modeOf.version = setupVersion;
    mode = bounceModes(kmh, setup);
  }

  /** Map point and floor pressure at the ride heights now, re-evaluated only when they moved. */
  function updateShown(frontMm: number, rearMm: number) {
    if (Math.abs(frontMm - shown.frontMm) < SHOWN_EPS_MM && Math.abs(rearMm - shown.rearMm) < SHOWN_EPS_MM) return;
    shown.frontMm = frontMm;
    shown.rearMm = rearMm;
    point = aeroMapAt(shown);
    const p = floorPressure(shown, pressureOut);
    pressure.throatX = p.throatX;
    pressure.exitX = p.exitX;
    pressure.separationX = p.separationX;
  }

  function updateAero(kmh: number) {
    const q = platform.q;
    aero.speedKmh = kmh;
    aero.speedMs = kmh / 3.6;
    aero.q = q;
    aero.downforceN = q * point.clA;
    aero.dragN = q * point.cdA;
    aero.dragPowerW = aero.dragN * aero.speedMs;
    aero.downforceToWeight = aero.downforceN / aero.weightN;
    aero.downforceEquivalentKg = aero.downforceN / PHYS.g;
    aero.aeroFrontShare = point.frontShare;
    for (const s of surfaces) {
      for (const m of point.surfaces) if (m.id === s.id) s.downforceN = q * m.clA;
    }
  }

  function updateCaption() {
    captionCtx.band = bandOf({
      kmh: view.speedKmh,
      regime: platform.point.floor.regime,
      bottoming: platform.bottoming,
      porpoising: mode.unstable,
    });
    captionCtx.facts = facts;
    captionCtx.bounceHz = mode.frequencyHz;
    const key = captionKey(captionCtx, setupVersion);
    if (key === captionWas) return;
    captionWas = key;
    caption = captionFor(captionCtx);
  }

  const station: Station = {
    config: AERO_MAP_CONFIG,
    shot: () => (window.matchMedia?.(NARROW_QUERY).matches ? SHOT_NARROW : SHOT),
    sweep: { from: 0, to: 340 },
    intro: { kmh: 250, belowKmh: 1 },
    enter() {
      state.needsReset = true;
      garage.setExploded(false);
      garage.setCeiling(false);
      garage.setAeroMode('corner');
      garage.setWeightArrow(false);
      garage.setForceArrows(true);
      garage.setXray(false);
      garage.setEnergyFlow(false);
      garage.setBraking(null);
      garage.setHighlight(null);
      garage.setAirflow(state.airflow);
      ui.setToggle('airflow', state.airflow);
    },
    exit() {
      garage.setRide(null);
      garage.setAeroBalance(null);
    },
    onToggle(id, on) {
      if (id !== 'airflow') return;
      state.airflow = on;
      garage.setAirflow(on);
      ui.setToggle('airflow', on);
    },
    onRideHeight(next) {
      if (!Number.isFinite(next.frontMm) || !Number.isFinite(next.rearMm)) return;
      const c = clampSetup(next);
      if (c.frontMm === setup.frontMm && c.rearMm === setup.rearMm) return;
      setup.frontMm = c.frontMm;
      setup.rearMm = c.rearMm;
      // The sim notices the new springs' rest heights on its next step and nudges the car, so it
      // moves to them with its own dynamics (and shows a bounce if the new set-up is unstable).
      recomputeSetup();
    },
    frame(dt, kmh) {
      const v = Math.max(0, kmh);
      updatePlatform(v);
      updateMode(v);
      if (state.needsReset) {
        state.needsReset = false;
        sim.reset(setup, v);
      } else {
        sim.step(dt, v, setup);
      }
      const eq = platform.dynamic;
      const now = reducedMotion ? eq : sim.rideHeights;
      updateShown(now.frontMm, now.rearMm);
      updateAero(v);

      // To scale, apart from the bounce about the equilibrium.
      pose.frontM = (eq.frontMm + BOUNCE_DRAWN * (now.frontMm - eq.frontMm)) * MM;
      pose.rearM = (eq.rearMm + BOUNCE_DRAWN * (now.rearMm - eq.rearMm)) * MM;
      garage.setRide(pose);
      garage.setAeroBalance(point.frontShare);
      garage.update(dt, v, aero);

      view.speedKmh = v;
      view.dynamic.frontMm = now.frontMm;
      view.dynamic.rearMm = now.rearMm;
      view.trajectory = trajectory;
      view.clA = point.clA;
      view.cdA = point.cdA;
      view.downforceN = aero.downforceN;
      view.dragN = aero.dragN;
      view.efficiency = point.clA / point.cdA;
      view.frontSharePct = point.frontShare * 100;
      // The floor's state and the plank are read at the equilibrium the car bounces about: while it
      // porpoises the instant ride heights cross the stall's edge many times a second, and the words
      // would flicker. The gap is the instant one.
      view.floor.regime = platform.point.floor.regime;
      view.floor.throatGapMm = point.floor.throatGapMm;
      view.floor.peakGapMm = point.floor.peakGapMm;
      view.plankClearanceMm = Math.max(0, platform.plankClearanceMm);
      view.bottoming = platform.bottoming;
      view.bounce.unstable = mode.unstable;
      view.bounce.frequencyHz = mode.frequencyHz;
      view.bounce.dampingRatio = mode.dampingRatio;
      view.bounce.amplitudeMm = sim.amplitudeMm;
      view.bounce.onsetKmh = range ? range[0] : null;
      view.bounce.untilKmh = range ? range[1] : null;
      updateCaption();
      view.caption = caption;
      ui.render(out);
    },
  };
  return station;
}
