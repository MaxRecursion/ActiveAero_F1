import { describe, expect, it } from 'vitest';
import { simulateBrakeZone } from '../../physics/braking';
import { REGS } from '../../physics/constants';
import { fmtKN, fmtMJ, fmtRatio, fmtS } from '../../ui/format';
import type { BrakeState, CaptionRun } from '../../ui/types';
import { captionFor, PRESETS, phaseOf, type BrakePhase } from './content';
import { makeBrakeTrace, viewAt } from './trace';

const DIVE = 6;
const words = (runs: CaptionRun[]) => runs.map((r) => r.text).join('').replace(/ /g, ' ');
const key = (runs: CaptionRun[]) => JSON.stringify(runs);

function runFor(from: number) {
  const zone = simulateBrakeZone(from);
  const trace = makeBrakeTrace(from, zone);
  return { zone, trace, transferN: viewAt(zone, 0).transferN };
}

function caption(from: number, phase: BrakePhase, paused = false) {
  const { trace, transferN } = runFor(from);
  return captionFor({ phase, paused, zone: trace, transferN, diveExaggeration: DIVE });
}

describe('PRESETS', () => {
  it('are the five brake-from speeds, ascending, inside the slider range, each with a label', () => {
    expect(PRESETS.map((p) => p.kmh)).toEqual([150, 200, 250, 300, 330]);
    for (const p of PRESETS) {
      expect(p.label.trim().length).toBeGreaterThan(0);
      expect(p.label.length).toBeLessThanOrEqual(16);
      expect(p.kmh).toBeGreaterThanOrEqual(120);
      expect(p.kmh).toBeLessThanOrEqual(345);
    }
    expect(new Set(PRESETS.map((p) => p.label)).size).toBe(PRESETS.length);
  });
});

describe('phaseOf', () => {
  it('ready and done follow the state, whatever the speed', () => {
    const { trace } = runFor(300);
    expect(phaseOf('ready', trace, 300)).toBe('ready');
    expect(phaseOf('ready', trace, 100)).toBe('ready');
    expect(phaseOf('done', trace, 300)).toBe('done');
  });

  it('walks early, mid, late as the speed falls, and never goes back', () => {
    for (const p of PRESETS) {
      const zone = simulateBrakeZone(p.kmh);
      const trace = makeBrakeTrace(p.kmh, zone);
      const order: BrakePhase[] = ['early', 'mid', 'late'];
      let at = 0;
      for (let i = 0; i <= 200; i++) {
        const ph = phaseOf('braking' as BrakeState, trace, viewAt(zone, (zone.timeS * i) / 200).kmh);
        const idx = order.indexOf(ph);
        expect(idx, `${p.kmh} ${ph}`).toBeGreaterThanOrEqual(at);
        at = idx;
      }
      expect(at).toBe(2);
      expect(phaseOf('braking', trace, p.kmh)).toBe('early');
      expect(phaseOf('braking', trace, trace.toKmh)).toBe('late');
    }
  });
});

