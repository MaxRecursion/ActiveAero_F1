/**
 * Station 04 — Braking. Pick the speed to brake from, press Brake, and the car stops flat out to 80 km/h.
 * The nose dips because weight is thrown onto the front axle (drawn 6 times bigger, and labelled), the
 * load arrows change, the carbon discs heat and glow through see-through wheels, and a live split shows
 * how much of the braking power goes back into the battery and how much becomes heat. Braking eases as
 * the downforce falls with the speed.
 *
 * One zone is simulated per entry speed (src/physics/braking.ts) and played back or scrubbed here.
 *
 * The shared speed slider is the "brake from" speed and is left alone while a stop plays. The app feeds
 * that slider's damped value to frame(); a change in it during a stop (or after) means the user moved
 * the slider, so the station goes back to ready at the new speed.
 */
import { BRAKE_DIVE_EXAGGERATION, type BrakingScene } from '../../app/garage';
import { aeroState, type AeroState } from '../../physics/aero';
import { ESTIMATES, REGS } from '../../physics/constants';
import type { Shot } from '../../scene/stage';
import type { BrakeState, CaptionRun, Station4View, StationUIConfig } from '../../ui/types';
import type { Station, StationContext } from '../types';
import { captionFor, phaseOf, PRESETS, type BrakePhase } from './content';
import { makeBrakeRun, viewAt, type BrakeMoment, type BrakeRun } from './trace';

/**
 * In front of the car's right side, just above it, aimed over the roof so the car sits low in the
 * free area: this station's dock is tall, and the axle arrows and their tags need the room above.
 */
const SHOT: Shot = { position: [5.67, 1.56, 9.35], target: [-0.1, 0.85, 0] };

/** The slider's useful range as "brake from": below this a stop is over before anything happens. */
export const BRAKE_FROM_KMH = { min: 120, max: 345 } as const;
/** Half speed by default: a real 2.5 s stop is over before the eye finds the nose. */
export const DEFAULT_RATE = 0.5;
export const RATES: readonly number[] = [0.25, 0.5, 1];

export const BRAKING_CONFIG: StationUIConfig = {
  meta: {
    id: 'braking',
    number: '04',
    title: 'Braking',
    prompt: 'Pick a speed. Press Brake. Watch the nose dip and the discs heat.',
  },
  control: 'brake',
  presets: PRESETS,
  toggles: ['brakes'],
  conditions:
    `Full brakes to ${ESTIMATES.brakes.apexKmh} km/h · wings closed (Corner Mode) · ${REGS.minMassKg.value} kg · ` +
    `tyre grip μ ${ESTIMATES.gripLongitudinal} est. · motor takes back ≤ ${REGS.mguKMaxKw.value} kW · ` +
    `discs start ${ESTIMATES.brakes.startDiscC} °C est. · dive drawn ${BRAKE_DIVE_EXAGGERATION}× bigger`,
};

const entryOf = (kmh: number) => Math.min(BRAKE_FROM_KMH.max, Math.max(BRAKE_FROM_KMH.min, Math.round(kmh)));

