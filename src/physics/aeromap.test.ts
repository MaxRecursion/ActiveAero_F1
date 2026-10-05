import { describe, expect, it } from 'vitest';
import { aeroFrontShare } from './aero';
import {
  AEROMAP,
  DEFAULT_SETUP,
  DIFFUSER_ANGLE_RAD,
  FLOOR_SAMPLES,
  MAP_RANGE,
  REFERENCE_RIDE,
  RIDE_PRESETS,
  SETUP_RANGE,
  aeroMapAt,
  aeroMapGrid,
  bodyModes,
  bounceModes,
  createBounceSim,
  eigenvalues,
  floorCurve,
  floorPressure,
  floorSectionAt,
  platformAt,
  platformSweep,
  porpoiseOnsetKmh,
  porpoiseRangeKmh,
} from './aeromap';
import { ESTIMATES } from './constants';
import type { RideHeights } from '../ui/types';

const FL = AEROMAP.floor;
const LOW = RIDE_PRESETS[1];
const HIGH_RAKE = RIDE_PRESETS[2];
const rh = (frontMm: number, rearMm: number): RideHeights => ({ frontMm, rearMm });
const floorOf = (p: ReturnType<typeof aeroMapAt>) => p.surfaces[1];

/** Relative change of ClA (%) and balance change (points of front share) between two attitudes. */
const pct = (a: RideHeights, b: RideHeights) => ((aeroMapAt(a).clA - aeroMapAt(b).clA) / aeroMapAt(REFERENCE_RIDE).clA) * 100;
const pts = (a: RideHeights, b: RideHeights) => (aeroMapAt(a).frontShare - aeroMapAt(b).frontShare) * 100;
const R = REFERENCE_RIDE;
const sens = {
  /** % ClA per mm when both axles go down 1 mm (central difference). */
  lowerBoth: pct(rh(R.frontMm - 1, R.rearMm - 1), rh(R.frontMm + 1, R.rearMm + 1)) / 2,
  lowerFront: pct(rh(R.frontMm - 1, R.rearMm), rh(R.frontMm + 1, R.rearMm)) / 2,
  raiseRear: pct(rh(R.frontMm, R.rearMm + 1), rh(R.frontMm, R.rearMm - 1)) / 2,
  /** Points of front share per mm of h_F and of h_R. */
  balancePerFrontMm: pts(rh(R.frontMm + 1, R.rearMm), rh(R.frontMm - 1, R.rearMm)) / 2,
  balancePerRearMm: pts(rh(R.frontMm, R.rearMm + 1), rh(R.frontMm, R.rearMm - 1)) / 2,
};

/** Lowest speed with an unstable mode on a 1 km/h scan (null if none), and the speeds that are unstable. */
function unstableSpeeds(setup: RideHeights): number[] {
  const out: number[] = [];
  for (let v = 0; v <= 350; v += 1) if (bounceModes(v, setup).unstable) out.push(v);
  return out;
}

describe('aero map at the reference point (target 1)', () => {
  const p = aeroMapAt(REFERENCE_RIDE);

  it('reproduces the constant model the other stations use', () => {
    expect(p.clA).toBeCloseTo(ESTIMATES.clA, 3);
    expect(Math.abs(p.clA - 3.2)).toBeLessThanOrEqual(0.001);
    expect(Math.abs(p.cdA - 1.1)).toBeLessThanOrEqual(0.001);
    ESTIMATES.surfaces.forEach((s, i) => {
      expect(p.surfaces[i].id).toBe(s.id);
      expect(Math.abs(p.surfaces[i].clA / p.clA - s.share)).toBeLessThanOrEqual(0.001);
    });
    expect(p.surfaces[0].cpX).toBe(ESTIMATES.surfaces[0].cpX);
    expect(p.surfaces[2].cpX).toBe(ESTIMATES.surfaces[2].cpX);
  });

  it('puts the floor centre of pressure at −0.45 m and the balance on aeroFrontShare()', () => {
    expect(Math.abs(floorOf(p).cpX - -0.45)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(p.frontShare - aeroFrontShare())).toBeLessThanOrEqual(0.0005);
  });

  it('has a throat suction in the range Ruhrmann measured (−1.3 … −2.4)', () => {
    expect(p.floor.throatCp).toBeLessThan(-1);
    expect(p.floor.throatCp).toBeGreaterThan(-2.5);
    expect(p.floor.regime).toBe('attached');
  });
});

