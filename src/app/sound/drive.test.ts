import { describe, expect, it } from 'vitest';
import {
  GEAR_COUNT,
  IDLE_RPM,
  RPM_PER_KMH,
  SHIFT_DOWN_RPM,
  SHIFT_UP_RPM,
  UPSHIFT_LAND_RPM,
  steadyLoad,
  stepFlaps,
  stepGear,
  type FlapStep,
  type GearStep,
} from './drive';

const gear: GearStep = { gear: 1, rpm: 0 };
const flaps: FlapStep = { moving: false, direction: 0, latchedOpen: false, latchedClosed: false };

describe('gearbox', () => {
  it('idles in first when the car is stopped', () => {
    stepGear(1, 0, gear);
    expect(gear.gear).toBe(1);
    expect(gear.rpm).toBe(IDLE_RPM);
  });

  it('holds a gear between the downshift and the upshift', () => {
    const up = SHIFT_UP_RPM / RPM_PER_KMH[1];
    stepGear(1, up - 0.5, gear);
    expect(gear.gear).toBe(1);
    expect(gear.rpm).toBeGreaterThan(SHIFT_DOWN_RPM);
    expect(gear.rpm).toBeLessThan(SHIFT_UP_RPM);

    stepGear(gear.gear, up, gear);
    expect(gear.gear).toBe(2);
    expect(gear.rpm).toBeCloseTo(UPSHIFT_LAND_RPM, 0);

    // Back across the upshift point: stay in the higher gear.
    stepGear(gear.gear, up - 0.5, gear);
    expect(gear.gear).toBe(2);

    const down = SHIFT_DOWN_RPM / RPM_PER_KMH[2];
    stepGear(gear.gear, down - 0.5, gear);
    expect(gear.gear).toBe(1);
    expect(gear.rpm).toBeLessThan(SHIFT_UP_RPM);
  });

  it('walks several gears when speed jumps', () => {
    stepGear(1, 200, gear);
    expect(gear.gear).toBe(7);
    expect(gear.rpm).toBeGreaterThan(SHIFT_DOWN_RPM);
    expect(gear.rpm).toBeLessThan(SHIFT_UP_RPM);

    stepGear(1, 300, gear);
    expect(gear.gear).toBe(GEAR_COUNT);
    expect(gear.rpm).toBeCloseTo(300 * RPM_PER_KMH[GEAR_COUNT], 0);
  });

  it('downshifts all the way back to idle', () => {
    stepGear(GEAR_COUNT, 0, gear);
    expect(gear.gear).toBe(1);
    expect(gear.rpm).toBe(IDLE_RPM);
  });
});

describe('steady load', () => {
  it('is silent power when parked and full noise near top speed', () => {
    expect(steadyLoad(0, 0)).toBe(0);
    expect(steadyLoad(40, 0)).toBeLessThan(0.05);
    expect(steadyLoad(330, 0)).toBeGreaterThan(steadyLoad(160, 0));
    expect(steadyLoad(330, 0)).toBe(1);
  });

  it('eases when the wings open, because drag falls', () => {
    expect(steadyLoad(280, 1)).toBeLessThan(steadyLoad(280, 0));
  });
});

describe('flap edges', () => {
  it('latches once at each end and stays quiet while parked there', () => {
    stepFlaps(0, 0, flaps);
    expect(flaps.moving).toBe(false);
    expect(flaps.latchedOpen).toBe(false);
    expect(flaps.latchedClosed).toBe(false);

    stepFlaps(0.2, 0.5, flaps);
    expect(flaps).toMatchObject({ moving: true, direction: 1, latchedOpen: false, latchedClosed: false });

    stepFlaps(0.9, 1, flaps);
    expect(flaps.latchedOpen).toBe(true);
    expect(flaps.direction).toBe(1);

    stepFlaps(1, 1, flaps);
    expect(flaps.moving).toBe(false);
    expect(flaps.latchedOpen).toBe(false);

    stepFlaps(0.2, 0, flaps);
    expect(flaps.latchedClosed).toBe(true);
    expect(flaps.direction).toBe(-1);

    stepFlaps(0, 0, flaps);
    expect(flaps.latchedClosed).toBe(false);
  });

  it('treats a snap from shut to open as one latch', () => {
    stepFlaps(0, 1, flaps);
    expect(flaps.moving).toBe(true);
    expect(flaps.latchedOpen).toBe(true);
    expect(flaps.latchedClosed).toBe(false);
  });
});