export function createBrakingStation({ garage, ui }: StationContext): Station {
  const state = {
    mode: 'ready' as BrakeState,
    /** Playhead, s into the zone. */
    tS: 0,
    playing: false,
    rate: DEFAULT_RATE,
    seeThrough: true,
    /** Brake was pressed while the slider was still easing: start as soon as it stops. */
    pending: false,
    /** The slider's value on the previous frame (NaN before the first). */
    lastArg: Number.NaN,
    /** The slider's value did not change since the previous frame. */
    settled: false,
  };

  let run: BrakeRun = makeBrakeRun(300);
  /** The scene the garage draws: one object, updated in place. */
  const scene: BrakingScene = {
    noseDropM: 0,
    tailRiseM: 0,
    frontDiscC: 0,
    rearDiscC: 0,
    frontLoadN: 0,
    rearLoadN: 0,
    frontStaticN: 0,
    rearStaticN: 0,
    seeThrough: true,
  };

  // What the last built view was made from; the view, scene and caption are rebuilt only when it changes.
  const built = { run: null as BrakeRun | null, mode: 'ready' as BrakeState, tS: -1, playing: false, rate: -1, seeThrough: true };
  let view: Station4View | null = null;
  let caption: CaptionRun[] = [];
  const captionOf = { run: null as BrakeRun | null, phase: 'ready' as BrakePhase, paused: false };
  let aero: AeroState | null = null;
  const aeroOf = { kmh: -1, straightT: -1 };

  function setPlaying(on: boolean) {
    if (state.playing === on) return;
    state.playing = on;
    ui.setPlaying(on);
  }

  function setRun(kmh: number) {
    run = makeBrakeRun(kmh);
  }

  function resetToReady() {
    state.mode = 'ready';
    state.tS = 0;
    state.pending = false;
    setPlaying(false);
  }

  function startBraking() {
    state.mode = 'braking';
    state.tS = 0;
    state.pending = false;
    setPlaying(true);
  }

  function captionFrom(moment: BrakeMoment, paused: boolean): CaptionRun[] {
    const phase = phaseOf(state.mode, run.trace, moment.kmh);
    const shownPause = paused && (phase === 'early' || phase === 'mid' || phase === 'late');
    if (captionOf.run !== run || captionOf.phase !== phase || captionOf.paused !== shownPause) {
      captionOf.run = run;
      captionOf.phase = phase;
      captionOf.paused = shownPause;
      caption = captionFor({
        phase,
        paused: shownPause,
        zone: run.trace,
        transferN: viewAt(run.zone, 0).transferN,
        diveExaggeration: BRAKE_DIVE_EXAGGERATION,
      });
    }
    return caption;
  }

  return {
    config: BRAKING_CONFIG,
    shot: () => SHOT,
    intro: { kmh: 300, belowKmh: 200 },
    enter() {
      state.mode = 'ready';
      state.tS = 0;
      state.playing = false;
      state.rate = DEFAULT_RATE;
      state.seeThrough = true;
      state.pending = false;
      state.lastArg = Number.NaN;
      state.settled = false;
      built.run = null;
      captionOf.run = null;
      garage.setXray(false);
      garage.setEnergyFlow(false);
      garage.setAirflow(false);
      garage.setForceArrows(false);
      garage.setWeightArrow(false);
      // The zone assumes the wings are shut for braking.
      garage.setAeroMode('corner');
      ui.setToggle('brakes', true);
      ui.setPlaying(false);
    },
    exit() {
      garage.setBraking(null);
      garage.setForceArrows(true);
      garage.setAeroMode('corner');
      ui.setPlaying(false);
    },
    onToggle(id, on) {
      if (id !== 'brakes') return;
      state.seeThrough = on;
      ui.setToggle('brakes', on);
    },
    onPlayToggle() {
      if (state.mode === 'ready') {
        // Brake from the speed the slider shows: if it is still easing, wait for it.
        if (state.settled) startBraking();
        else state.pending = true;
      } else if (state.mode === 'done') startBraking();
      else setPlaying(!state.playing);
    },
    onLapScrub(tS) {
      if (!Number.isFinite(tS)) return;
      state.pending = false;
      setPlaying(false);
      const T = run.zone.timeS;
      if (tS <= 0) {
        state.mode = 'ready';
        state.tS = 0;
      } else {
        state.tS = Math.min(T, tS);
        state.mode = state.tS >= T ? 'done' : 'braking';
      }
    },
    onLapRate(rate) {
      if (RATES.includes(rate)) state.rate = rate;
    },
    frame(dt, arg) {
      const moved = arg !== state.lastArg;
      state.settled = !moved;
      state.lastArg = arg;
      // The slider moves the entry speed. Mid-stop or after one, that starts over.
      if (moved && state.mode !== 'ready') resetToReady();
      if (state.mode === 'ready') {
        const entry = entryOf(arg);
        if (entry !== run.zone.fromKmh) setRun(entry);
        if (state.pending && state.settled) startBraking();
      }

      if (state.mode === 'braking' && state.playing) {
        state.tS = Math.min(run.zone.timeS, state.tS + dt * state.rate);
        if (state.tS >= run.zone.timeS) {
          state.mode = 'done';
          setPlaying(false);
        }
      }

      const changed =
        built.run !== run ||
        built.mode !== state.mode ||
        built.tS !== state.tS ||
        built.playing !== state.playing ||
        built.rate !== state.rate ||
        built.seeThrough !== state.seeThrough;
      if (changed) {
        built.run = run;
        built.mode = state.mode;
        built.tS = state.tS;
        built.playing = state.playing;
        built.rate = state.rate;
        built.seeThrough = state.seeThrough;

        const m = state.mode === 'ready' ? run.cruise : viewAt(run.zone, state.tS);
        scene.noseDropM = m.noseDropM;
        scene.tailRiseM = m.tailRiseM;
        scene.frontDiscC = m.frontDiscC;
        scene.rearDiscC = m.rearDiscC;
        scene.frontLoadN = m.frontLoadN;
        scene.rearLoadN = m.rearLoadN;
        scene.frontStaticN = m.frontStaticN;
        scene.rearStaticN = m.rearStaticN;
        scene.seeThrough = state.seeThrough;
        view = {
          zone: run.trace,
          state: state.mode,
          tS: m.tS,
          sM: m.sM,
          kmh: m.kmh,
          decelG: m.decelG,
          brakeKw: m.brakeKw,
          harvestKw: m.harvestKw,
          heatKw: m.heatKw,
          frontLoadN: m.frontLoadN,
          rearLoadN: m.rearLoadN,
          frontStaticN: m.frontStaticN,
          rearStaticN: m.rearStaticN,
          transferN: m.transferN,
          frontBiasPct: m.frontBiasPct,
          noseDropMm: m.noseDropMm,
          diveExaggeration: BRAKE_DIVE_EXAGGERATION,
          frontDiscC: m.frontDiscC,
          rearDiscC: m.rearDiscC,
          harvestedMJ: m.harvestedMJ,
          heatMJ: m.heatMJ,
          playing: state.playing,
          rate: state.rate,
          caption: captionFrom(m, state.mode === 'braking' && !state.playing),
        };
      }

      // The car's own speed: the zone's, so the road and wheels slow with the car.
      const kmh = view!.kmh;
      garage.setBraking(scene);
      if (!aero || aeroOf.kmh !== kmh || aeroOf.straightT !== garage.straightT) {
        aeroOf.kmh = kmh;
        aeroOf.straightT = garage.straightT;
        aero = aeroState(kmh, undefined, garage.straightT);
      }
      garage.update(dt, kmh, aero);
      ui.render({ station: 'braking', view: view! });
    },
  };
}
