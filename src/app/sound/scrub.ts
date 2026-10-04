/**
 * Plays a recorded engine at a chosen rpm without changing the character of the recording.
 *
 * An engine's pitch is its rpm. A recording that sweeps through the rev range already holds the
 * sound of every rpm in it, each at its own natural pitch and timbre. So instead of speeding a
 * recording up or slowing it down (which squeaks or growls, and drags the exhaust and block
 * resonances with it), this finds the point of the recording where the engine was doing the
 * requested rpm and plays from there.
 *
 * Two behaviours, chosen grain by grain:
 *  - Following. While the requested rpm sits close to what the recording is doing under the
 *    playhead, the playhead just keeps moving forward at the recording's own speed, so everything
 *    that makes a real engine irregular survives. The little gap between requested and recorded rpm
 *    (a few percent at most) is closed by resampling by that same few percent.
 *  - Jumping. When the request moves away faster than that can follow, or the playhead runs out of
 *    recording, the next grain is read from where the engine was doing the requested rpm. The join is
 *    waveform-matched (WSOLA): the grain starts where the recording best continues the one before, so
 *    the firing pulses stay in step and the overlap does not phase or flange.
 *
 * Pure arithmetic on typed arrays: it runs inside an AudioWorklet and in Node tests alike.
 */

/** Grain length and hop, samples. Hann at 50 % overlap sums to exactly one. */
export const WIN = 2048;
export const HOP = WIN / 2;
const MASK = WIN - 1;
/** How far either side of the target read point a jump may slide to line up with the last grain, samples. */
const SEARCH = 640;
const COARSE = 4;
/** Prefer the target itself over an equally good match far from it (NCC is in −1…1). */
const NEAR_BIAS = 0.04;
/** The most the playback speed may differ from the recording's to close the gap to the requested rpm. */
const MAX_RATE = 0.04;

/** A recording and the rpm it was doing, as ascending (rpm, sample position) pairs. */
export interface ScrubSource {
  pcm: Float32Array;
  /** Ascending engine speeds the recording passes through. */
  rpm: Float32Array;
  /** Where the recording is at each of those speeds, in samples (ascending or descending with the rpm). */
  at: Float32Array;
}

const HANN = (() => {
  const w = new Float32Array(WIN);
  for (let i = 0; i < WIN; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN);
  return w;
})();

