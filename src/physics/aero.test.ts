import { describe, expect, it } from 'vitest';
import { aeroFrontShare, aeroState, ceilingSpeedKmh, dynamicPressure, kmhToMs } from './aero';
import { ESTIMATES } from './constants';

describe('dynamic pressure', () => {
  // Reference values from ρ = 1.225 kg/m³.
  it.each([
    [100, 472.6],
    [200, 1890.4],
    [300, 4253.5],
    [340, 5463.2],
  ])('q at %i km/h ≈ %f Pa', (kmh, pa) => {
    expect(dynamicPressure(kmhToMs(kmh))).toBeCloseTo(pa, 0);
  });

  it('scales with the square of speed', () => {
    const a = aeroState(150);
    const b = aeroState(300);
    expect(b.downforceN / a.downforceN).toBeCloseTo(4, 10);
    expect(b.dragPowerW / a.dragPowerW).toBeCloseTo(8, 10);
  });
});

describe('aero state', () => {
  it('is zero when parked', () => {
    const s = aeroState(0);
    expect(s.downforceN).toBe(0);
    expect(s.dragN).toBe(0);
    expect(s.dragPowerW).toBe(0);
  });

  it('matches hand calculation at 300 km/h', () => {
    const s = aeroState(300);
    expect(s.downforceN).toBeCloseTo(4253.5 * 3.2, -1); // ≈ 13.6 kN
    expect(s.dragN).toBeCloseTo(4253.5 * 1.1, -1); // ≈ 4.7 kN
    expect(s.dragPowerW / 1000).toBeCloseTo(389.9, 0); // ≈ 390 kW
    expect(s.weightN).toBeCloseTo(770 * 9.80665, 6);
    expect(s.downforceToWeight).toBeCloseTo(1.8, 1);
  });

  it('splits downforce across surfaces without losing any', () => {
    const s = aeroState(250);
    const total = s.surfaces.reduce((n, x) => n + x.downforceN, 0);
    expect(total).toBeCloseTo(s.downforceN, 6);
    expect(ESTIMATES.surfaces.reduce((n, x) => n + x.share, 0)).toBeCloseTo(1, 10);
  });

  it('puts roughly 46% of downforce on the front axle', () => {
    expect(aeroFrontShare()).toBeGreaterThan(0.42);
    expect(aeroFrontShare()).toBeLessThan(0.5);
  });
});

describe('ceiling speed', () => {
  it('is where downforce equals weight', () => {
    const v = ceilingSpeedKmh();
    const s = aeroState(v);
    expect(s.downforceToWeight).toBeCloseTo(1, 10);
    expect(v).toBeGreaterThan(215);
    expect(v).toBeLessThan(230); // ≈ 222 km/h for 770 kg and ClA 3.2
  });
});