describe('reference and default set-up (targets 2–4)', () => {
  it('reference = the default set-up at 250 km/h, rounded to 0.5 mm', () => {
    const d = platformAt(250, DEFAULT_SETUP).dynamic;
    expect(Math.abs(d.frontMm - REFERENCE_RIDE.frontMm)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(d.rearMm - REFERENCE_RIDE.rearMm)).toBeLessThanOrEqual(1.5);
    expect(Math.round(d.frontMm * 2) / 2).toBe(REFERENCE_RIDE.frontMm);
    expect(Math.round(d.rearMm * 2) / 2).toBe(REFERENCE_RIDE.rearMm);
  });

  it('default static set-up sits inside the Legality-Setup plausibility window', () => {
    expect(RIDE_PRESETS[0]).toMatchObject(DEFAULT_SETUP);
    expect(DEFAULT_SETUP.frontMm).toBeGreaterThanOrEqual(33);
    expect(DEFAULT_SETUP.frontMm).toBeLessThanOrEqual(63);
    expect(DEFAULT_SETUP.rearMm).toBeGreaterThanOrEqual(70);
    expect(DEFAULT_SETUP.rearMm).toBeLessThanOrEqual(130);
  });

  it('default never porpoises and the plank stays off the ground to 350 km/h', () => {
    expect(unstableSpeeds(DEFAULT_SETUP)).toEqual([]);
    expect(porpoiseOnsetKmh(DEFAULT_SETUP)).toBeNull();
    for (let v = 0; v <= 350; v += 5) {
      const p = platformAt(v, DEFAULT_SETUP);
      expect(p.plankClearanceMm).toBeGreaterThan(0);
      expect(p.bottoming).toBe(false);
      expect(p.plankContactN).toBe(0);
    }
  });

  it('squats 15–30 mm at the front and 20–40 mm at the rear at 300 km/h', () => {
    const d = platformAt(300, DEFAULT_SETUP).dynamic;
    const front = DEFAULT_SETUP.frontMm - d.frontMm;
    const rear = DEFAULT_SETUP.rearMm - d.rearMm;
    expect(front).toBeGreaterThanOrEqual(15);
    expect(front).toBeLessThanOrEqual(30);
    expect(rear).toBeGreaterThanOrEqual(20);
    expect(rear).toBeLessThanOrEqual(40);
  });
});

describe('ride-height sensitivities at the reference (target 5)', () => {
  it('gains 0.2–0.6 % ClA per mm lower, front or both (GP2 map: ≈ 0.48 %/mm)', () => {
    expect(sens.lowerBoth).toBeGreaterThanOrEqual(0.2);
    expect(sens.lowerBoth).toBeLessThanOrEqual(0.6);
    expect(sens.lowerFront).toBeGreaterThanOrEqual(0.2);
    expect(sens.lowerFront).toBeLessThanOrEqual(0.6);
  });

  it('barely changes ClA when only the rear goes up', () => {
    expect(sens.raiseRear).toBeGreaterThanOrEqual(-0.4);
    expect(sens.raiseRear).toBeLessThanOrEqual(0.2);
  });

  it('moves the balance forward when the front is lowered or the rear raised (GP2: −0.29 / +0.13)', () => {
    expect(sens.balancePerFrontMm).toBeGreaterThanOrEqual(-0.35);
    expect(sens.balancePerFrontMm).toBeLessThanOrEqual(-0.1);
    expect(sens.balancePerRearMm).toBeGreaterThanOrEqual(0.02);
    expect(sens.balancePerRearMm).toBeLessThanOrEqual(0.2);
  });
});

describe('floor curve (target 6)', () => {
  const thetaD = DIFFUSER_ANGLE_RAD;
  const peakMm = (FL.peakEta * FL.channelHalfWidthM * thetaD) / 1e-3;
  const level = (hMm: number) => floorOf(aeroMapAt(rh(hMm, hMm))).clA;
  const etaToMm = (eta: number) => (eta * FL.channelHalfWidthM * thetaD) / 1e-3;

  it('passes through Ruhrmann’s digitised 10° curve', () => {
    FL.ruhrmannEta.forEach((eta, i) => expect(floorCurve(eta)).toBeCloseTo(FL.ruhrmannCl[i], 10));
  });

  it('has a single maximum, at 0.7·d_eff·θ_d, for a level floor', () => {
    let best = 0;
    let bestH = 0;
    let maxima = 0;
    let prev = level(1);
    let rising = true;
    for (let h = 1.1; h <= 200; h += 0.1) {
      const v = level(h);
      if (v > best) {
        best = v;
        bestH = h;
      }
      if (rising && v < prev - 1e-12) {
        maxima++;
        rising = false;
      } else if (!rising && v > prev + 1e-12) rising = true;
      prev = v;
    }
    expect(maxima).toBe(1);
    expect(Math.abs(bestH - peakMm)).toBeLessThanOrEqual(0.15);
    expect(aeroMapAt(rh(peakMm, peakMm)).floor.peakGapMm).toBeCloseTo(peakMm, 6);
  });

  it('keeps the measured shape within ±3 % when normalised by its maximum', () => {
    const top = level(peakMm);
    FL.ruhrmannEta.forEach((eta, i) => {
      const model = level(etaToMm(eta)) / top;
      const data = FL.ruhrmannCl[i] / 1.72;
      expect(Math.abs(model - data)).toBeLessThanOrEqual(0.03 * data);
    });
  });

  it('enhances above the peak and loses downforce sharply just below it (0.47 → 0.43)', () => {
    const top = level(peakMm);
    expect(level(etaToMm(1.0))).toBeLessThan(top);
    expect(level(etaToMm(2.0))).toBeLessThan(level(etaToMm(1.0)));
    const drop = 1 - level(etaToMm(0.43)) / level(etaToMm(0.47));
    expect(drop).toBeGreaterThan(0.15);
    expect(etaToMm(0.47) - etaToMm(0.43)).toBeLessThan(2.5); // within about 2 mm of throat gap
  });
});

