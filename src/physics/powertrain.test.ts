import { describe, expect, it } from 'vitest';
import { aeroState } from './aero';
import { availablePowerW, mguKLimitKw, requiredPowerW, topSpeedKmh } from './powertrain';

describe('ERS-K power limit (FIA C5.2.8)', () => {
  it.each([
    [0, 350],
    [200, 350],
    [290, 350],
    [300, 300],
    [320, 200],
    [340, 100],
    [342, 60],
    [345, 0],
    [360, 0],
  ])('at %i km/h allows %i kW', (kmh, kw) => {
    expect(mguKLimitKw(kmh)).toBeCloseTo(kw, 6);
  });

  it('is continuous at the 340 km/h change of formula', () => {
    expect(mguKLimitKw(339.999)).toBeCloseTo(mguKLimitKw(340), 2);
  });

  it('Overtake keeps full power to 337.5 km/h and reaches zero at 355', () => {
    expect(mguKLimitKw(337.5, true)).toBeCloseTo(350, 6);
    expect(mguKLimitKw(345, true)).toBeCloseTo(200, 6);
    expect(mguKLimitKw(355, true)).toBe(0);
  });
});

describe('power balance', () => {
  it('delivers 95% of engine + motor to the tyres', () => {
    expect(availablePowerW(200)).toBeCloseTo(0.95 * 750_000, 3);
    expect(availablePowerW(200, { deploy: false })).toBeCloseTo(0.95 * 400_000, 3);
  });

  it('drag power grows with the cube of speed', () => {
    const a = requiredPowerW(150).dragW;
    const b = requiredPowerW(300).dragW;
    expect(b / a).toBeCloseTo(8, 6);
  });

  it('Straight Mode needs less power at the same speed', () => {
    expect(requiredPowerW(300, 1).totalW).toBeLessThan(requiredPowerW(300, 0).totalW);
  });
});

describe('top speed', () => {
  it('is higher in Straight Mode than in Corner Mode', () => {
    const corner = topSpeedKmh(0);
    const straight = topSpeedKmh(1);
    expect(straight - corner).toBeGreaterThan(6);
    expect(corner).toBeGreaterThan(315);
    expect(corner).toBeLessThan(335);
  });

  it('lands near the Monza 2026 qualifying anchor (341 km/h) in Straight Mode', () => {
    const straight = topSpeedKmh(1);
    expect(straight).toBeGreaterThan(330);
    expect(straight).toBeLessThan(345); // the motor limit reaches zero at 345
  });

  it('drops sharply with an empty battery', () => {
    expect(topSpeedKmh(1, { deploy: false })).toBeLessThan(topSpeedKmh(1) - 15);
  });
});

describe('Straight Mode aero', () => {
  it('cuts about 25% of downforce and 18% of drag, all from the wings', () => {
    const corner = aeroState(300, undefined, 0);
    const straight = aeroState(300, undefined, 1);
    expect(straight.downforceN / corner.downforceN).toBeCloseTo(0.75, 6);
    expect(straight.dragN / corner.dragN).toBeCloseTo(0.82, 6);
    const floor = (s: typeof corner) => s.surfaces.find((x) => x.id === 'floor')!.downforceN;
    expect(floor(straight)).toBeCloseTo(floor(corner), 6);
    const total = straight.surfaces.reduce((n, x) => n + x.downforceN, 0);
    expect(total).toBeCloseTo(straight.downforceN, 6);
  });
});
