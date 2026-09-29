import { describe, expect, it } from 'vitest';
import { availablePowerW, powerStatus, requiredPowerW, topSpeedKmh } from '../../physics/powertrain';
import { captionFor } from './content';

const text = (runs: ReturnType<typeof captionFor>) => runs.map((r) => r.text).join('');

describe('caption and status agree', () => {
  const topCornerKmh = topSpeedKmh(0);
  const topStraightKmh = topSpeedKmh(1);

  it('never says "tops out" or "can’t reach" unless the status says so, in either mode', () => {
    for (const [mode, t] of [['corner', 0], ['straight', 1]] as const) {
      for (let kmh = 200; kmh <= 345; kmh++) {
        const status = powerStatus({ requiredPowerW: requiredPowerW(kmh, t).totalW, availablePowerW: availablePowerW(kmh) });
        const words = text(captionFor({ kmh, mode, straightT: t, status, topCornerKmh, topStraightKmh }));
        expect(/tops out/.test(words), `${mode} ${kmh}`).toBe(status === 'top');
        expect(/can’t reach this|runs out of power/.test(words), `${mode} ${kmh}`).toBe(status === 'short');
      }
    }
  });

  it('moves through accelerating, top, short as speed rises', () => {
    const order = { accelerating: 0, top: 1, short: 2 };
    for (const t of [0, 1]) {
      let last = 0;
      for (let kmh = 200; kmh <= 345; kmh++) {
        const s = order[powerStatus({ requiredPowerW: requiredPowerW(kmh, t).totalW, availablePowerW: availablePowerW(kmh) })];
        expect(s).toBeGreaterThanOrEqual(last);
        last = s;
      }
      expect(last).toBe(2);
    }
  });
});