describe('porpoising presets (target 7)', () => {
  it('the low 2022-style set-up porpoises between 180 and 320 km/h at 3.5–7 Hz, on the stall side', () => {
    const onset = porpoiseOnsetKmh(LOW);
    expect(onset).not.toBeNull();
    expect(onset!).toBeGreaterThanOrEqual(180);
    expect(onset!).toBeLessThanOrEqual(320);
    const mode = bounceModes(onset! + 0.5, LOW);
    expect(mode.unstable).toBe(true);
    expect(mode.frequencyHz).toBeGreaterThanOrEqual(3.5);
    expect(mode.frequencyHz).toBeLessThanOrEqual(7);
    const p = platformAt(onset!, LOW);
    expect(p.point.floor.regime).toBe('stalled');
    expect(p.plankClearanceMm).toBeGreaterThan(0);
    expect(bounceModes(onset! - 1, LOW).unstable).toBe(false);
  });

  it('reports the low set-up’s porpoising as a window that closes again, and none for the others', () => {
    const w = porpoiseRangeKmh(LOW)!;
    expect(w[0]).toBe(porpoiseOnsetKmh(LOW));
    expect(w[1]).toBeGreaterThan(w[0]);
    expect(bounceModes((w[0] + w[1]) / 2, LOW).unstable).toBe(true);
    expect(bounceModes(w[1] + 2, LOW).unstable).toBe(false);
    expect(porpoiseRangeKmh(DEFAULT_SETUP)).toBeNull();
    expect(porpoiseRangeKmh(HIGH_RAKE)).toBeNull();
  });

  it('the high-rake set-up is stable to 350 km/h', () => {
    expect(unstableSpeeds(HIGH_RAKE)).toEqual([]);
    expect(porpoiseOnsetKmh(HIGH_RAKE)).toBeNull();
  });

  it('is damped when parked: heave ≈ 4 Hz, pitch ≈ 6 Hz', () => {
    const modes = bodyModes(0, DEFAULT_SETUP);
    expect(modes).toHaveLength(2);
    expect(modes[0].frequencyHz).toBeGreaterThan(3.5);
    expect(modes[0].frequencyHz).toBeLessThan(4.5);
    expect(modes[1].frequencyHz).toBeGreaterThan(5);
    expect(modes[1].frequencyHz).toBeLessThan(7);
    for (const m of modes) expect(m.dampingRatio).toBeGreaterThan(0.25);
    expect(bounceModes(0, DEFAULT_SETUP).dampingRatio).toBeCloseTo(Math.min(...modes.map((m) => m.dampingRatio)), 12);
  });
});

describe('drag (target 8)', () => {
  it('stays within a few % of 1.1 m² where the car runs', () => {
    for (const setup of RIDE_PRESETS) {
      const limit = setup.id === 'low' ? 0.065 : 0.06; // the low set-up ends stalled, on its plank
      for (const p of platformSweep(setup, 350, 5)) {
        expect(Math.abs(p.point.cdA / 1.1 - 1)).toBeLessThan(limit);
      }
    }
  });

  it('stays within −10 … +5 % of 1.1 m² on every slider set-up’s path to 350 km/h, and on the chart', () => {
    // A whole-car drag-per-downforce ratio (GP2 map, Gadola 2022) keeps drag far flatter than downforce.
    const within = (cdA: number) => {
      expect(cdA / 1.1 - 1).toBeGreaterThan(-0.12);
      expect(cdA / 1.1 - 1).toBeLessThan(0.05);
    };
    for (let f = SETUP_RANGE.frontMm[0]; f <= SETUP_RANGE.frontMm[1]; f += 5) {
      for (let r = SETUP_RANGE.rearMm[0]; r <= SETUP_RANGE.rearMm[1]; r += 5) {
        for (const p of platformSweep({ frontMm: f, rearMm: r }, 350, 10)) {
          expect(p.point.cdA / 1.1 - 1).toBeGreaterThan(-0.1);
          expect(p.point.cdA / 1.1 - 1).toBeLessThan(0.05);
        }
      }
    }
    const g = aeroMapGrid(60, 60);
    for (let i = 0; i < g.cdA.length; i++) within(g.cdA[i]);
  });

  it('keeps every slider set-up’s path from rest to 350 km/h on the chart', () => {
    for (let f = SETUP_RANGE.frontMm[0]; f <= SETUP_RANGE.frontMm[1]; f += 5) {
      for (let r = SETUP_RANGE.rearMm[0]; r <= SETUP_RANGE.rearMm[1]; r += 5) {
        for (const p of platformSweep({ frontMm: f, rearMm: r }, 350, 10)) {
          expect(p.dynamic.frontMm).toBeGreaterThanOrEqual(MAP_RANGE.frontMm[0]);
          expect(p.dynamic.frontMm).toBeLessThanOrEqual(MAP_RANGE.frontMm[1]);
          expect(p.dynamic.rearMm).toBeGreaterThanOrEqual(MAP_RANGE.rearMm[0]);
          expect(p.dynamic.rearMm).toBeLessThanOrEqual(MAP_RANGE.rearMm[1]);
        }
      }
    }
  });
});

