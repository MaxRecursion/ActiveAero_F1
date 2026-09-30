import { describe, expect, it, vi } from 'vitest';
import { BRAKE_DIVE_EXAGGERATION, type BrakingScene, type Garage } from '../../app/garage';
import type { AeroState } from '../../physics/aero';
import { ESTIMATES } from '../../physics/constants';
import type { Station4View, StationView, UI } from '../../ui/types';
import type { Station } from '../types';
import { PRESETS } from './content';
import { BRAKE_FROM_KMH, BRAKING_CONFIG, createBrakingStation, DEFAULT_RATE } from './station';
import { makeBrakeRun } from './trace';

const DT = 1 / 60;

function make() {
  const garage = {
    straightT: 0,
    setXray: vi.fn(),
    setEnergyFlow: vi.fn(),
    setAirflow: vi.fn(),
    setForceArrows: vi.fn(),
    setWeightArrow: vi.fn(),
    setAeroMode: vi.fn(),
    setBraking: vi.fn<(scene: BrakingScene | null) => void>(),
    update: vi.fn<(dt: number, kmh: number, aero: AeroState) => void>(),
  };
  const views: Station4View[] = [];
  const ui = {
    render: vi.fn((v: StationView) => {
      if (v.station === 'braking') views.push(v.view);
    }),
    setPlaying: vi.fn(),
    setToggle: vi.fn(),
    setSpeedControl: vi.fn(),
  };
  const station: Station = createBrakingStation({
    garage: garage as unknown as Garage,
    ui: ui as unknown as UI,
    stage: {} as never,
  });
  station.enter();
  return { station, garage, ui, views, last: () => views[views.length - 1] };
}

type Rig = ReturnType<typeof make>;

/** Step frames for `seconds` with the slider at `arg`. */
function step(rig: Rig, seconds: number, arg: number) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) rig.station.frame(DT, arg);
}

/** Open the station at `arg` and let the slider be seen as settled. */
function ready(arg = 300) {
  const rig = make();
  step(rig, 2 * DT, arg);
  return rig;
}

/** Ready at `arg`, Brake pressed. */
function braking(arg = 300, rate?: number) {
  const rig = ready(arg);
  if (rate !== undefined) rig.station.onLapRate!(rate);
  rig.station.onPlayToggle!();
  return rig;
}

describe('BRAKING_CONFIG', () => {
  it('is Station 04 with the brake control, the see-through toggle and the five presets', () => {
    expect(BRAKING_CONFIG.meta).toMatchObject({ id: 'braking', number: '04', title: 'Braking' });
    expect(BRAKING_CONFIG.control).toBe('brake');
    expect(BRAKING_CONFIG.toggles).toEqual(['brakes']);
    expect(BRAKING_CONFIG.presets).toBe(PRESETS);
    expect(BRAKING_CONFIG.presets.map((p) => p.kmh)).toEqual([150, 200, 250, 300, 330]);
  });

  it('carries no branding word and flags every guess as an estimate', () => {
    const text = `${BRAKING_CONFIG.meta.prompt} ${BRAKING_CONFIG.meta.title} ${BRAKING_CONFIG.conditions}`;
    expect(text).not.toMatch(/\bF1\b|FIA|Formula/i);
    expect(BRAKING_CONFIG.conditions).toMatch(/μ [\d.]+ est\./);
    expect(BRAKING_CONFIG.conditions).toMatch(/°C est\./);
    expect(BRAKING_CONFIG.conditions).toContain(`${ESTIMATES.brakes.apexKmh} km/h`);
    expect(BRAKING_CONFIG.conditions).toContain(`${BRAKE_DIVE_EXAGGERATION}×`);
  });
});

describe('the station object', () => {
  it('declares the intro speed, and neither a sweep nor a speed of its own', () => {
    const { station } = make();
    expect(station.config).toBe(BRAKING_CONFIG);
    expect(station.intro).toEqual({ kmh: 300, belowKmh: 200 });
    expect(station.sweep).toBeUndefined();
    expect(station.currentKmh).toBeUndefined();
    expect(typeof station.onPlayToggle).toBe('function');
    expect(typeof station.onLapScrub).toBe('function');
    expect(typeof station.onLapRate).toBe('function');
    expect(typeof station.onToggle).toBe('function');
  });

  it('shot is a stable custom camera position', () => {
    const { station } = make();
    const s = station.shot();
    expect(typeof s).toBe('object');
    expect(station.shot()).toBe(s);
  });
});

