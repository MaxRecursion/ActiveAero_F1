/**
 * Station 03 — Energy. The 2026 car is roughly half electric, and its battery is tiny: it may
 * swing only 4 MJ and recover at most 8.5 MJ a lap. Broadcasts stopped showing it, so the most
 * important thing happening on a lap is invisible. Here the car runs a simulated lap on the rolling
 * road with its shell X-rayed, and energy moves visibly: engine → wheels, battery ⇄ motor ⇄ wheels,
 * engine → battery while super clipping.
 *
 * The lap is precomputed (src/physics/lap.ts); this station plays it back and scrubs it.
 */
import { aeroState } from '../../physics/aero';
import { ESTIMATES, REGS } from '../../physics/constants';
import { sampleAt, simulateLap, type LapResult } from '../../physics/lap';
import { CIRCUIT_NAME } from '../../physics/track';
import type { Shot } from '../../scene/stage';
import { prefersReducedMotion } from '../../scene/stage';
import type { LapTrace, StationUIConfig } from '../../ui/types';
import type { SoundCue, Station, StationContext } from '../types';
import { captionFor } from './content';

/** Close three-quarter on the car's right (the MGU-K side): battery, engine, motor and rear axle fill the frame. */
const SHOT: Shot = { position: [1.65, 2.4, 5.45], target: [-0.95, 0.3, 0] };
/** Open the station a moment before the first braking zone: the battery visibly starts to fill. */
const LEAD_IN_S = 2;
/** Timeline and map resolution: one point every ~10 m. */
const TRACE_EVERY = 5;
const RATES = [0.5, 1, 2] as const;

export const ENERGY_CONFIG: StationUIConfig = {
  meta: {
    id: 'energy',
    number: '03',
    title: 'Energy',
    prompt: 'Watch a lap. See where the battery fills — and where it runs dry.',
  },
  control: 'lap',
  presets: [],
  toggles: ['xray', 'clipping', 'airflow'],
  conditions:
    `${CIRCUIT_NAME} · ${REGS.minMassKg.value} kg · engine ${ESTIMATES.iceKw} kW est. · motor ≤ ${REGS.mguKMaxKw.value} kW · ` +
    `battery window ${REGS.energyStoreWindowMJ.value} MJ · recovery ≤ ${REGS.harvestPerLapMJ.value} MJ/lap · ` +
    `grip μ ${ESTIMATES.gripLateral}/${ESTIMATES.gripLongitudinal} est.`,
};

function toTrace(lap: LapResult, noClipLapTimeS: number): LapTrace {
  const pick = lap.samples.filter((_, i) => i % TRACE_EVERY === 0);
  return {
    lengthM: lap.track.length,
    lapTimeS: lap.lapTimeS,
    map: pick.map(({ x, y }) => ({ x, y })),
    trace: pick.map(({ s, t, kmh, socMJ, mguKKw, phase }) => ({ s, t, kmh, socMJ, mguKKw, phase })),
    corners: lap.track.corners.map(({ label, s, x, y }) => ({ label, s, x, y })),
    harvestedMJ: lap.harvestedMJ,
    brakeHarvestMJ: lap.brakeHarvestMJ,
    clipHarvestMJ: lap.clipHarvestMJ,
    deployedMJ: lap.deployedMJ,
    topSpeedKmh: lap.topSpeedKmh,
    harvestCapMJ: lap.harvestCapMJ,
    windowMJ: REGS.energyStoreWindowMJ.value,
    noClipLapTimeS,
    clipping: lap.options.clipping,
  };
}