describe('floor pressure (target 9)', () => {
  const integrate = (fp: ReturnType<typeof floorPressure>) => {
    let sum = 0;
    let moment = 0;
    const nFlat = FLOOR_SAMPLES - 48;
    for (const [from, to] of [
      [0, nFlat],
      [nFlat, FLOOR_SAMPLES],
    ]) {
      for (let i = from; i < to - 1; i++) {
        const dx = fp.x[i] - fp.x[i + 1];
        const a = -fp.cp[i] * fp.widthM[i];
        const b = -fp.cp[i + 1] * fp.widthM[i + 1];
        sum += 0.5 * (a + b) * dx;
        moment += 0.5 * (a * fp.x[i] + b * fp.x[i + 1]) * dx;
      }
    }
    return { sum, cpX: moment / sum };
  };

  /** Midpoint rule on a fine grid through floorSectionAt (independent of the sample placement). */
  const fine = (r: RideHeights) => {
    const n = 20000;
    let sum = 0;
    let moment = 0;
    for (const [a, b] of [
      [FL.leadingEdgeX, FL.throatX],
      [FL.throatX, FL.exitX],
    ]) {
      const dx = (a - b) / n;
      for (let i = 0; i < n; i++) {
        const x = a - (i + 0.5) * dx;
        const s = floorSectionAt(r, x);
        sum += -s.cp * s.widthM * dx;
        moment += -s.cp * s.widthM * x * dx;
      }
    }
    return { sum, cpX: moment / sum };
  };

  it('samples the floor from the leading edge to the exit, reusing arrays when asked', () => {
    const fp = floorPressure(REFERENCE_RIDE);
    expect(fp.x).toHaveLength(FLOOR_SAMPLES);
    expect(fp.x[0]).toBeCloseTo(FL.leadingEdgeX, 12);
    expect(fp.x[FLOOR_SAMPLES - 1]).toBeCloseTo(FL.exitX, 12);
    for (let i = 1; i < FLOOR_SAMPLES; i++) expect(fp.x[i]).toBeLessThanOrEqual(fp.x[i - 1]);
    const out = { x: new Float64Array(FLOOR_SAMPLES), cp: new Float64Array(FLOOR_SAMPLES), widthM: new Float64Array(FLOOR_SAMPLES) };
    const again = floorPressure(rh(30, 80), out);
    expect(again.x).toBe(out.x);
    expect(again.cp).toBe(out.cp);
    expect(again.throatX).toBe(FL.throatX);
    expect(again.exitX).toBe(FL.exitX);
  });

  it('when attached: exit at −0.20, deepest suction at the throat, no separation', () => {
    const fp = floorPressure(REFERENCE_RIDE);
    expect(fp.cp[FLOOR_SAMPLES - 1]).toBeCloseTo(FL.exitCp, 10);
    expect(fp.separationX).toBeNull();
    let iMin = 0;
    for (let i = 1; i < FLOOR_SAMPLES; i++) if (fp.cp[i] < fp.cp[iMin]) iMin = i;
    expect(Math.abs(fp.x[iMin] - fp.throatX)).toBeLessThanOrEqual(0.05);
    expect(fp.cp[iMin]).toBeCloseTo(fp.throatCp, 10);
  });

  it('integrates to the floor’s ClA and centre of pressure', () => {
    for (const r of [REFERENCE_RIDE, DEFAULT_SETUP, rh(12, 30), rh(20, 20), rh(35, 125), rh(10, 140)]) {
      const p = aeroMapAt(r);
      const fp = floorPressure(r);
      const s = integrate(fp);
      expect(Math.abs(s.sum / floorOf(p).clA - 1)).toBeLessThan(1e-9);
      expect(s.cpX).toBeCloseTo(floorOf(p).cpX, 9);
      const f = fine(r);
      expect(Math.abs(f.sum / floorOf(p).clA - 1)).toBeLessThan(0.005);
      expect(Math.abs(f.cpX - floorOf(p).cpX)).toBeLessThan(0.01);
    }
  });

  it('when stalled: a flat plateau from the separation point to the exit', () => {
    const r = rh(20, 20); // level, throat gap 20 mm: η ≈ 0.37
    const p = aeroMapAt(r);
    expect(p.floor.regime).toBe('stalled');
    const fp = floorPressure(r);
    expect(fp.separationX).not.toBeNull();
    expect(fp.separationX!).toBeLessThan(FL.throatX);
    expect(fp.separationX!).toBeGreaterThan(FL.exitX);
    const plateau = fp.cp[FLOOR_SAMPLES - 1];
    expect(plateau).toBeLessThan(FL.exitCp);
    expect(plateau).toBeGreaterThan(FL.stalledCp);
    let n = 0;
    for (let i = 0; i < FLOOR_SAMPLES; i++) {
      if (fp.x[i] < fp.separationX!) {
        expect(fp.cp[i]).toBeCloseTo(plateau, 12);
        n++;
      }
    }
    expect(n).toBeGreaterThan(5);
  });
});