describe('enter and exit', () => {
  it('enter sets a quiet garage: no airflow, no aero arrows, no X-ray, wings shut, see-through on', () => {
    const { garage, ui } = make();
    expect(garage.setXray).toHaveBeenLastCalledWith(false);
    expect(garage.setAirflow).toHaveBeenLastCalledWith(false);
    expect(garage.setForceArrows).toHaveBeenLastCalledWith(false);
    expect(garage.setWeightArrow).toHaveBeenLastCalledWith(false);
    expect(garage.setEnergyFlow).toHaveBeenLastCalledWith(false);
    expect(garage.setAeroMode).toHaveBeenLastCalledWith('corner');
    expect(ui.setToggle).toHaveBeenCalledWith('brakes', true);
    expect(ui.setPlaying).toHaveBeenLastCalledWith(false);
  });

  it('exit switches the braking scene off and gives the aero arrows back', () => {
    const { station, garage, ui } = ready();
    station.exit();
    expect(garage.setBraking).toHaveBeenLastCalledWith(null);
    expect(garage.setForceArrows).toHaveBeenLastCalledWith(true);
    expect(garage.setAeroMode).toHaveBeenLastCalledWith('corner');
    expect(ui.setPlaying).toHaveBeenLastCalledWith(false);
  });

  it('every visit opens fresh: ready, half speed, see-through on, whatever the last visit left', () => {
    const rig = braking(300, 1);
    rig.station.onToggle!('brakes', false);
    step(rig, 0.5, 300);
    rig.station.exit();
    rig.station.enter();
    step(rig, 2 * DT, 300);
    expect(rig.last().state).toBe('ready');
    expect(rig.last().playing).toBe(false);
    expect(rig.last().rate).toBe(DEFAULT_RATE);
    const scene = rig.garage.setBraking.mock.calls.at(-1)![0]!;
    expect(scene.seeThrough).toBe(true);
    expect(rig.ui.setToggle).toHaveBeenLastCalledWith('brakes', true);
  });
});

describe('ready', () => {
  it('shows the car cruising at the slider speed: no braking, no transfer, no dive, cold discs', () => {
    const { last, station } = make();
    station.frame(DT, 300);
    const v = last();
    expect(v.state).toBe('ready');
    expect(v.kmh).toBeCloseTo(300, 6);
    expect(v.zone.fromKmh).toBe(300);
    expect(v.tS).toBe(0);
    expect(v.sM).toBe(0);
    expect(v.decelG).toBe(0);
    expect(v.brakeKw).toBe(0);
    expect(v.transferN).toBe(0);
    expect(v.noseDropMm).toBe(0);
    expect(v.frontDiscC).toBe(ESTIMATES.brakes.startDiscC);
    expect(v.harvestedMJ).toBe(0);
    expect(v.playing).toBe(false);
    expect(v.rate).toBe(DEFAULT_RATE);
    expect(v.diveExaggeration).toBe(BRAKE_DIVE_EXAGGERATION);
    expect(v.caption.length).toBeGreaterThan(0);
  });

  it('feeds the garage every frame: the scene, then the car speed and an aero state for it', () => {
    const { station, garage } = make();
    station.frame(DT, 250);
    expect(garage.setBraking).toHaveBeenCalledTimes(1);
    const scene = garage.setBraking.mock.calls[0][0]!;
    expect(scene).toMatchObject({ noseDropM: 0, tailRiseM: 0, frontDiscC: 450, rearDiscC: 450, seeThrough: true });
    expect(scene.frontLoadN).toBeCloseTo(scene.frontStaticN, 6);
    expect(garage.update).toHaveBeenCalledTimes(1);
    const [dt, kmh, aero] = garage.update.mock.calls[0];
    expect(dt).toBe(DT);
    expect(kmh).toBeCloseTo(250, 6);
    expect(aero.speedKmh).toBeCloseTo(250, 6);
  });

  it('follows the slider, rounded to whole km/h and kept inside 120 to 345', () => {
    const { station, last } = make();
    station.frame(DT, 212.4);
    expect(last().zone.fromKmh).toBe(212);
    station.frame(DT, 50);
    expect(last().zone.fromKmh).toBe(BRAKE_FROM_KMH.min);
    station.frame(DT, 350);
    expect(last().zone.fromKmh).toBe(BRAKE_FROM_KMH.max);
    station.frame(DT, 0);
    expect(last().zone.fromKmh).toBe(120);
  });

  it('while the slider eases, the zone follows; when it stops the zone is the same object frame after frame', () => {
    const { station, views } = make();
    for (const kmh of [200, 201.5, 203, 204.2]) station.frame(DT, kmh);
    expect(new Set(views.map((v) => v.zone.fromKmh))).toEqual(new Set([200, 202, 203, 204]));
    station.frame(DT, 204.2);
    station.frame(DT, 204.2);
    expect(views.at(-1)!.zone).toBe(views.at(-2)!.zone);
  });

  it('does no work when nothing changed: same view and scene objects, same caption', () => {
    const rig = make();
    step(rig, 10 * DT, 300);
    expect(new Set(rig.views).size).toBe(1);
    expect(new Set(rig.garage.setBraking.mock.calls.map((c) => c[0])).size).toBe(1);
    expect(rig.last().caption).toBe(rig.views[0].caption);
  });

  it('the ready caption does not change while the slider moves (so the live region stays quiet)', () => {
    const { station, views } = make();
    for (const kmh of [150, 200, 260, 330]) station.frame(DT, kmh);
    expect(JSON.stringify(views[0].caption)).toBe(JSON.stringify(views.at(-1)!.caption));
  });
});

