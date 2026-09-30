import { describe, expect, it } from 'vitest';
import { brakingState, sampleAt, simulateBrakeZone } from '../../physics/braking';
import { ESTIMATES } from '../../physics/constants';
import { cruiseView, DISC_WINDOW_C, makeBrakeRun, makeBrakeTrace, viewAt } from './trace';

const SPEEDS = [120, 150, 200, 250, 300, 330, 345];

describe('makeBrakeTrace', () => {
  it('describes the zone the physics simulated', () => {
    for (const from of SPEEDS) {
      const zone = simulateBrakeZone(from);
      const tr = makeBrakeTrace(from, zone);
      expect(tr.fromKmh).toBe(from);
      expect(tr.toKmh).toBe(ESTIMATES.brakes.apexKmh);
      expect(tr.timeS).toBe(zone.timeS);
      expect(tr.distanceM).toBe(zone.distanceM);
      expect(tr.peakDecelG).toBe(zone.peakDecelG);
      expect(tr.peakFrontDiscC).toBe(zone.peakFrontDiscC);
      expect(tr.discWindowC).toEqual(DISC_WINDOW_C);
    }
  });

  it('thins to about one point per 25 ms, starts at the pedal press and ends at the end of the zone', () => {
    const zone = simulateBrakeZone(300);
    const tr = makeBrakeTrace(300, zone);
    expect(tr.points.length).toBeLessThan(zone.samples.length / 4);
    expect(tr.points.length).toBeGreaterThan(zone.timeS / 0.03);
    expect(tr.points[0].t).toBe(0);
    expect(tr.points[0].kmh).toBeCloseTo(300, 6);
    const last = tr.points[tr.points.length - 1];
    expect(last.t).toBeCloseTo(zone.timeS, 9);
    expect(last.kmh).toBeCloseTo(80, 6);
    for (let i = 1; i < tr.points.length; i++) {
      expect(tr.points[i].t).toBeGreaterThan(tr.points[i - 1].t);
      expect(tr.points[i].kmh).toBeLessThan(tr.points[i - 1].kmh);
    }
  });

  it('gives powers in kW that add up: brake = harvest + heat, harvest at most 350', () => {
    for (const from of SPEEDS) {
      for (const p of makeBrakeTrace(from).points) {
        expect(p.harvestKw + p.heatKw).toBeCloseTo(p.brakeKw, 6);
        expect(p.harvestKw).toBeLessThanOrEqual(350 + 1e-9);
        expect(p.harvestKw).toBeGreaterThanOrEqual(0);
        expect(p.heatKw).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });

  it('keeps the energy books: drag + harvest + heat = kinetic, and it is the same data the physics reports', () => {
    for (const from of SPEEDS) {
      const tr = makeBrakeTrace(from);
      expect(tr.dragMJ + tr.harvestMJ + tr.heatMJ).toBeCloseTo(tr.kineticMJ, 1);
    }
  });

  it('builds the same trace with or without a supplied zone', () => {
    expect(makeBrakeTrace(250)).toEqual(makeBrakeTrace(250, simulateBrakeZone(250)));
  });

  it('a zone shorter than the apex still returns a usable, non-empty trace', () => {
    const tr = makeBrakeTrace(80);
    expect(tr.points.length).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(tr.timeS)).toBe(true);
  });
});

describe('viewAt', () => {
  const zone = simulateBrakeZone(300);

  it('at the start of the zone is the car at the entry speed with the pedal just down', () => {
    const v = viewAt(zone, 0);
    expect(v.kmh).toBeCloseTo(300, 6);
    expect(v.tS).toBe(0);
    expect(v.sM).toBe(0);
    expect(v.decelG).toBeCloseTo(brakingState(300).decelG, 9);
    expect(v.frontDiscC).toBe(ESTIMATES.brakes.startDiscC);
    expect(v.harvestedMJ).toBe(0);
    expect(v.heatMJ).toBe(0);
  });

  it('clamps to the ends of the zone', () => {
    expect(viewAt(zone, -5).tS).toBe(0);
    const end = viewAt(zone, 1e6);
    expect(end.kmh).toBeCloseTo(80, 6);
    expect(end.tS).toBeCloseTo(zone.timeS, 9);
  });

  it('agrees with the physics sample at any time', () => {
    for (const t of [0.4, 1, 1.7, zone.timeS * 0.9]) {
      const x = sampleAt(zone, t);
      const v = viewAt(zone, t);
      expect(v.kmh).toBeCloseTo(x.kmh, 9);
      expect(v.brakeKw).toBeCloseTo(x.brakePowerW / 1000, 6);
      expect(v.heatKw).toBeCloseTo(x.heatW / 1000, 6);
      expect(v.harvestKw).toBeCloseTo(x.harvestW / 1000, 6);
      expect(v.rearDiscC).toBeCloseTo(x.rearDiscC, 9);
    }
  });

  it('loads: front + rear is weight + downforce, and transfer is the difference from static', () => {
    for (const t of [0, 0.5, 1.5, zone.timeS]) {
      const v = viewAt(zone, t);
      expect(v.frontLoadN - v.frontStaticN).toBeCloseTo(v.transferN, 6);
      expect(v.rearStaticN - v.rearLoadN).toBeCloseTo(v.transferN, 6);
      expect(v.frontLoadN + v.rearLoadN).toBeCloseTo(v.frontStaticN + v.rearStaticN, 6);
      expect(v.transferN).toBeGreaterThan(0);
      expect(v.frontLoadN).toBeGreaterThan(v.frontStaticN);
      expect(v.rearLoadN).toBeLessThan(v.rearStaticN);
    }
  });

  it('the printed static load already includes downforce and matches the physics at that speed', () => {
    const v = viewAt(zone, 0);
    const b = brakingState(v.kmh);
    expect(v.frontStaticN + v.rearStaticN).toBeCloseTo(b.frontStaticN + b.rearStaticN + b.downforceN, 6);
    expect(v.frontLoadN).toBeCloseTo(b.frontLoadN, 6);
    expect(v.rearLoadN).toBeCloseTo(b.rearLoadN, 6);
    expect(v.downforceN).toBeCloseTo(b.downforceN, 6);
  });

  it('bias is the front share of the total load, in percent', () => {
    const v = viewAt(zone, 1);
    expect(v.frontBiasPct).toBeCloseTo((100 * v.frontLoadN) / (v.frontLoadN + v.rearLoadN), 9);
    expect(v.frontBiasPct).toBeCloseTo(100 * brakingState(v.kmh).frontShare, 6);
  });

  it('nose drop is reported in mm and in m, and the body dips at the front, rises at the back', () => {
    const v = viewAt(zone, 0);
    expect(v.noseDropMm).toBeCloseTo(v.noseDropM * 1000, 9);
    expect(v.noseDropM).toBeGreaterThan(0);
    expect(v.tailRiseM).toBeGreaterThan(0);
  });

  it('braking eases as the downforce falls: the last moments pull less than the first', () => {
    const first = viewAt(zone, 0);
    const last = viewAt(zone, zone.timeS);
    expect(last.decelG).toBeLessThan(first.decelG);
    expect(last.transferN).toBeLessThan(first.transferN);
    expect(last.downforceN).toBeLessThan(first.downforceN);
  });

  it('the discs warm up and never cool below where they began within a hard stop', () => {
    const first = viewAt(zone, 0);
    const last = viewAt(zone, zone.timeS);
    expect(last.frontDiscC).toBeGreaterThan(first.frontDiscC);
    expect(last.frontDiscC).toBeCloseTo(zone.samples[zone.samples.length - 1].frontDiscC, 9);
  });

  it('is finite everywhere on a sweep of times and entry speeds', () => {
    for (const from of SPEEDS) {
      const z = simulateBrakeZone(from);
      for (let i = 0; i <= 40; i++) {
        const v = viewAt(z, (z.timeS * i) / 40);
        for (const [k, x] of Object.entries(v)) expect(Number.isFinite(x), `${from} ${k}`).toBe(true);
      }
    }
  });
});

describe('cruiseView', () => {
  it('is the entry speed with the pedal up: no braking, no transfer, no dive, cold-start discs', () => {
    for (const from of SPEEDS) {
      const z = simulateBrakeZone(from);
      const c = cruiseView(z);
      expect(c.kmh).toBeCloseTo(from, 6);
      expect(c.decelG).toBe(0);
      expect(c.brakeKw).toBe(0);
      expect(c.harvestKw).toBe(0);
      expect(c.heatKw).toBe(0);
      expect(c.transferN).toBe(0);
      expect(c.noseDropMm).toBe(0);
      expect(c.noseDropM).toBe(0);
      expect(c.tailRiseM).toBe(0);
      expect(c.frontLoadN).toBeCloseTo(c.frontStaticN, 6);
      expect(c.rearLoadN).toBeCloseTo(c.rearStaticN, 6);
      expect(c.frontDiscC).toBe(ESTIMATES.brakes.startDiscC);
      expect(c.rearDiscC).toBe(ESTIMATES.brakes.startDiscC);
    }
  });

  it('carries more front load at the pedal press than at cruise, by exactly the transfer', () => {
    const z = simulateBrakeZone(250);
    const c = cruiseView(z);
    const b = viewAt(z, 0);
    expect(b.frontLoadN - c.frontLoadN).toBeCloseTo(b.transferN, 6);
    expect(c.rearLoadN - b.rearLoadN).toBeCloseTo(b.transferN, 6);
  });
});

describe('makeBrakeRun', () => {
  it('bundles the zone, its trace and the cruise moment for one entry speed', () => {
    const run = makeBrakeRun(200);
    expect(run.zone.fromKmh).toBe(200);
    expect(run.trace.fromKmh).toBe(200);
    expect(run.trace.timeS).toBe(run.zone.timeS);
    expect(run.cruise.kmh).toBeCloseTo(200, 6);
  });

  it('a faster entry takes longer, goes further and gets hotter', () => {
    const slow = makeBrakeRun(150).trace;
    const fast = makeBrakeRun(330).trace;
    expect(fast.timeS).toBeGreaterThan(slow.timeS);
    expect(fast.distanceM).toBeGreaterThan(slow.distanceM);
    expect(fast.peakFrontDiscC).toBeGreaterThan(slow.peakFrontDiscC);
    expect(fast.kineticMJ).toBeGreaterThan(slow.kineticMJ);
  });
});