describe('robustness (target 10)', () => {
  it('is finite everywhere: map over 0–100 × 0–200 mm', () => {
    for (let f = 0; f <= 100; f += 2) {
      for (let r = 0; r <= 200; r += 2) {
        const p = aeroMapAt(rh(f, r));
        const nums = [p.clA, p.cdA, p.frontShare, p.pitchDeg, p.floor.eta, p.floor.throatCp, p.floor.peakGapMm, p.plankClearanceMm];
        for (const s of p.surfaces) nums.push(s.clA, s.cpX);
        for (const v of nums) expect(Number.isFinite(v)).toBe(true);
        expect(p.clA).toBeGreaterThan(0);
        if (f % 10 === 0 && r % 10 === 0) {
          const fp = floorPressure(rh(f, r));
          for (let i = 0; i < FLOOR_SAMPLES; i++) expect(Number.isFinite(fp.cp[i])).toBe(true);
        }
      }
    }
  });

  it('is finite everywhere: platform and modes from 0 to 360 km/h', () => {
    const setups = [
      ...RIDE_PRESETS,
      rh(SETUP_RANGE.frontMm[0], SETUP_RANGE.rearMm[0]),
      rh(SETUP_RANGE.frontMm[1], SETUP_RANGE.rearMm[0]),
      rh(SETUP_RANGE.frontMm[0], SETUP_RANGE.rearMm[1]),
      rh(SETUP_RANGE.frontMm[1], SETUP_RANGE.rearMm[1]),
      rh(0, 0),
      rh(100, 200),
    ];
    for (const s of setups) {
      for (const v of [0, 60, 180, 270, 360]) {
        const p = platformAt(v, s);
        for (const x of [p.dynamic.frontMm, p.dynamic.rearMm, p.downforceN, p.dragN, p.plankClearanceMm, p.plankContactN]) {
          expect(Number.isFinite(x)).toBe(true);
        }
        const m = bounceModes(v, s);
        expect(Number.isFinite(m.frequencyHz)).toBe(true);
        expect(Number.isFinite(m.dampingRatio)).toBe(true);
      }
    }
  });
});

describe('continuity of the map', () => {
  /** Largest step in a quantity along a line of attitudes, split by whether the step touches the cliff. */
  function maxSteps(line: (t: number) => RideHeights, from: number, to: number) {
    const dt = 0.02;
    let prev = aeroMapAt(line(from));
    const out = { clA: 0, cliffClA: 0, frontShare: 0, cdA: 0 };
    for (let t = from + dt; t <= to; t += dt) {
      const p = aeroMapAt(line(t));
      const cliff = [p.floor.eta, prev.floor.eta].some((e) => e > 0.42 && e < 0.48);
      const d = Math.abs(p.clA - prev.clA);
      if (cliff) out.cliffClA = Math.max(out.cliffClA, d);
      else out.clA = Math.max(out.clA, d);
      out.frontShare = Math.max(out.frontShare, Math.abs(p.frontShare - prev.frontShare));
      out.cdA = Math.max(out.cdA, Math.abs(p.cdA - prev.cdA));
      prev = p;
    }
    return out;
  }

  it('has no jumps: ClA moves < 0.002 per 0.02 mm, except on the measured cliff (< 0.01)', () => {
    for (const f of [0, 12, 27, 45, 60]) {
      const s = maxSteps((t) => rh(f, t), MAP_RANGE.rearMm[0], MAP_RANGE.rearMm[1]);
      expect(s.clA).toBeLessThan(0.002);
      expect(s.cliffClA).toBeLessThan(0.01);
      expect(s.frontShare).toBeLessThan(0.002);
      expect(s.cdA).toBeLessThan(0.002);
    }
    for (const r of [15, 30, 73, 120]) {
      const s = maxSteps((t) => rh(t, r), MAP_RANGE.frontMm[0], MAP_RANGE.frontMm[1]);
      expect(s.clA).toBeLessThan(0.002);
      expect(s.cliffClA).toBeLessThan(0.01);
      expect(s.frontShare).toBeLessThan(0.002);
      expect(s.cdA).toBeLessThan(0.002);
    }
  });
});