describe('pressing Brake', () => {
  it('starts a stop from the slider speed at half speed, and tells the UI it is playing', () => {
    const rig = ready(300);
    rig.station.onPlayToggle!();
    expect(rig.ui.setPlaying).toHaveBeenLastCalledWith(true);
    step(rig, 1, 300);
    const v = rig.last();
    expect(v.state).toBe('braking');
    expect(v.playing).toBe(true);
    expect(v.rate).toBe(0.5);
    // 1 s of frames at half speed is about 0.5 s into the zone.
    expect(v.tS).toBeCloseTo(0.5, 1);
    expect(v.kmh).toBeLessThan(300);
    expect(v.decelG).toBeGreaterThan(3);
  });

  it('dives the nose and moves the load forward: the scene and the view say the same', () => {
    const rig = braking(300);
    step(rig, 0.3, 300);
    const v = rig.last();
    const scene = rig.garage.setBraking.mock.calls.at(-1)![0]!;
    expect(v.transferN).toBeGreaterThan(1000);
    expect(v.frontLoadN).toBeGreaterThan(v.frontStaticN);
    expect(v.rearLoadN).toBeLessThan(v.rearStaticN);
    expect(v.noseDropMm).toBeGreaterThan(3);
    expect(scene.noseDropM * 1000).toBeCloseTo(v.noseDropMm, 6);
    expect(scene.tailRiseM).toBeGreaterThan(0);
    expect(scene.frontLoadN).toBe(v.frontLoadN);
    expect(scene.rearLoadN).toBe(v.rearLoadN);
    expect(scene.frontStaticN).toBe(v.frontStaticN);
    expect(scene.rearStaticN).toBe(v.rearStaticN);
    expect(scene.frontDiscC).toBe(v.frontDiscC);
  });

  it('the harvest and heat split adds up to the brake power, harvest never above the motor limit', () => {
    const rig = braking(300, 1);
    for (let i = 0; i < 200; i++) {
      rig.station.frame(DT, 300);
      const v = rig.last();
      expect(v.harvestKw + v.heatKw).toBeCloseTo(v.brakeKw, 6);
      expect(v.harvestKw).toBeLessThanOrEqual(350 + 1e-9);
    }
  });

  it('the discs warm, the cumulative energy grows, and the car slows to the corner speed', () => {
    const rig = braking(300, 1);
    step(rig, 5, 300);
    const v = rig.last();
    expect(v.state).toBe('done');
    expect(v.kmh).toBeCloseTo(80, 6);
    expect(v.frontDiscC).toBeCloseTo(v.zone.peakFrontDiscC, 0);
    expect(v.frontDiscC).toBeGreaterThan(ESTIMATES.brakes.startDiscC + 100);
    expect(v.harvestedMJ).toBeCloseTo(v.zone.harvestMJ, 6);
    expect(v.heatMJ).toBeCloseTo(v.zone.heatMJ, 6);
    expect(v.tS).toBeCloseTo(v.zone.timeS, 9);
    expect(v.sM).toBeCloseTo(v.zone.distanceM, 6);
  });

  it('a stop takes about its own length at rate 1, twice that at 0.5, four times at 0.25', () => {
    const T = makeBrakeRun(300).zone.timeS;
    for (const [rate, mult] of [
      [1, 1],
      [0.5, 2],
      [0.25, 4],
    ] as const) {
      const rig = braking(300, rate);
      let frames = 0;
      while (rig.last()?.state !== 'done' && frames < 2000) {
        rig.station.frame(DT, 300);
        frames++;
      }
      expect(frames * DT, `rate ${rate}`).toBeGreaterThan(T * mult - 0.05);
      expect(frames * DT, `rate ${rate}`).toBeLessThan(T * mult + 0.05);
      expect(rig.ui.setPlaying).toHaveBeenLastCalledWith(false);
    }
  });

  it('is done for good: playing false, nothing moves any more', () => {
    const rig = braking(300, 1);
    step(rig, 4, 300);
    const done = rig.last();
    step(rig, 0.5, 300);
    expect(rig.last()).toBe(done);
    expect(done.playing).toBe(false);
  });

  it('when the slider is still easing, waits for it to stop, then brakes from where it stopped', () => {
    const rig = make();
    rig.station.frame(DT, 240);
    rig.station.frame(DT, 245);
    rig.station.onPlayToggle!();
    expect(rig.last().state).toBe('ready');
    rig.station.frame(DT, 248);
    expect(rig.last().state).toBe('ready');
    rig.station.frame(DT, 250);
    rig.station.frame(DT, 250);
    expect(rig.last().state).toBe('braking');
    expect(rig.last().zone.fromKmh).toBe(250);
    expect(rig.ui.setPlaying).toHaveBeenLastCalledWith(true);
  });

  it('on the very first frame (nothing settled yet) it also waits instead of braking from nowhere', () => {
    const rig = make();
    rig.station.onPlayToggle!();
    rig.station.frame(DT, 300);
    expect(rig.last().state).toBe('ready');
    rig.station.frame(DT, 300);
    expect(rig.last().state).toBe('braking');
  });
});