/** Small deterministic noise so renders are repeatable. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

export class ScrubVoice {
  private readonly pcm: Float32Array;
  private readonly rpm: Float32Array;
  private readonly at: Float32Array;
  /** The same table ordered by position, for asking what rpm the recording is doing at a point. */
  private readonly byPos: { at: Float32Array; rpm: Float32Array };
  private readonly ring = new Float32Array(WIN);
  private readonly random: () => number;
  private writeIndex = 0;
  private phase = 0;
  /** Start of the previous grain in the recording and the speed it was read at; negative = none yet. */
  private prevStart = -1;
  private prevRate = 1;
  private wander = 0;
  /** The most the pitch may drift from the requested rpm, as a fraction: a real engine never holds one speed exactly. */
  jitter = 0.008;

  constructor(source: ScrubSource, seed = 1) {
    this.pcm = source.pcm;
    this.rpm = source.rpm;
    this.at = source.at;
    this.random = rng(seed);
    const order = Array.from(source.at.keys()).sort((a, b) => source.at[a] - source.at[b]);
    this.byPos = {
      at: Float32Array.from(order, (i) => source.at[i]),
      rpm: Float32Array.from(order, (i) => source.rpm[i]),
    };
  }

  get minRpm(): number {
    return this.rpm[0];
  }
  get maxRpm(): number {
    return this.rpm[this.rpm.length - 1];
  }

  /** Where in the recording the engine was doing `rpm`, in samples (clamped to the recorded range). */
  positionFor(rpm: number): number {
    const r = this.rpm;
    const n = r.length;
    if (rpm <= r[0]) return this.at[0];
    if (rpm >= r[n - 1]) return this.at[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (r[mid] <= rpm) lo = mid;
      else hi = mid;
    }
    const k = (rpm - r[lo]) / (r[hi] - r[lo]);
    return this.at[lo] + (this.at[hi] - this.at[lo]) * k;
  }

  /** What rpm the recording is doing at sample position `pos` (clamped to the mapped stretch). */
  rpmAt(pos: number): number {
    const { at, rpm } = this.byPos;
    const n = at.length;
    if (pos <= at[0]) return rpm[0];
    if (pos >= at[n - 1]) return rpm[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (at[mid] <= pos) lo = mid;
      else hi = mid;
    }
    const span = at[hi] - at[lo];
    const k = span > 0 ? (pos - at[lo]) / span : 0;
    return rpm[lo] + (rpm[hi] - rpm[lo]) * k;
  }

  /**
   * Add `n` samples of the engine at `rpm` into `out`, with the gain ramping linearly from `g0`
   * to `g1` across the block.
   */
  render(out: Float32Array, n: number, rpm: number, g0: number, g1: number): void {
    const step = n > 0 ? (g1 - g0) / n : 0;
    let g = g0;
    for (let i = 0; i < n; i++) {
      if (this.phase === 0) this.startGrain(rpm);
      const slot = this.writeIndex & MASK;
      out[i] += this.ring[slot] * g;
      this.ring[slot] = 0;
      this.writeIndex++;
      if (++this.phase === HOP) this.phase = 0;
      g += step;
    }
  }

  /** The recording at a fractional position, linearly interpolated. */
  private sample(pos: number): number {
    const i = Math.floor(pos);
    const f = pos - i;
    return this.pcm[i] * (1 - f) + this.pcm[i + 1] * f;
  }

  private startGrain(requested: number): void {
    const len = this.pcm.length;
    // A slow random walk (about a second to forget a nudge), not a flutter: speed hunts, it does not buzz.
    this.wander += (this.random() - 0.5) * 0.0027 - this.wander * 0.02;
    this.wander = Math.max(-this.jitter, Math.min(this.jitter, this.wander));
    const wanted = Math.max(this.minRpm, Math.min(this.maxRpm, requested)) * (1 + this.wander);

    let start = -1;
    let rate = 1;
    if (this.prevStart >= 0) {
      // Keep going: the natural continuation of the last grain, if the engine there is close enough.
      const next = this.prevStart + HOP * this.prevRate;
      const centre = next + 0.5 * WIN * this.prevRate;
      const wantRate = wanted / Math.max(1e-6, this.rpmAt(centre));
      if (Math.abs(wantRate - 1) <= MAX_RATE && next >= 1 && next + WIN * wantRate < len - 2) {
        start = next;
        rate = wantRate;
      }
    }
    if (start < 0) {
      // Jump to where the engine was doing the wanted rpm, joined to the last grain by waveform match.
      const target = this.positionFor(wanted) - 0.5 * WIN;
      const here = Math.max(1, Math.min(len - WIN * (1 + MAX_RATE) - 3, Math.round(target)));
      rate = Math.max(1 - MAX_RATE, Math.min(1 + MAX_RATE, wanted / Math.max(1e-6, this.rpmAt(here + 0.5 * WIN))));
      start = this.prevStart >= 0 ? this.bestMatch(here, rate) : here;
    }
    const ring = this.ring;
    let slot = this.writeIndex & MASK;
    let pos = start;
    for (let j = 0; j < WIN; j++) {
      ring[slot] += this.sample(pos) * HANN[j];
      slot = (slot + 1) & MASK;
      pos += rate;
    }
    this.prevStart = start;
    this.prevRate = rate;
  }

  /** The grain start near `target` whose first half best continues the previous grain's second half. */
  private bestMatch(target: number, rate: number): number {
    const pcm = this.pcm;
    const len = pcm.length;
    const limit = len - Math.ceil(WIN * (1 + MAX_RATE)) - 3;
    const lo = Math.max(1, target - SEARCH);
    const hi = Math.min(limit, target + SEARCH);
    // What the previous grain was about to play next, in its own resampled time.
    const ref = new Float32Array(HOP / COARSE);
    let refEnergy = 1e-9;
    for (let k = 0; k < ref.length; k++) {
      const v = this.sample(this.prevStart + (HOP + k * COARSE) * this.prevRate);
      ref[k] = v;
      refEnergy += v * v;
    }
    const score = (s: number, stride: number): number => {
      let dot = 0;
      let energy = 1e-9;
      for (let k = 0; k < ref.length; k += stride) {
        const v = this.sample(s + k * COARSE * rate);
        dot += ref[k] * v;
        energy += v * v;
      }
      return dot / Math.sqrt(energy * refEnergy * (stride === 1 ? 1 : 1)) - (NEAR_BIAS * Math.abs(s - target)) / SEARCH;
    };
    let best = target;
    let bestScore = -Infinity;
    for (let s = lo; s <= hi; s += COARSE) {
      const v = score(s, 1);
      if (v > bestScore) {
        bestScore = v;
        best = s;
      }
    }
    return best;
  }
}