describe('captionFor', () => {
  it('has a caption for every phase, none empty, with only known tones', () => {
    const tones = new Set(['down', 'drag', 'weight', 'energy', 'engine', 'heat', 'strong', 'muted', undefined]);
    for (const phase of ['ready', 'early', 'mid', 'late', 'done'] as const) {
      const runs = caption(250, phase);
      expect(runs.length).toBeGreaterThan(0);
      expect(words(runs).length).toBeGreaterThan(40);
      for (const r of runs) {
        expect(r.text.length).toBeGreaterThan(0);
        expect(tones.has(r.tone)).toBe(true);
      }
    }
  });

  it('keeps each caption short enough to read in one glance', () => {
    for (const p of PRESETS) {
      for (const phase of ['ready', 'early', 'mid', 'late', 'done'] as const) {
        expect(words(caption(p.kmh, phase, true)).length, `${p.kmh} ${phase}`).toBeLessThan(230);
      }
    }
  });

  it('ready says how to start and does not depend on the chosen speed (no chatter while the slider moves)', () => {
    const a = caption(150, 'ready');
    expect(words(a)).toMatch(/press Brake/);
    for (const kmh of [120, 200, 250, 345]) expect(key(caption(kmh, 'ready'))).toBe(key(a));
  });

  it('early quotes the peak deceleration and the load moved, taken from the zone', () => {
    for (const p of PRESETS) {
      const { trace, transferN } = runFor(p.kmh);
      const text = words(caption(p.kmh, 'early'));
      expect(text).toContain(`${fmtRatio(trace.peakDecelG)} g`);
      expect(text).toContain(`${fmtKN(transferN)} kN`);
      expect(text).toContain(`${DIVE} times bigger`);
      expect(text).toMatch(/nose dips/);
    }
  });

  it('mid names the motor limit and the disc heat, and the temperature is rounded to ten', () => {
    for (const p of PRESETS) {
      const { trace } = runFor(p.kmh);
      const text = words(caption(p.kmh, 'mid'));
      expect(text).toContain(`${REGS.mguKMaxKw.value} kW`);
      const c = Number(/about (\d+) °C/.exec(text)![1]);
      expect(c % 10).toBe(0);
      expect(Math.abs(c - trace.peakFrontDiscC)).toBeLessThanOrEqual(5);
    }
  });

  it('late says braking eases and quotes a lower g than the peak', () => {
    for (const p of PRESETS) {
      const { trace } = runFor(p.kmh);
      const text = words(caption(p.kmh, 'late'));
      expect(text).toMatch(/eases/);
      const g = Number(/near ([\d.]+) g/.exec(text)![1]);
      expect(g).toBeLessThan(trace.peakDecelG);
      expect(g).toBeCloseTo(trace.points[trace.points.length - 1].decelG, 1);
    }
  });

  it('done gives the zone totals and lets the battery figure be the physics figure', () => {
    for (const p of PRESETS) {
      const { trace } = runFor(p.kmh);
      const text = words(caption(p.kmh, 'done'));
      expect(text).toContain(`${p.kmh} km/h to ${trace.toKmh} km/h`);
      expect(text).toContain(`${fmtS(trace.timeS)} s`);
      expect(text).toContain(`${Math.round(trace.distanceM)} m`);
      expect(text).toContain(`${fmtMJ(trace.kineticMJ)} MJ of motion energy`);
      expect(text).toContain(`${fmtMJ(trace.harvestMJ)} MJ went into the battery`);
      expect(text).toContain(`${fmtMJ(trace.heatMJ)} MJ became heat`);
    }
  });

  it('words every modelled number as an estimate', () => {
    for (const phase of ['early', 'mid', 'late', 'done'] as const) {
      expect(words(caption(300, phase)), phase).toMatch(/estimate/);
    }
  });

  it('never carries a branding word', () => {
    for (const p of PRESETS) {
      for (const phase of ['ready', 'early', 'mid', 'late', 'done'] as const) {
        expect(words(caption(p.kmh, phase, true))).not.toMatch(/\bF1\b|FIA|Formula|Ferrari|Mercedes|McLaren|Red Bull/i);
      }
    }
    for (const p of PRESETS) expect(p.label).not.toMatch(/\bF1\b|FIA|Formula/i);
  });

  it('paused adds a leading note to the running phases only', () => {
    for (const phase of ['early', 'mid', 'late'] as const) {
      const paused = caption(300, phase, true);
      const running = caption(300, phase, false);
      expect(words(paused)).toMatch(/^Paused\. /);
      expect(paused.slice(1)).toEqual(running);
      expect(paused[0].tone).toBe('muted');
    }
    expect(caption(300, 'ready', true)).toEqual(caption(300, 'ready', false));
    expect(caption(300, 'done', true)).toEqual(caption(300, 'done', false));
  });

  it('a whole stop changes the caption only a few times: once per phase', () => {
    for (const p of PRESETS) {
      const { zone, trace, transferN } = runFor(p.kmh);
      const seen = new Set<string>();
      let changes = 0;
      let prev = '';
      for (let i = 0; i <= 400; i++) {
        const state: BrakeState = i === 400 ? 'done' : 'braking';
        const phase = phaseOf(state, trace, viewAt(zone, (zone.timeS * i) / 400).kmh);
        const k = key(captionFor({ phase, paused: false, zone: trace, transferN, diveExaggeration: DIVE }));
        if (k !== prev) changes++;
        prev = k;
        seen.add(k);
      }
      expect(seen.size, `${p.kmh}`).toBe(4);
      expect(changes, `${p.kmh}`).toBe(4);
    }
  });

  it('uses a tone only for the thing it names, and never leaves a tone as the only carrier of a fact', () => {
    // Every toned run is words, and the same sentence reads whole without the tones.
    const text = words(caption(300, 'mid'));
    expect(text).toMatch(/charge/);
    expect(text).toMatch(/heat/);
    for (const r of caption(300, 'mid')) if (r.tone) expect(r.text).toMatch(/[A-Za-z0-9]/);
  });
});