describe('pause and replay', () => {
  it('Brake mid-stop pauses; again resumes', () => {
    const rig = braking(300);
    step(rig, 0.5, 300);
    rig.station.onPlayToggle!();
    expect(rig.ui.setPlaying).toHaveBeenLastCalledWith(false);
    step(rig, 0.1, 300);
    const parked = rig.last();
    expect(parked.state).toBe('braking');
    expect(parked.playing).toBe(false);
    step(rig, 0.5, 300);
    expect(rig.last().tS).toBe(parked.tS);
    rig.station.onPlayToggle!();
    expect(rig.ui.setPlaying).toHaveBeenLastCalledWith(true);
    step(rig, 0.2, 300);
    expect(rig.last().tS).toBeGreaterThan(parked.tS);
    expect(rig.last().playing).toBe(true);
  });

  it('when paused the caption says so, and it is calm again once it plays on', () => {
    const rig = braking(300);
    step(rig, 0.3, 300);
    const running = rig.last().caption;
    rig.station.onPlayToggle!();
    step(rig, 2 * DT, 300);
    const paused = rig.last().caption;
    expect(paused[0].text).toMatch(/^Paused/);
    expect(paused.slice(1)).toEqual(running);
    rig.station.onPlayToggle!();
    step(rig, 2 * DT, 300);
    expect(rig.last().caption[0].text).not.toMatch(/^Paused/);
  });

  it('Brake after a stop is done plays the same stop again from the start', () => {
    const rig = braking(300, 1);
    step(rig, 4, 300);
    expect(rig.last().state).toBe('done');
    rig.station.onPlayToggle!();
    step(rig, 0.1, 300);
    const v = rig.last();
    expect(v.state).toBe('braking');
    expect(v.playing).toBe(true);
    expect(v.tS).toBeGreaterThan(0);
    expect(v.tS).toBeLessThan(0.2);
    expect(v.zone.fromKmh).toBe(300);
  });
});