describe('platform', () => {
  it('equals the static set-up when parked', () => {
    for (const s of [...RIDE_PRESETS, rh(22, 47)]) {
      const p = platformAt(0, s);
      expect(p.dynamic.frontMm).toBeCloseTo(s.frontMm, 9);
      expect(p.dynamic.rearMm).toBeCloseTo(s.rearMm, 9);
      expect(p.downforceN).toBe(0);
      expect(p.dragN).toBe(0);
    }
  });

  it('squats monotonically with speed', () => {
    const sweep = platformSweep(DEFAULT_SETUP, 350, 5);
    expect(sweep).toHaveLength(71);
    for (let i = 1; i < sweep.length; i++) {
      expect(sweep[i].dynamic.frontMm).toBeLessThan(sweep[i - 1].dynamic.frontMm);
      expect(sweep[i].dynamic.rearMm).toBeLessThan(sweep[i - 1].dynamic.rearMm);
    }
  });

  it('balances springs against aero load and moves load rearward with drag', () => {
    const p = platformAt(300, DEFAULT_SETUP);
    const total = p.surfaces.reduce((n, s) => n + s.downforceN, 0);
    expect(total).toBeCloseTo(p.downforceN, 6);
    expect(p.frontAxleAeroN + p.rearAxleAeroN).toBeCloseTo(p.downforceN, 6);
    const B = ESTIMATES.brakes;
    expect((DEFAULT_SETUP.frontMm - p.dynamic.frontMm) * B.frontAxleRateNPerMm).toBeCloseTo(p.frontAxleAeroN, 3);
    expect((DEFAULT_SETUP.rearMm - p.dynamic.rearMm) * B.rearAxleRateNPerMm).toBeCloseTo(p.rearAxleAeroN, 3);
    // Drag pitches the car nose-up: the front carries less than its aero share.
    expect(p.frontAxleAeroN / p.downforceN).toBeLessThan(p.point.frontShare);
    expect(p.dragPowerW).toBeCloseTo((p.dragN * 300) / 3.6, 6);
  });

  it('lands the plank and lets it carry load when the set-up is too low', () => {
    const p = platformAt(350, LOW);
    expect(p.bottoming).toBe(true);
    expect(p.plankClearanceMm).toBe(0);
    expect(p.plankContactN).toBeGreaterThan(0);
  });
});

describe('eigenvalue solver', () => {
  const sorted = (re: Float64Array, im: Float64Array) =>
    Array.from(re, (r, i) => [r, im[i]] as const).sort((a, b) => a[1] - b[1] || a[0] - b[0]);

  it('matches the analytic 1-DOF mass-spring-damper', () => {
    const m = 300;
    const k = 2.5e5;
    const zeta = 0.3;
    const c = 2 * zeta * Math.sqrt(k * m);
    const wn = Math.sqrt(k / m);
    const { re, im } = eigenvalues([0, 1, -k / m, -c / m], 2);
    const ev = sorted(re, im);
    expect(ev[0][0]).toBeCloseTo(-zeta * wn, 9);
    expect(ev[1][0]).toBeCloseTo(-zeta * wn, 9);
    expect(ev[1][1]).toBeCloseTo(wn * Math.sqrt(1 - zeta * zeta), 9);
    expect(ev[0][1]).toBeCloseTo(-wn * Math.sqrt(1 - zeta * zeta), 9);
  });

  it('finds real roots of an overdamped system', () => {
    const { re, im } = eigenvalues([0, 1, -6, -5], 2); // s² + 5s + 6 = (s + 2)(s + 3)
    const ev = Array.from(re).sort((a, b) => a - b);
    expect(ev[0]).toBeCloseTo(-3, 10);
    expect(ev[1]).toBeCloseTo(-2, 10);
    for (const v of im) expect(v).toBeCloseTo(0, 10);
  });

  it('recovers known roots of a 6×6 companion matrix with widely spread magnitudes', () => {
    const roots: [number, number][] = [
      [-1, 2],
      [-1, -2],
      [-0.3, 30],
      [-0.3, -30],
      [-5, 0],
      [0.5, 0],
    ];
    // Monic polynomial coefficients from the roots (complex multiply, imaginary parts cancel).
    let pr = [1];
    let pi = [0];
    for (const [a, b] of roots) {
      const nr = new Array(pr.length + 1).fill(0);
      const ni = new Array(pr.length + 1).fill(0);
      for (let i = 0; i < pr.length; i++) {
        nr[i] += pr[i];
        ni[i] += pi[i];
        nr[i + 1] -= a * pr[i] - b * pi[i];
        ni[i + 1] -= a * pi[i] + b * pr[i];
      }
      pr = nr;
      pi = ni;
    }
    const n = 6;
    const A = new Float64Array(n * n);
    for (let j = 0; j < n; j++) A[j] = -pr[j + 1];
    for (let i = 1; i < n; i++) A[i * n + i - 1] = 1;
    const { re, im } = eigenvalues(A, n);
    const got = sorted(re, im);
    const want = [...roots].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    got.forEach(([r, i], k) => {
      expect(r).toBeCloseTo(want[k][0], 6);
      expect(i).toBeCloseTo(want[k][1], 6);
    });
  });
});

