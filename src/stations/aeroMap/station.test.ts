import { describe, expect, it, vi } from 'vitest';
import type { Garage, RidePose } from '../../app/garage';
import type { AeroState } from '../../physics/aero';
import { DEFAULT_SETUP, REFERENCE_RIDE, RIDE_PRESETS, SETUP_RANGE, platformAt, platformSweep } from '../../physics/aeromap';
import type { Station6View, StationView, UI } from '../../ui/types';
import type { Station } from '../types';
import { AERO_MAP_CONFIG, BOUNCE_DRAWN, clampSetup, createAeroMapStation } from './station';
import { bandOf, captionFor, captionKey, setupFacts, type CaptionContext } from './content';

// The station asks two media queries (reduced motion, the phone layout); the tests run without a DOM.
vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });

const DT = 1 / 60;
const LOW = RIDE_PRESETS.find((p) => p.id === 'low')!;
const text = (runs: { text: string }[]) => runs.map((r) => r.text).join('');

function make() {
  const poses: (RidePose | null)[] = [];
  const garage = {
    straightT: 0,
    setExploded: vi.fn(),
    setCeiling: vi.fn(),
    setXray: vi.fn(),
    setEnergyFlow: vi.fn(),
    setAirflow: vi.fn(),
    setForceArrows: vi.fn(),
    setWeightArrow: vi.fn(),
    setAeroMode: vi.fn(),
    setBraking: vi.fn(),
    setHighlight: vi.fn(),
    setRide: vi.fn((p: RidePose | null) => poses.push(p && { ...p })),
    setAeroBalance: vi.fn<(share: number | null) => void>(),
    update: vi.fn<(dt: number, kmh: number, aero: AeroState) => void>(),
  };
  const views: Station6View[] = [];
  const ui = {
    render: vi.fn((v: StationView) => {
      if (v.station === 'aeroMap') views.push(v.view);
    }),
    setToggle: vi.fn(),
  };
  const station: Station = createAeroMapStation({ garage: garage as unknown as Garage, ui: ui as unknown as UI, stage: {} as never });
  station.enter();
  const run = (seconds: number, kmh: number) => {
    for (let i = 0, n = Math.round(seconds / DT); i < n; i++) station.frame(DT, kmh);
  };
  return { station, garage, ui, views, poses, run, last: () => views[views.length - 1] };
}

describe('AERO_MAP_CONFIG', () => {
  it('is Station 06 with the speed control and the airflow toggle', () => {
    expect(AERO_MAP_CONFIG.meta).toMatchObject({ id: 'aeroMap', number: '06', title: 'Aero map' });
    expect(AERO_MAP_CONFIG.control ?? 'speed').toBe('speed');
    expect(AERO_MAP_CONFIG.toggles).toEqual(['airflow']);
  });

  it('carries no branding word, flags estimates and says the bounce is drawn bigger', () => {
    const t = `${AERO_MAP_CONFIG.meta.prompt} ${AERO_MAP_CONFIG.meta.title} ${AERO_MAP_CONFIG.conditions}`;
    expect(t).not.toMatch(/\bF1\b|FIA|Formula/i);
    expect(AERO_MAP_CONFIG.conditions).toMatch(/est\./);
    expect(AERO_MAP_CONFIG.conditions).toContain(`bounce drawn ${BOUNCE_DRAWN}×`);
  });
});

describe('clampSetup', () => {
  it('keeps set-ups inside the sliders and on their 1 mm steps', () => {
    expect(clampSetup({ frontMm: 0, rearMm: 999 })).toEqual({ frontMm: SETUP_RANGE.frontMm[0], rearMm: SETUP_RANGE.rearMm[1] });
    expect(clampSetup({ frontMm: 33.4, rearMm: 80.6 })).toEqual({ frontMm: 33, rearMm: 81 });
  });
});