describe('the slider during a stop', () => {
  it('a change while braking goes back to ready at the new speed, paused', () => {
    const rig = braking(300);
    step(rig, 0.5, 300);
    rig.station.frame(DT, 296);
    const v = rig.last();
    expect(v.state).toBe('ready');
    expect(v.playing).toBe(false);
    expect(v.zone.fromKmh).toBe(296);
    expect(v.tS).toBe(0);
    expect(v.decelG).toBe(0);
    expect(rig.ui.setPlaying).toHaveBeenLastCalledWith(false);
  });

  it('a change after a stop is done also goes back to ready', () => {
    const rig = braking(300, 1);
    step(rig, 4, 300);
    expect(rig.last().state).toBe('done');
    rig.station.frame(DT, 250);
    expect(rig.last().state).toBe('ready');
    expect(rig.last().zone.fromKmh).toBe(250);
  });

  it('a change while paused is a change too', () => {
    const rig = braking(300);
    step(rig, 0.3, 300);
    rig.station.onPlayToggle!();
    rig.station.frame(DT, 301);
    expect(rig.last().state).toBe('ready');
  });

  it('a slider that does not move never disturbs a stop', () => {
    const rig = braking(300, 1);
    step(rig, 1, 300);
    expect(rig.last().state).toBe('braking');
    expect(rig.last().zone.fromKmh).toBe(300);
  });

  it('the stop plays at its own speed: the garage sees the car slow down while the slider stays put', () => {
    const rig = braking(300, 1);
    step(rig, 2.5, 300);
    const speeds = rig.garage.update.mock.calls.map((c) => c[1]);
    expect(speeds[0]).toBeCloseTo(300, 6);
    expect(speeds.at(-1)!).toBeCloseTo(80, 6);
    expect(rig.ui.setSpeedControl).not.toHaveBeenCalled();
  });
});

describe('scrubbing', () => {
  it('parks the playhead part-way, paused, in the braking state', () => {
    const rig = ready(300);
    rig.station.onLapScrub!(1.2);
    step(rig, 0.5, 300);
    const v = rig.last();
    expect(v.state).toBe('braking');
    expect(v.playing).toBe(false);
    expect(v.tS).toBeCloseTo(1.2, 9);
    expect(v.kmh).toBeLessThan(300);
    expect(v.kmh).toBeGreaterThan(80);
    expect(rig.ui.setPlaying).toHaveBeenLastCalledWith(false);
  });

  it('pauses a stop that was playing, and Brake carries on from there', () => {
    const rig = braking(300);
    step(rig, 0.3, 300);
    rig.station.onLapScrub!(0.8);
    step(rig, 0.3, 300);
    expect(rig.last().tS).toBeCloseTo(0.8, 9);
    rig.station.onPlayToggle!();
    step(rig, 0.3, 300);
    expect(rig.last().tS).toBeGreaterThan(0.8);
  });

  it('dropped past the end it is done; dropped at the start it is ready; junk is ignored', () => {
    const rig = braking(300);
    step(rig, 0.3, 300);
    const T = rig.last().zone.timeS;
    rig.station.onLapScrub!(T + 10);
    step(rig, DT, 300);
    expect(rig.last().state).toBe('done');
    expect(rig.last().kmh).toBeCloseTo(80, 6);
    rig.station.onLapScrub!(-3);
    step(rig, DT, 300);
    expect(rig.last().state).toBe('ready');
    expect(rig.last().kmh).toBeCloseTo(300, 6);
    rig.station.onLapScrub!(1);
    rig.station.onLapScrub!(Number.NaN);
    rig.station.onLapScrub!(Number.NEGATIVE_INFINITY * 0);
    step(rig, DT, 300);
    expect(rig.last().tS).toBe(1);
  });

  it('scrubbing shows the same numbers as playing to that time', () => {
    const played = braking(300, 1);
    step(played, 1.0 - DT / 2, 300);
    played.station.onPlayToggle!();
    const scrubbed = ready(300);
    scrubbed.station.onLapScrub!(played.last().tS);
    step(scrubbed, DT, 300);
    step(played, DT, 300);
    const a = played.last();
    const b = scrubbed.last();
    expect(b.tS).toBeCloseTo(a.tS, 9);
    expect(b.kmh).toBeCloseTo(a.kmh, 9);
    expect(b.transferN).toBeCloseTo(a.transferN, 6);
    expect(b.frontDiscC).toBeCloseTo(a.frontDiscC, 9);
  });

  it('a scrub while the slider is not settled cannot leave a stop half-alive', () => {
    const rig = make();
    rig.station.frame(DT, 240);
    rig.station.onLapScrub!(0.5);
    rig.station.frame(DT, 242);
    expect(rig.last().state).toBe('ready');
    expect(rig.last().playing).toBe(false);
  });
});