describe('bounce simulation', () => {
  const run = (setup: RideHeights, kmh: number, seconds: number, every = 0.5) => {
    const sim = createBounceSim();
    sim.reset(setup, kmh);
    const amp: number[] = [];
    const dt = 1 / 60;
    const steps = Math.round(seconds / dt);
    const per = Math.round(every / dt);
    for (let i = 1; i <= steps; i++) {
      sim.step(dt, kmh, setup);
      if (i % per === 0) amp.push(sim.amplitudeMm);
    }
    return { sim, amp };
  };

  it('settles on the platform when the set-up is stable', () => {
    const { sim, amp } = run(DEFAULT_SETUP, 300, 4);
    const eq = platformAt(300, DEFAULT_SETUP).dynamic;
    expect(amp.at(-1)!).toBeLessThan(0.01);
    expect(sim.rideHeights.frontMm).toBeCloseTo(eq.frontMm, 2);
    expect(sim.rideHeights.rearMm).toBeCloseTo(eq.rearMm, 2);
  });

  it('grows into a bounded limit cycle when it porpoises', () => {
    const kmh = 290;
    expect(bounceModes(kmh, LOW).unstable).toBe(true);
    const { sim, amp } = run(LOW, kmh, 10);
    expect(amp[1]).toBeLessThan(amp[5]); // 1 s vs 3 s: growing
    const last = amp.at(-1)!;
    expect(last).toBeGreaterThan(1);
    expect(last).toBeLessThan(10);
    expect(Math.abs(amp.at(-3)! / last - 1)).toBeLessThan(0.05); // settled into a cycle
    expect(Number.isFinite(sim.rideHeights.frontMm)).toBe(true);
    expect(Number.isFinite(sim.rideHeights.rearMm)).toBe(true);
  });

  it('is deterministic and keeps returning the same ride-height object', () => {
    const a = run(LOW, 290, 2).sim;
    const b = run(LOW, 290, 2).sim;
    expect(a.rideHeights.frontMm).toBe(b.rideHeights.frontMm);
    expect(a.rideHeights.rearMm).toBe(b.rideHeights.rearMm);
    expect(a.rideHeights).toBe(a.rideHeights);
  });

  it('follows a set-up change', () => {
    const sim = createBounceSim();
    sim.reset(DEFAULT_SETUP, 200);
    for (let i = 0; i < 300; i++) sim.step(1 / 60, 200, HIGH_RAKE);
    const eq = platformAt(200, HIGH_RAKE).dynamic;
    expect(sim.rideHeights.frontMm).toBeCloseTo(eq.frontMm, 2);
    expect(sim.rideHeights.rearMm).toBeCloseTo(eq.rearMm, 2);
  });
});

describe('map grid', () => {
  it('samples MAP_RANGE row-major [rear][front] and agrees with aeroMapAt', () => {
    const nF = 7;
    const nR = 5;
    const g = aeroMapGrid(nF, nR);
    expect(g.front).toHaveLength(nF);
    expect(g.rear).toHaveLength(nR);
    for (const a of [g.clA, g.cdA, g.frontShare, g.regime, g.plankOnGround]) expect(a).toHaveLength(nF * nR);
    expect(g.front[0]).toBe(MAP_RANGE.frontMm[0]);
    expect(g.front[nF - 1]).toBe(MAP_RANGE.frontMm[1]);
    expect(g.rear[0]).toBe(MAP_RANGE.rearMm[0]);
    expect(g.rear[nR - 1]).toBe(MAP_RANGE.rearMm[1]);
    for (let i = 1; i < nF; i++) expect(g.front[i]).toBeGreaterThan(g.front[i - 1]);
    for (let j = 1; j < nR; j++) expect(g.rear[j]).toBeGreaterThan(g.rear[j - 1]);
    const code = { attached: 0, peak: 1, stalled: 2 } as const;
    for (let j = 0; j < nR; j++) {
      for (let i = 0; i < nF; i++) {
        const p = aeroMapAt(rh(g.front[i], g.rear[j]));
        const k = j * nF + i;
        expect(g.clA[k]).toBeCloseTo(p.clA, 5);
        expect(g.cdA[k]).toBeCloseTo(p.cdA, 5);
        expect(g.frontShare[k]).toBeCloseTo(p.frontShare, 5);
        expect(g.regime[k]).toBe(code[p.floor.regime]);
        expect(g.plankOnGround[k]).toBe(p.plankClearanceMm <= 0 ? 1 : 0);
      }
    }
  });

  it('covers every preset, the slider box and the presets’ trajectories', () => {
    const inside = (r: RideHeights) =>
      r.frontMm >= MAP_RANGE.frontMm[0] &&
      r.frontMm <= MAP_RANGE.frontMm[1] &&
      r.rearMm >= MAP_RANGE.rearMm[0] &&
      r.rearMm <= MAP_RANGE.rearMm[1];
    for (const p of RIDE_PRESETS) {
      expect(p.frontMm).toBeGreaterThanOrEqual(SETUP_RANGE.frontMm[0]);
      expect(p.frontMm).toBeLessThanOrEqual(SETUP_RANGE.frontMm[1]);
      expect(p.rearMm).toBeGreaterThanOrEqual(SETUP_RANGE.rearMm[0]);
      expect(p.rearMm).toBeLessThanOrEqual(SETUP_RANGE.rearMm[1]);
      for (const s of platformSweep(p, 350, 10)) expect(inside(s.dynamic)).toBe(true);
    }
    expect(inside(rh(SETUP_RANGE.frontMm[1], SETUP_RANGE.rearMm[1]))).toBe(true);
    expect(inside(rh(SETUP_RANGE.frontMm[0], SETUP_RANGE.rearMm[0]))).toBe(true);
    expect(new Set(RIDE_PRESETS.map((p) => p.id)).size).toBe(3);
  });
});