export function createEnergyStation({ garage, ui }: StationContext): Station {
  const withClip = simulateLap({ clipping: true });
  const withoutClip = simulateLap({ clipping: false });
  const laps = {
    on: { result: withClip, trace: toTrace(withClip, withoutClip.lapTimeS) },
    off: { result: withoutClip, trace: toTrace(withoutClip, withoutClip.lapTimeS) },
  };
  const state = {
    clipping: true,
    xray: true,
    airflow: false,
    playing: !prefersReducedMotion(),
    rate: 1 as number,
    tS: Math.max(0, (withClip.samples.find((x) => x.phase === 'brake')?.t ?? 0) - LEAD_IN_S),
    kmh: 0,
  };
  const current = () => (state.clipping ? laps.on : laps.off);
  const sound: SoundCue = { load: 0, brake: 0, mguKKw: 0 };

  function setPlaying(on: boolean) {
    state.playing = on;
    ui.setPlaying(on);
  }

  return {
    config: ENERGY_CONFIG,
    shot: () => SHOT,
    currentKmh: () => state.kmh,
    enter() {
      garage.setXray(state.xray);
      garage.setAirflow(state.airflow);
      garage.setEnergyFlow(true);
      garage.setForceArrows(false);
      garage.setWeightArrow(false);
      ui.setToggle('xray', state.xray);
      ui.setToggle('clipping', state.clipping);
      ui.setToggle('airflow', state.airflow);
      ui.setPlaying(state.playing);
    },
    exit() {
      garage.setXray(false);
      garage.setEnergyFlow(false);
      garage.setForceArrows(true);
      garage.setAeroMode('corner');
      ui.setPlaying(false);
    },
    onToggle(id, on) {
      if (id === 'xray') {
        state.xray = on;
        garage.setXray(on);
      } else if (id === 'airflow') {
        state.airflow = on;
        garage.setAirflow(on);
      } else if (id === 'clipping') {
        // Keep the car at the same place on the circuit: map time through distance.
        const s = sampleAt(current().result, state.tS).s;
        state.clipping = on;
        const lap = current().result.samples;
        state.tS = lap.find((x) => x.s >= s)?.t ?? 0;
      } else return;
      ui.setToggle(id, on);
    },
    onPlayToggle: () => setPlaying(!state.playing),
    onLapScrub(tS) {
      const T = current().result.lapTimeS;
      state.tS = ((tS % T) + T) % T;
    },
    onLapRate(rate) {
      state.rate = RATES.includes(rate as (typeof RATES)[number]) ? rate : 1;
    },
    frame(dt) {
      const lap = current();
      if (state.playing) state.tS = (state.tS + dt * state.rate) % lap.result.lapTimeS;
      const x = sampleAt(lap.result, state.tS);
      state.kmh = x.kmh;
      garage.setAeroMode(x.straightT > 0.5 ? 'straight' : 'corner');
      // Energy targets first, so this frame's update already animates toward them.
      garage.setEnergy({
        engineKw: x.engineKw,
        mguKKw: x.mguKKw,
        harvestSource: x.phase === 'clip' ? 'engine' : 'brakes',
        charge: x.socMJ / REGS.energyStoreWindowMJ.value,
      });
      garage.update(dt, x.kmh, aeroState(x.kmh, undefined, garage.straightT));
      const load = x.engineKw / ESTIMATES.iceKw;
      sound.load = load <= 0 ? 0 : load >= 1 ? 1 : load;
      sound.brake = x.phase === 'brake' ? 1 : 0;
      sound.mguKKw = x.mguKKw;
      ui.render({
        station: 'energy',
        view: {
          lap: lap.trace,
          tS: state.tS,
          sM: x.s,
          kmh: x.kmh,
          phase: x.phase,
          mguKKw: x.mguKKw,
          engineKw: x.engineKw,
          socMJ: x.socMJ,
          harvestedMJ: x.harvestedMJ,
          deployedMJ: x.deployedMJ,
          playing: state.playing,
          rate: state.rate,
          caption: captionFor({ phase: x.phase, kmh: x.kmh, socMJ: x.socMJ, clipping: state.clipping, engineKw: x.engineKw }),
        },
      });
    },
    audio: () => sound,
  };
}
