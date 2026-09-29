import { describe, expect, it } from 'vitest';
import { DEFAULT_AERO_INPUTS, modeCoefficients } from './aero';
import { ESTIMATES, PHYS, REGS } from './constants';
import { ACTIVATION_MIN_M, BRAKE_RESERVE_J, DS, sampleAt, simulateLap } from './lap';
import { buildTrack, SEGMENTS } from './track';

describe('circuit', () => {
  it('closes on itself and turns one full clockwise loop', () => {
    const track = buildTrack(1);
    const first = track.points[0];
    const last = track.points[track.points.length - 1];
    expect(Math.hypot(last.x - first.x, last.y - first.y)).toBeLessThan(2);
    const turn = SEGMENTS.reduce((sum, s) => sum + (s.kind === 'arc' ? s.angle : 0), 0);
    expect(turn).toBe(-360);
    expect(track.length).toBeGreaterThan(5000);
    expect(track.length).toBeLessThan(5100);
  });
});

describe('lap simulation', () => {
  const lap = simulateLap();
  const noClip = simulateLap({ clipping: false });
  const corner = (label: string) => {
    const c = lap.track.corners.find((x) => x.label === label)!;
    return Math.min(...lap.samples.filter((x) => Math.abs(x.s - c.s) < 30).map((x) => x.kmh));
  };

  it('produces a plausible lap time and speeds', () => {
    expect(lap.lapTimeS).toBeGreaterThan(80);
    expect(lap.lapTimeS).toBeLessThan(95);
    expect(lap.topSpeedKmh).toBeLessThan(345); // the motor limit reaches zero at 345 km/h
    expect(corner('T4')).toBeLessThan(80); // hairpin
    expect(corner('T6')).toBeGreaterThan(250); // flat-out sweeper
  });

  it('keeps time and distance monotonic', () => {
    for (let i = 1; i < lap.samples.length; i++) {
      expect(lap.samples[i].t).toBeGreaterThan(lap.samples[i - 1].t);
      expect(lap.samples[i].s).toBeGreaterThan(lap.samples[i - 1].s);
    }
  });

  it('respects the energy rules', () => {
    for (const x of lap.samples) {
      expect(x.socMJ).toBeGreaterThanOrEqual(-1e-9);
      expect(x.socMJ).toBeLessThanOrEqual(REGS.energyStoreWindowMJ.value + 1e-9);
      expect(Math.abs(x.mguKKw)).toBeLessThanOrEqual(REGS.mguKMaxKw.value + 1e-6);
    }
    expect(lap.harvestedMJ).toBeLessThanOrEqual(REGS.harvestPerLapMJ.value + 1e-9);
    expect(lap.brakeHarvestMJ + lap.clipHarvestMJ).toBeCloseTo(lap.harvestedMJ, 9);
  });

  it('is periodic: the battery ends the lap where it started, so energy in ≈ energy out', () => {
    const s = lap.samples;
    expect(Math.abs(s[s.length - 1].socMJ - s[0].socMJ)).toBeLessThan(0.1);
    expect(Math.abs(lap.deployedMJ - lap.harvestedMJ)).toBeLessThan(0.1);
  });

  it('super clipping recovers extra energy and makes the lap faster', () => {
    expect(noClip.clipHarvestMJ).toBe(0);
    expect(lap.clipHarvestMJ).toBeGreaterThan(0.5);
    expect(lap.clipHarvestMJ).toBeLessThan((REGS.mguKMaxKw.value * 6) / 1000); // a few seconds at 350 kW
    expect(lap.harvestedMJ).toBeGreaterThan(noClip.harvestedMJ);
    expect(lap.lapTimeS).toBeLessThan(noClip.lapTimeS);
  });

  it('opens the wings only on straights and never while braking', () => {
    const open = lap.samples.filter((x) => x.straightT === 1);
    expect(open.length).toBeGreaterThan(100);
    expect(open.every((x) => x.phase !== 'brake')).toBe(true);
  });

  it('keeps the flaps closed in every corner, opening them only inside the straight zones', () => {
    const { points, straights } = lap.track;
    const zoned = new Set(straights.filter((st) => st.length >= ACTIVATION_MIN_M).map((st) => st.segment));
    lap.samples.forEach((x, i) => {
      if (points[i].curvature !== 0) expect(x.straightT).toBe(0);
      if (x.straightT === 1) expect(zoned.has(points[i].segment)).toBe(true);
    });
    expect(lap.samples.some((x) => x.straightT === 1)).toBe(true);
  });

  it.each([
    ['with super clipping', lap],
    ['without super clipping', noClip],
  ])('never deploys more than the rear tyres can put down (%s)', (_, run) => {
    const { massKg, rho } = DEFAULT_AERO_INPUTS;
    const deploying = run.samples.filter((x) => x.phase === 'deploy');
    expect(deploying.length).toBeGreaterThan(100);
    for (const x of deploying) {
      const v = x.kmh / 3.6;
      const downforceN = 0.5 * rho * v * v * modeCoefficients(x.straightT).clA;
      const tractionN = ESTIMATES.gripLongitudinal * ESTIMATES.rearAxleShare * (massKg * PHYS.g + downforceN);
      const wheelForceN = (ESTIMATES.drivelineEfficiency * (x.engineKw + x.mguKKw) * 1000) / v;
      expect(wheelForceN).toBeLessThanOrEqual(tractionN * (1 + 1e-9));
    }
  });

  it.each([
    ['with super clipping', lap],
    ['without super clipping', noClip],
  ])('powers a lift with exactly what holds the speed profile: engine first, motor for the rest (%s)', (_, run) => {
    const { massKg, rho } = DEFAULT_AERO_INPUTS;
    const n = run.samples.length;
    let lifts = 0;
    run.samples.forEach((x, i) => {
      if (x.phase !== 'lift') return;
      lifts++;
      const v = x.kmh / 3.6;
      const vNext = run.samples[(i + 1) % n].kmh / 3.6;
      const { clA, cdA } = modeCoefficients(x.straightT);
      const q = 0.5 * rho * v * v;
      const force = (massKg * (vNext * vNext - v * v)) / (2 * DS) + q * cdA + ESTIMATES.rollingResistance * (massKg * PHYS.g + q * clA);
      const holdKw = Math.max(0, (force * ((v + vNext) / 2)) / ESTIMATES.drivelineEfficiency / 1000);
      expect(x.engineKw).toBeCloseTo(Math.min(ESTIMATES.iceKw, holdKw), 3);
      expect(x.engineKw + x.mguKKw).toBeCloseTo(holdKw, 3);
    });
    expect(lifts).toBeGreaterThan(0);
  });

  it('lets the motor cover a lift the engine alone cannot hold', () => {
    expect(lap.samples.some((x) => x.phase === 'lift' && x.mguKKw > 0 && x.engineKw === ESTIMATES.iceKw)).toBe(true);
  });

  it('keeps the brake-harvest reserve inside the battery window', () => {
    expect(BRAKE_RESERVE_J).toBeGreaterThan(0);
    expect(BRAKE_RESERVE_J).toBeLessThan(REGS.energyStoreWindowMJ.value * 1e6);
  });

  it('interpolates samples by time and wraps around the lap', () => {
    const a = sampleAt(lap, 10);
    expect(a.t).toBeCloseTo(10, 6);
    const wrapped = sampleAt(lap, lap.lapTimeS + 10);
    expect(wrapped.s).toBeCloseTo(a.s, 6);
  });
});