describe('the station', () => {
  it('starts parked on the default set-up: dynamic = static, no downforce', () => {
    const rig = make();
    // The sim starts with a deliberate 0.5 mm nudge (so an unstable set-up can show itself); parked, it dies away.
    rig.run(2, 0);
    const v = rig.last();
    expect(v.setup).toEqual(DEFAULT_SETUP);
    expect(v.dynamic.frontMm).toBeCloseTo(DEFAULT_SETUP.frontMm, 1);
    expect(v.dynamic.rearMm).toBeCloseTo(DEFAULT_SETUP.rearMm, 1);
    expect(v.downforceN).toBe(0);
    expect(v.trajectory[0]).toMatchObject({ kmh: 0, frontMm: DEFAULT_SETUP.frontMm, rearMm: DEFAULT_SETUP.rearMm });
  });

  it('settles on the platform at speed and reports the map there', () => {
    const rig = make();
    rig.run(3, 250);
    const v = rig.last();
    const p = platformAt(250, DEFAULT_SETUP);
    expect(v.dynamic.frontMm).toBeCloseTo(p.dynamic.frontMm, 1);
    expect(v.dynamic.rearMm).toBeCloseTo(p.dynamic.rearMm, 1);
    expect(v.clA).toBeCloseTo(p.point.clA, 2);
    expect(v.downforceN).toBeCloseTo(p.downforceN, -1);
    expect(v.frontSharePct).toBeCloseTo(p.point.frontShare * 100, 1);
    expect(v.reference).toEqual(REFERENCE_RIDE);
    expect(v.bounce.unstable).toBe(false);
    expect(v.bounce.onsetKmh).toBeNull();
    // The garage poses the body by the same ride heights (to scale when there is no bounce).
    const pose = rig.poses[rig.poses.length - 1]!;
    expect(pose.frontM * 1000).toBeCloseTo(v.dynamic.frontMm, 1);
    expect(pose.rearM * 1000).toBeCloseTo(v.dynamic.rearMm, 1);
    const aero = rig.garage.update.mock.calls.at(-1)![2];
    expect(aero.downforceN).toBeCloseTo(v.downforceN, 6);
    expect(aero.surfaces.reduce((s, x) => s + x.downforceN, 0)).toBeCloseTo(v.downforceN, 3);
  });

  it('takes a new set-up (clamped), recomputes its path, and porpoises with the low preset', () => {
    const rig = make();
    rig.station.onRideHeight!({ frontMm: LOW.frontMm, rearMm: LOW.rearMm });
    rig.run(4, 290);
    const v = rig.last();
    expect(v.setup).toEqual({ frontMm: LOW.frontMm, rearMm: LOW.rearMm });
    expect(v.trajectory[0]).toMatchObject({ frontMm: LOW.frontMm, rearMm: LOW.rearMm });
    expect(v.bounce.unstable).toBe(true);
    expect(v.bounce.onsetKmh).not.toBeNull();
    expect(v.bounce.untilKmh).toBeGreaterThan(v.bounce.onsetKmh!);
    expect(v.bounce.amplitudeMm).toBeGreaterThan(0.5);
    expect(v.floor.regime).toBe('stalled');
    expect(text(v.caption)).toMatch(/Porpoising/);
    rig.station.onRideHeight!({ frontMm: -50, rearMm: 1e6 });
    rig.run(DT, 290);
    expect(rig.last().setup).toEqual({ frontMm: SETUP_RANGE.frontMm[0], rearMm: SETUP_RANGE.rearMm[1] });
  });

  it('ignores a non-finite set-up', () => {
    const rig = make();
    rig.station.onRideHeight!({ frontMm: Number.NaN, rearMm: 80 });
    rig.run(DT, 0);
    expect(rig.last().setup).toEqual(DEFAULT_SETUP);
  });

  it('hands the pose and the balance pointer back on exit', () => {
    const rig = make();
    rig.run(0.2, 200);
    rig.station.exit();
    expect(rig.garage.setRide).toHaveBeenLastCalledWith(null);
    expect(rig.garage.setAeroBalance).toHaveBeenLastCalledWith(null);
  });

  it('keeps the same caption runs while the band does not change', () => {
    const rig = make();
    rig.run(3, 250);
    const a = rig.last().caption;
    rig.run(0.5, 251);
    expect(rig.last().caption).toBe(a);
  });
});