describe('calibration report', () => {
  it('logs the achieved numbers', () => {
    const ref = aeroMapAt(REFERENCE_RIDE);
    const p250 = platformAt(250, DEFAULT_SETUP);
    const p300 = platformAt(300, DEFAULT_SETUP);
    const p350 = platformAt(350, DEFAULT_SETUP);
    const g = aeroMapGrid(60, 60);
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of g.cdA) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const lowOnset = porpoiseOnsetKmh(LOW);
    const lowBand = unstableSpeeds(LOW);
    const lowMode = lowOnset === null ? null : bounceModes(lowOnset + 0.5, LOW);
    const rest = bodyModes(0, DEFAULT_SETUP);
    const f = (x: number, d = 3) => x.toFixed(d);
    const lines = [
      `constants: d_eff ${FL.channelHalfWidthM} m, λ_LE ${FL.leadingEdgeLeak}, p ${FL.leakPower}, ζ ${AEROMAP.bounce.dampingRatio}, n_c ${AEROMAP.bounce.lagConvectiveTimes}`,
      `set-ups: default ${DEFAULT_SETUP.frontMm}/${DEFAULT_SETUP.rearMm}, low ${LOW.frontMm}/${LOW.rearMm}, high rake ${HIGH_RAKE.frontMm}/${HIGH_RAKE.rearMm}, reference ${REFERENCE_RIDE.frontMm}/${REFERENCE_RIDE.rearMm} mm`,
      `1 reference: ClA ${f(ref.clA, 4)}, CdA ${f(ref.cdA, 4)}, shares ${ref.surfaces.map((s) => f(s.clA / ref.clA, 4)).join('/')}, front ${f(ref.frontShare, 4)} (aeroFrontShare ${f(aeroFrontShare(), 4)}), floor CoP ${f(floorOf(ref).cpX, 4)} m, throat Cp ${f(ref.floor.throatCp)}, η ${f(ref.floor.eta)}, throat ${f(ref.floor.throatGapMm, 1)} mm, peak gap ${f(ref.floor.peakGapMm, 1)} mm`,
      `2 default @250 km/h: ${f(p250.dynamic.frontMm, 2)} / ${f(p250.dynamic.rearMm, 2)} mm`,
      `3 default @350 km/h: ${f(p350.dynamic.frontMm, 1)} / ${f(p350.dynamic.rearMm, 1)} mm, plank ${f(p350.plankClearanceMm, 1)} mm, η ${f(p350.point.floor.eta)}, onset ${porpoiseOnsetKmh(DEFAULT_SETUP)}`,
      `4 squat @300 km/h: front ${f(DEFAULT_SETUP.frontMm - p300.dynamic.frontMm, 1)} mm, rear ${f(DEFAULT_SETUP.rearMm - p300.dynamic.rearMm, 1)} mm`,
      `5 sensitivities: lower both ${f(sens.lowerBoth)} %/mm, lower front ${f(sens.lowerFront)} %/mm, raise rear ${f(sens.raiseRear)} %/mm, balance ${f(sens.balancePerFrontMm)} pts/mm h_F, ${f(sens.balancePerRearMm)} pts/mm h_R`,
      `7 low: onset ${lowOnset} km/h, unstable ${lowBand[0]}–${lowBand.at(-1)} km/h, ${lowMode ? f(lowMode.frequencyHz, 2) : '-'} Hz, ζ ${lowMode ? f(lowMode.dampingRatio) : '-'}; high rake onset ${porpoiseOnsetKmh(HIGH_RAKE)}`,
      `  at rest: ${rest.map((m) => `${f(m.frequencyHz, 2)} Hz ζ ${f(m.dampingRatio)}`).join(', ')}`,
      `8 chart CdA ${f(lo)}–${f(hi)} (${f((lo / 1.1 - 1) * 100, 1)} … +${f((hi / 1.1 - 1) * 100, 1)} %)`,
    ];
    console.log(`Station 06 calibration\n${lines.join('\n')}`);
    expect(lines.length).toBeGreaterThan(0);
  });
});