describe('playback rate', () => {
  it('takes 0.25, 0.5 and 1 and shows it in the view; anything else is ignored', () => {
    const rig = ready(300);
    for (const r of [0.25, 1, 0.5]) {
      rig.station.onLapRate!(r);
      step(rig, DT, 300);
      expect(rig.last().rate).toBe(r);
    }
    rig.station.onLapRate!(2);
    rig.station.onLapRate!(0);
    rig.station.onLapRate!(Number.NaN);
    step(rig, DT, 300);
    expect(rig.last().rate).toBe(0.5);
  });

  it('a rate change mid-stop keeps the playhead where it is', () => {
    const rig = braking(300);
    step(rig, 0.4, 300);
    const t = rig.last().tS;
    rig.station.onLapRate!(1);
    step(rig, DT, 300);
    expect(rig.last().tS).toBeCloseTo(t + DT, 6);
  });
});

describe('the see-through wheels toggle', () => {
  it('starts on, follows the toggle, and is echoed to the UI', () => {
    const rig = ready(300);
    expect(rig.garage.setBraking.mock.calls.at(-1)![0]!.seeThrough).toBe(true);
    rig.station.onToggle!('brakes', false);
    expect(rig.ui.setToggle).toHaveBeenLastCalledWith('brakes', false);
    step(rig, DT, 300);
    expect(rig.garage.setBraking.mock.calls.at(-1)![0]!.seeThrough).toBe(false);
    rig.station.onToggle!('brakes', true);
    step(rig, DT, 300);
    expect(rig.garage.setBraking.mock.calls.at(-1)![0]!.seeThrough).toBe(true);
  });

  it('ignores toggles that are not its own', () => {
    const rig = ready(300);
    const calls = rig.ui.setToggle.mock.calls.length;
    rig.station.onToggle!('airflow', true);
    rig.station.onToggle!('xray', true);
    expect(rig.ui.setToggle.mock.calls.length).toBe(calls);
  });

  it('does not stop or restart a stop', () => {
    const rig = braking(300);
    step(rig, 0.3, 300);
    const t = rig.last().tS;
    rig.station.onToggle!('brakes', false);
    step(rig, DT, 300);
    expect(rig.last().tS).toBeGreaterThan(t);
    expect(rig.last().state).toBe('braking');
  });
});

describe('captions across a stop', () => {
  it('change only at the phase boundaries: ready, early, mid, late, done', () => {
    const rig = braking(300, 1);
    const caps: string[] = [];
    let n = 0;
    while (rig.last()?.state !== 'done' && n++ < 1000) {
      rig.station.frame(DT, 300);
      const k = JSON.stringify(rig.last().caption);
      if (caps.at(-1) !== k) caps.push(k);
    }
    expect(caps.length).toBe(4);
    expect(caps[0]).toMatch(/Pedal down/);
    expect(caps[1]).toMatch(/discs heat up/);
    expect(caps[2]).toMatch(/Braking eases/);
    expect(caps[3]).toMatch(/Done/);
  });

  it('every preset and the extremes produce finite numbers all the way through', () => {
    for (const kmh of [120, 150, 200, 250, 300, 330, 345]) {
      const rig = braking(kmh, 1);
      step(rig, 4, kmh);
      for (const v of rig.views) {
        for (const [k, x] of Object.entries(v)) if (typeof x === 'number') expect(Number.isFinite(x), `${kmh} ${k}`).toBe(true);
      }
      expect(rig.last().state).toBe('done');
    }
  });
});

describe('allocation discipline', () => {
  it('reuses one scene object for the garage, and one view while nothing changes', () => {
    const rig = braking(300);
    step(rig, 0.3, 300);
    rig.station.onPlayToggle!();
    step(rig, 3 * DT, 300);
    const scenes = new Set(rig.garage.setBraking.mock.calls.map((c) => c[0]));
    expect(scenes.size).toBe(1);
    const tail = rig.views.slice(-3);
    expect(new Set(tail).size).toBe(1);
  });

  it('reuses the aero state while the car speed does not change', () => {
    const rig = ready(300);
    step(rig, 5 * DT, 300);
    const aeros = new Set(rig.garage.update.mock.calls.map((c) => c[2]));
    expect(aeros.size).toBe(1);
  });
});
