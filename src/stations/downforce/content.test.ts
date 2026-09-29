import { describe, expect, it } from 'vitest';
import { aeroState } from '../../physics/aero';
import { captionFor, PRESETS } from './content';

const text = (kmh: number, ceiling: 'off' | 'sticks' | 'falls' = 'off') =>
  captionFor({ aero: aeroState(kmh), exploded: false, ceiling }).map((r) => r.text).join('');

describe('Station 1 captions', () => {
  it('only says "more than twice" where downforce really exceeds twice the weight', () => {
    for (let kmh = 0; kmh <= 350; kmh++) {
      const twice = /more than twice/.test(text(kmh));
      if (twice) expect(aeroState(kmh).downforceToWeight, `${kmh} km/h`).toBeGreaterThan(2);
      if (aeroState(kmh).downforceToWeight > 2) expect(twice, `${kmh} km/h`).toBe(true);
    }
  });

  it('every preset lands in a band whose claim is true', () => {
    for (const { kmh } of PRESETS) {
      const ratio = aeroState(kmh).downforceToWeight;
      const words = text(kmh);
      if (/more than twice/.test(words)) expect(ratio, `${kmh} km/h`).toBeGreaterThan(2);
      else if (/outweighs/.test(words)) expect(ratio, `${kmh} km/h`).toBeGreaterThan(1);
    }
    expect(text(330)).toMatch(/more than twice/);
    expect(text(250)).toMatch(/outweighs/);
  });

  it('the ceiling threshold printed is a speed at which the car really sticks', () => {
    const { ceilingSpeedKmh } = aeroState(0);
    const printed = Number(/(\d+) km\/h/.exec(text(300, 'falls'))![1]);
    expect(printed).toBe(Math.ceil(ceilingSpeedKmh));
    expect(aeroState(printed).downforceToWeight).toBeGreaterThanOrEqual(1);
    expect(aeroState(printed - 1).downforceToWeight).toBeLessThan(1);
  });
});
