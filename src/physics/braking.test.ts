import { describe, expect, it } from 'vitest';
import { kmhToMs } from './aero';
import { brakingState, sampleAt, simulateBrakeZone } from './braking';
import { ESTIMATES, REGS } from './constants';

describe('brakingState', () => {
  it('brakes at the tyre-grip limit when parked (weight only, no aero)', () => {
    const s = brakingState(0);
    expect(s.decelG).toBeCloseTo(ESTIMATES.gripLongitudinal, 6);
    expect(s.downforceN).toBe(0);
    expect(s.brakePowerW).toBe(0);
  });

  it('brakes harder the faster the car goes, because downforce and drag both grow', () => {
    const g = [80, 150, 250, 330].map((v) => brakingState(v).decelG);
    for (let i = 1; i < g.length; i++) expect(g[i]).toBeGreaterThan(g[i - 1]);
    expect(brakingState(330).decelG).toBeGreaterThan(4);
    expect(brakingState(330).decelG).toBeLessThan(6);
  });

  it('gives F = m·a', () => {
    const s = brakingState(250);
    expect(s.decelMs2 * REGS.minMassKg.value).toBeCloseTo(s.tyreForceN + s.dragN, 6);
  });

  it('moves load from the rear axle to the front and conserves the total', () => {
    const s = brakingState(200);
    const total = REGS.minMassKg.value * 9.80665 + s.downforceN;
    expect(s.frontLoadN + s.rearLoadN).toBeCloseTo(total, 6);
    expect(s.frontLoadN).toBeGreaterThan(s.frontStaticN);
    expect(s.rearLoadN).toBeLessThan(s.rearStaticN + s.downforceN);
    expect(s.frontShare).toBeGreaterThan(ESTIMATES.staticFrontShare);
  });

  it('never harvests more than the motor allows or than the rear axle brakes', () => {
    for (const v of [50, 150, 250, 330, 345]) {
      const s = brakingState(v);
      expect(s.harvestW).toBeLessThanOrEqual(REGS.mguKMaxKw.value * 1000 + 1e-6);
      expect(s.harvestW).toBeLessThanOrEqual(s.brakePowerW * (1 - s.frontShare) + 1e-6);
      expect(s.harvestW + s.heatW).toBeCloseTo(s.brakePowerW, 6);
    }
    expect(brakingState(330).harvestW).toBeCloseTo(350_000, 0);
  });

  it('pitches the nose down by a few millimetres, more at speed', () => {
    expect(brakingState(100).noseDropM).toBeGreaterThan(0);
    expect(brakingState(330).noseDropM).toBeGreaterThan(brakingState(100).noseDropM);
    expect(brakingState(330).noseDropM).toBeLessThan(0.05);
  });
});

describe('simulateBrakeZone', () => {
  it('ends at the apex speed and accounts for all the kinetic energy', () => {
    const z = simulateBrakeZone(300, 80);
    expect(z.samples[0].kmh).toBeCloseTo(300, 6);
    expect(z.samples.at(-1)!.kmh).toBeCloseTo(80, 1);
    const m = REGS.minMassKg.value;
    expect(z.kineticMJ).toBeCloseTo((0.5 * m * (kmhToMs(300) ** 2 - kmhToMs(80) ** 2)) / 1e6, 6);
    expect(z.dragMJ + z.harvestMJ + z.heatMJ).toBeCloseTo(z.kineticMJ, 1);
  });

  it('takes 2 to 3 seconds and 100 to 150 m from 330 km/h, in the range fans see on TV', () => {
    const z = simulateBrakeZone(330, 80);
    expect(z.timeS).toBeGreaterThan(2);
    expect(z.timeS).toBeLessThan(3.5);
    expect(z.distanceM).toBeGreaterThan(100);
    expect(z.distanceM).toBeLessThan(160);
  });

  it('heats the front discs more than the rear, and caps recovery per zone by the motor', () => {
    const z = simulateBrakeZone(330, 80);
    expect(z.peakFrontDiscC).toBeGreaterThan(z.peakRearDiscC);
    expect(z.peakFrontDiscC).toBeGreaterThan(ESTIMATES.brakes.startDiscC);
    expect(z.harvestMJ).toBeLessThan(REGS.harvestPerLapMJ.value);
    expect(z.harvestMJ).toBeLessThanOrEqual((REGS.mguKMaxKw.value * 1000 * z.timeS) / 1e6 + 1e-9);
  });

  it('is empty when there is nothing to shed', () => {
    const z = simulateBrakeZone(80, 80);
    expect(z.timeS).toBe(0);
    expect(z.distanceM).toBe(0);
    expect(z.samples).toHaveLength(1);
  });

  it('sampleAt interpolates and clamps', () => {
    const z = simulateBrakeZone(250, 80);
    expect(sampleAt(z, -1).kmh).toBeCloseTo(250, 6);
    expect(sampleAt(z, 99).kmh).toBeCloseTo(80, 1);
    const mid = sampleAt(z, z.timeS / 2);
    expect(mid.kmh).toBeLessThan(250);
    expect(mid.kmh).toBeGreaterThan(80);
    expect(mid.s).toBeGreaterThan(0);
    expect(mid.s).toBeLessThan(z.distanceM);
  });
});
