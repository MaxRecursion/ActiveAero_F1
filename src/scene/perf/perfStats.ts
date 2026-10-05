/**
 * The arithmetic behind the performance overlay, kept free of the DOM and of WebGL so it can be
 * tested: a frame meter that turns per-frame timings into published numbers a few times a
 * second, and a classifier that reads a WebGL renderer string as hardware or software.
 */

/**
 * Per-frame timings in, smoothed numbers out. `record()` costs a few additions per frame and
 * allocates nothing; the published values change only when a window closes.
 */
export class FrameMeter {
  /** Frames per second over the last window. */
  fps = 0;
  /** Frames per second over the last `windowMs × avgWindows` (a rolling average). */
  avgFps = 0;
  /** Mean time between frames over the last window (ms). */
  frameMs = 0;
  /** Mean main-thread time spent inside the frame over the last window (ms). */
  cpuMs = 0;

  private last = -1;
  private windowStart = -1;
  private frames = 0;
  private intervalSum = 0;
  private cpuSum = 0;
  private readonly ringFrames: Float64Array;
  private readonly ringTime: Float64Array;
  private ringNext = 0;
  private ringSize = 0;

  constructor(
    /** How often the published numbers change (ms). */
    readonly windowMs = 250,
    /** Windows in the rolling average: 40 × 250 ms = the last 10 s. */
    avgWindows = 40,
  ) {
    this.ringFrames = new Float64Array(avgWindows);
    this.ringTime = new Float64Array(avgWindows);
  }

  /**
   * Record a frame boundary at `now` (ms, performance.now clock): the frame that just ended began
   * at the previous boundary and kept the main thread busy for `cpuMs` of that interval.
   * Returns true when a window closed and the published numbers changed.
   */
  record(now: number, cpuMs: number): boolean {
    if (this.last < 0 || now < this.last) {
      // First frame, or the first after `restart()`: open a fresh window instead of counting the gap.
      this.last = this.windowStart = now;
      this.frames = this.intervalSum = this.cpuSum = 0;
      return false;
    }
    this.intervalSum += now - this.last;
    this.cpuSum += cpuMs;
    this.frames++;
    this.last = now;

    const elapsed = now - this.windowStart;
    if (elapsed < this.windowMs) return false;

    this.fps = (this.frames * 1000) / elapsed;
    this.frameMs = this.intervalSum / this.frames;
    this.cpuMs = this.cpuSum / this.frames;

    this.ringFrames[this.ringNext] = this.frames;
    this.ringTime[this.ringNext] = elapsed;
    this.ringNext = (this.ringNext + 1) % this.ringFrames.length;
    this.ringSize = Math.min(this.ringSize + 1, this.ringFrames.length);
    let frames = 0;
    let time = 0;
    for (let i = 0; i < this.ringSize; i++) {
      frames += this.ringFrames[i];
      time += this.ringTime[i];
    }
    this.avgFps = (frames * 1000) / time;

    this.windowStart = now;
    this.frames = this.intervalSum = this.cpuSum = 0;
    return true;
  }

  /**
   * The next frame opens a fresh window: call when frames stopped for a reason that is not the
   * app's speed (a hidden tab stops requestAnimationFrame). A slow frame is never mistaken for a
   * pause, so a software renderer taking seconds per frame still gets its figures.
   */
  restart() {
    this.last = -1;
  }

  /** Forget everything (used when the overlay is shown again, so old windows do not linger). */
  reset() {
    this.last = this.windowStart = -1;
    this.frames = this.intervalSum = this.cpuSum = 0;
    this.ringNext = this.ringSize = 0;
    this.fps = this.avgFps = this.frameMs = this.cpuMs = 0;
  }
}

export type GpuVerdict = 'hardware' | 'software' | 'unknown';

export interface GpuInfo {
  verdict: GpuVerdict;
  /** Short device name for display, e.g. "Apple M4" or "SwiftShader". */
  name: string;
  /** The full renderer string as the browser reported it ('' when hidden). */
  renderer: string;
}

/** Renderer strings of CPU rasterisers: Chrome's SwiftShader, Mesa's llvmpipe/softpipe/lavapipe, Windows WARP, Apple's fallback. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render driver|microsoft basic|\bwarp\b|offscreen/i;

/** What browsers report when they hide the real renderer. */
const GENERIC = /^(webkit webgl|mozilla|webgl|)$/i;

/**
 * Hardware or software, from the renderer string and the result of a
 * `failIfMajorPerformanceCaveat` probe (`true` = the browser refused a fast context).
 */
export function classifyGpu(renderer: string, caveat: boolean | null): GpuInfo {
  const raw = renderer.trim();
  const name = raw ? shortGpuName(raw) : '';
  if (SOFTWARE.test(raw)) return { verdict: 'software', name: name || 'Software', renderer: raw };
  if (caveat === true) return { verdict: 'software', name: name || 'Software', renderer: raw };
  if (raw && !GENERIC.test(raw)) return { verdict: 'hardware', name, renderer: raw };
  // The browser hides the renderer; a passed probe is still good evidence of a GPU.
  if (caveat === false) return { verdict: 'hardware', name: 'GPU', renderer: raw };
  return { verdict: 'unknown', name: 'Unknown', renderer: raw };
}

/**
 * "ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)" → "Apple M4";
 * "ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 (0x00002206) Direct3D11 vs_5_0 ps_5_0, D3D11)" → "NVIDIA GeForce RTX 3080";
 * "ANGLE (Qualcomm, Vulkan 1.3.128 (Adreno (TM) 740 (0x43050A01)), Qualcomm … Driver)" → "Adreno (TM) 740";
 * "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)" → "SwiftShader".
 */
export function shortGpuName(renderer: string): string {
  // Firefox reports a bucket ("Apple M1" for every Apple GPU) and marks it ", or similar".
  // Keep the marker so the overlay never presents the bucket as the exact device.
  const similar = /,? or similar$/i;
  const approximate = similar.test(renderer.trim());
  let s = renderer.trim().replace(similar, '');
  if (/swiftshader/i.test(s)) return 'SwiftShader';
  const angle = /^ANGLE \((.*)\)$/.exec(s);
  if (angle) {
    // "Vendor, Device, Backend": the device is everything between the first and last comma.
    const parts = angle[1].split(', ');
    s = parts.length >= 3 ? parts.slice(1, -1).join(', ') : (parts[1] ?? parts[0]);
    // ANGLE on Vulkan wraps the device: "Vulkan 1.3.128 (Adreno (TM) 740 (0x43050A01))".
    s = s.replace(/^Vulkan [\d.]+ \((.*)\)$/, '$1');
  }
  s = s
    .replace(/^ANGLE \w+ Renderer: /, '')
    .replace(/\s*\(0x[0-9a-f]+\)/gi, '')
    .replace(/\s+(Direct3D|OpenGL|Vulkan|Metal)\w*(\s.*)?$/i, '')
    .trim();
  return approximate ? `${s} or similar` : s;
}

/** 1 234 567 → "1.23M", 48 210 → "48.2k", 960 → "960". Short enough for a fixed-width cell. */
export function fmtCount(n: number): string {
  const v = Math.max(0, Math.round(n));
  // Thresholds sit where rounding would otherwise print "1000.0k" or "10.00M".
  if (v >= 9_995_000) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 999_950) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 10_000) return `${(v / 1e3).toFixed(1)}k`;
  return String(v);
}
