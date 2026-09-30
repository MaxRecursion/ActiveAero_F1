import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { discGlow, ROTOR } from './brakes';

const at = (tempC: number) => {
  const { colour, intensity } = discGlow(tempC);
  return { r: colour.r, g: colour.g, b: colour.b, intensity };
};

describe('discGlow', () => {
  it('is dark below 350 °C', () => {
    for (const tempC of [-40, 0, 20, 200, 349, 350]) expect(at(tempC), `${tempC} °C`).toEqual({ r: 0, g: 0, b: 0, intensity: 0 });
  });

  it('is a dull red at 450 °C', () => {
    const c = at(450);
    expect(c.intensity).toBeGreaterThan(0.2);
    expect(c.intensity).toBeLessThan(0.8);
    expect(c.r).toBeGreaterThan(0.9);
    expect(c.g).toBeLessThan(0.12);
    expect(c.b).toBeLessThan(0.05);
  });

  it('is orange at 600 °C', () => {
    const c = at(600);
    expect(c.g / c.r).toBeGreaterThan(0.15);
    expect(c.g / c.r).toBeLessThan(0.35);
    expect(c.b).toBeLessThan(0.05);
  });

  it('is yellow-white from 900 °C, and stays put beyond it', () => {
    const c = at(900);
    expect(c.g).toBeGreaterThan(0.6);
    expect(c.b).toBeGreaterThan(0.2);
    expect(at(1400)).toEqual(c);
  });

  it('gets brighter and less red the hotter it is', () => {
    let last = at(350);
    for (let t = 360; t <= 950; t += 10) {
      const now = at(t);
      expect(now.intensity, `${t} °C`).toBeGreaterThanOrEqual(last.intensity);
      expect(now.g, `${t} °C`).toBeGreaterThanOrEqual(last.g);
      last = now;
    }
  });

  it('keeps the brightest step where tone mapping still shows its hue', () => {
    const c = at(1200);
    expect(c.intensity * Math.max(c.r, c.g, c.b)).toBeLessThanOrEqual(3);
  });

  it('fills the object it is given', () => {
    const out = { colour: new THREE.Color(), intensity: 0 };
    expect(discGlow(600, out)).toBe(out);
    expect(out.intensity).toBeCloseTo(1.2);
  });
});

describe('rotor sizes', () => {
  it('are 280 mm at the front and 250 mm at the rear, with rows that fit the ring', () => {
    expect(ROTOR.front.radius * 2).toBeCloseTo(0.28);
    expect(ROTOR.rear.radius * 2).toBeCloseTo(0.25);
    for (const { radius, ring, holes } of Object.values(ROTOR)) {
      expect(ring).toBeLessThan(radius);
      expect(holes.length).toBeGreaterThan(1);
    }
  });
});
