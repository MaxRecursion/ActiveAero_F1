import { describe, expect, it } from 'vitest';
import { REGS } from './constants';
import { sampleAt, simulateLap } from './lap';
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

  it('interpolates samples by time and wraps around the lap', () => {
    const a = sampleAt(lap, 10);
    expect(a.t).toBeCloseTo(10, 6);
    const wrapped = sampleAt(lap, lap.lapTimeS + 10);
    expect(wrapped.s).toBeCloseTo(a.s, 6);
  });
});
