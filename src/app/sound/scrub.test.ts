import { describe, expect, it } from 'vitest';
import { HOP, ScrubVoice, WIN, type ScrubSource } from './scrub';

/**
 * A stand-in for a recorded rev sweep, used only to test the arithmetic: a harmonic stack whose
 * fundamental climbs from 100 to 300 Hz over six seconds, with a little noise.
 */
const SR = 44100;
function sweepSource(): ScrubSource & { sr: number } {
  const seconds = 6;
  const n = SR * seconds;
  const pcm = new Float32Array(n);
  let phase = 0;
  let seed = 12345;
  const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 0.04;
  const rpm: number[] = [];
  const at: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = 100 + (200 * i) / n;
    phase += (2 * Math.PI * f) / SR;
    let v = 0;
    for (let h = 1; h <= 8; h++) v += Math.sin(h * phase) / h;
    pcm[i] = v * 0.3 + noise();
    if (i % 2205 === 0) {
      rpm.push(f);
      at.push(i);
    }
  }
  return { pcm, rpm: Float32Array.from(rpm), at: Float32Array.from(at), sr: SR };
}

/** Fundamental by autocorrelation over the 80–400 Hz lags. */
function pitchOf(x: Float32Array): number {
  let best = 0;
  let bestLag = 0;
  for (let lag = Math.floor(SR / 400); lag <= Math.floor(SR / 80); lag++) {
    let dot = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i + lag < x.length; i++) {
      dot += x[i] * x[i + lag];
      e1 += x[i] * x[i];
      e2 += x[i + lag] * x[i + lag];
    }
    const r = dot / Math.sqrt(e1 * e2 + 1e-12);
    if (r > best) {
      best = r;
      bestLag = lag;
    }
  }
  return SR / bestLag;
}

function render(voice: ScrubVoice, seconds: number, rpmAt: (t: number) => number): Float32Array {
  const n = Math.floor(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 128) voice.render(out.subarray(i, Math.min(n, i + 128)), Math.min(128, n - i), rpmAt(i / SR), 1, 1);
  return out;
}

describe('rpm-indexed playback', () => {
  const source = sweepSource();

  it('plays the requested pitch without resampling the recording', () => {
    for (const f of [120, 180, 240]) {
      const voice = new ScrubVoice(source, 3);
      const out = render(voice, 2.4, () => f);
      const heard = pitchOf(out.subarray(Math.floor(SR * 0.6)));
      expect(Math.abs(heard - f) / f, `${f} Hz`).toBeLessThan(0.025);
    }
  });

  it('follows a rising then falling request smoothly', () => {
    const voice = new ScrubVoice(source, 5);
    const out = render(voice, 6, (t) => (t < 3 ? 120 + (t / 3) * 120 : 240 - ((t - 3) / 3) * 120));
    const windows = [0.8, 1.6, 2.4, 3.6, 4.4, 5.2].map((t) => ({ t, f: pitchOf(out.subarray(Math.floor((t - 0.4) * SR), Math.floor((t + 0.4) * SR))) }));
    const want = (t: number) => (t < 3 ? 120 + (t / 3) * 120 : 240 - ((t - 3) / 3) * 120);
    for (const { t, f } of windows) expect(Math.abs(f - want(t)) / want(t), `t=${t}`).toBeLessThan(0.05);
  });

  it('clamps to the recorded range instead of inventing pitch', () => {
    const voice = new ScrubVoice(source, 9);
    expect(voice.positionFor(10)).toBe(source.at[0]);
    expect(voice.positionFor(1e5)).toBe(source.at[source.at.length - 1]);
    const out = render(voice, 1, () => 1e5);
    const heard = pitchOf(out.subarray(Math.floor(SR * 0.3)));
    expect(heard).toBeGreaterThan(280);
    expect(heard).toBeLessThan(320);
  });

  it('stays finite and no louder than the recording, including the first grain', () => {
    const voice = new ScrubVoice(source, 11);
    const out = render(voice, 2, (t) => 100 + 200 * Math.abs(Math.sin(t * 5)));
    let peak = 0;
    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
      peak = Math.max(peak, Math.abs(v));
    }
    let sourcePeak = 0;
    for (const v of source.pcm) sourcePeak = Math.max(sourcePeak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(sourcePeak * 1.15);
    expect(peak).toBeGreaterThan(sourcePeak * 0.3);
  });

  it('renders the same samples for the same seed, and fades gains linearly across a block', () => {
    const a = render(new ScrubVoice(source, 21), 1, () => 200);
    const b = render(new ScrubVoice(source, 21), 1, () => 200);
    expect(Array.from(a.subarray(5000, 5010))).toEqual(Array.from(b.subarray(5000, 5010)));
    const voice = new ScrubVoice(source, 21);
    const loud = new Float32Array(WIN * 3);
    const quiet = new Float32Array(WIN * 3);
    voice.render(loud, loud.length, 200, 1, 1);
    new ScrubVoice(source, 21).render(quiet, quiet.length, 200, 0, 0);
    expect(quiet.every((v) => v === 0)).toBe(true);
    expect(HOP * 2).toBe(WIN);
  });
});