describe('captions', () => {
  const facts = setupFacts(DEFAULT_SETUP, platformSweep(DEFAULT_SETUP, 350, 5));
  const ctx = (band: CaptionContext['band']): CaptionContext => ({ band, facts, bounceHz: 5.24, bounceDrawn: 3 });

  it('ranks the bands: parked, then bottoming, then porpoising, then the floor', () => {
    expect(bandOf({ kmh: 0, regime: 'stalled', bottoming: true, porpoising: true })).toBe('parked');
    expect(bandOf({ kmh: 300, regime: 'stalled', bottoming: true, porpoising: true })).toBe('bottoming');
    expect(bandOf({ kmh: 300, regime: 'stalled', bottoming: false, porpoising: true })).toBe('porpoising');
    expect(bandOf({ kmh: 300, regime: 'peak', bottoming: false, porpoising: false })).toBe('peak');
  });

  it('quote the set-up’s own squat and balance shift at 300 km/h', () => {
    const p0 = platformAt(0, DEFAULT_SETUP);
    const p300 = platformAt(300, DEFAULT_SETUP);
    expect(facts.squatFrontMm).toBeCloseTo(p0.dynamic.frontMm - p300.dynamic.frontMm, 6);
    expect(facts.squatRearMm).toBeCloseTo(p0.dynamic.rearMm - p300.dynamic.rearMm, 6);
    const t = text(captionFor(ctx('attached')));
    expect(t).toContain(`${Math.round(facts.squatFrontMm)} mm front, ${Math.round(facts.squatRearMm)} mm rear`);
    expect(t).toMatch(/more downforce, balance [\d.]+ points? forward/);
  });

  it('name the bounce to the nearest half hertz and say how it is drawn', () => {
    const t = text(captionFor(ctx('porpoising')));
    expect(t).toContain('5.0 Hz');
    expect(t).toContain('drawn 3× bigger');
    expect(text(captionFor({ ...ctx('porpoising'), bounceDrawn: 0 }))).toContain('(not animated)');
  });

  it('stay short enough for a phone’s three caption lines (≤ 160 characters)', () => {
    for (const band of ['parked', 'attached', 'peak', 'stalled', 'porpoising', 'bottoming'] as const) {
      expect(text(captionFor(ctx(band))).length).toBeLessThanOrEqual(160);
    }
  });

  it('never say the floor sucks harder when the set-up loses downforce at speed', () => {
    const past = { frontMm: 40, rearMm: 55 };
    const f = setupFacts(past, platformSweep(past, 350, 5));
    expect(f.downforceGain).toBeLessThan(0);
    const t = text(captionFor({ ...ctx('attached'), facts: f }));
    expect(t).not.toMatch(/sucks harder/);
    expect(t).toMatch(/less downforce/);
  });

  it('have a line for every band, and a key that only changes with what the text quotes', () => {
    for (const band of ['parked', 'attached', 'peak', 'stalled', 'porpoising', 'bottoming'] as const) {
      expect(text(captionFor(ctx(band))).length).toBeGreaterThan(40);
    }
    expect(captionKey(ctx('attached'), 1)).toBe(captionKey({ ...ctx('attached'), bounceHz: 9 }, 1));
    expect(captionKey(ctx('attached'), 1)).not.toBe(captionKey(ctx('attached'), 2));
    expect(captionKey(ctx('porpoising'), 1)).not.toBe(captionKey({ ...ctx('porpoising'), bounceHz: 6 }, 1));
  });
});
