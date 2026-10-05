import { describe, expect, it } from 'vitest';
import { classifyGpu, fmtCount, FrameMeter, shortGpuName } from './perfStats';

/** Feed `count` frames spaced `intervalMs` apart, each busy for `cpuMs`; returns the last timestamp. */
function feed(meter: FrameMeter, start: number, count: number, intervalMs: number, cpuMs = 1): number {
  let t = start;
  for (let i = 0; i < count; i++) {
    meter.record(t, cpuMs);
    t += intervalMs;
  }
  return t - intervalMs;
}

describe('FrameMeter', () => {
  it('publishes nothing until a full window has passed', () => {
    const m = new FrameMeter(250);
    expect(m.record(0, 1)).toBe(false);
    expect(m.record(16, 1)).toBe(false);
    expect(m.fps).toBe(0);
  });

  it('reports fps, frame time and cpu time for a steady 60 Hz', () => {
    const m = new FrameMeter(250);
    feed(m, 1000, 40, 1000 / 60, 2.5);
    expect(m.fps).toBeCloseTo(60, 1);
    expect(m.frameMs).toBeCloseTo(16.67, 1);
    expect(m.cpuMs).toBeCloseTo(2.5, 5);
    expect(m.avgFps).toBeCloseTo(60, 1);
  });

  it('keeps the rolling average when the current rate drops', () => {
    const m = new FrameMeter(250, 40);
    const t = feed(m, 0, 60 * 9, 1000 / 60); // 9 s at 60 fps
    feed(m, t + 1000 / 30, 30, 1000 / 30); // then 1 s at 30 fps
    expect(m.fps).toBeCloseTo(30, 0);
    expect(m.avgFps).toBeGreaterThan(50);
    expect(m.avgFps).toBeLessThan(60);
  });

  it('forgets windows older than the averaging span', () => {
    const m = new FrameMeter(250, 4); // 1 s average
    const t = feed(m, 0, 120, 1000 / 60);
    feed(m, t + 1000 / 30, 60, 1000 / 30);
    expect(m.avgFps).toBeCloseTo(30, 0);
  });

  it('does not count the gap across restart() (a hidden tab), but keeps the average', () => {
    const m = new FrameMeter(250);
    const t = feed(m, 0, 60, 1000 / 60);
    // Tab hidden for 5 s, then back at 60 fps.
    m.restart();
    feed(m, t + 5000, 60, 1000 / 60);
    expect(m.fps).toBeCloseTo(60, 0);
    expect(m.avgFps).toBeCloseTo(60, 0);
    expect(m.frameMs).toBeLessThan(20);
  });

  it('still publishes when every frame takes seconds (software rendering)', () => {
    const m = new FrameMeter(250);
    feed(m, 0, 4, 1500, 1400);
    expect(m.fps).toBeCloseTo(0.667, 2);
    expect(m.frameMs).toBeCloseTo(1500, 5);
    expect(m.cpuMs).toBeCloseTo(1400, 5);
    expect(m.avgFps).toBeCloseTo(0.667, 2);
  });

  it('reset clears the published numbers', () => {
    const m = new FrameMeter(250);
    feed(m, 0, 60, 1000 / 60);
    m.reset();
    expect([m.fps, m.avgFps, m.frameMs, m.cpuMs]).toEqual([0, 0, 0, 0]);
  });
});

describe('classifyGpu', () => {
  it('reads a Metal ANGLE string as hardware', () => {
    const g = classifyGpu('ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)', false);
    expect(g).toMatchObject({ verdict: 'hardware', name: 'Apple M4' });
  });

  it.each([
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'Google SwiftShader',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
    'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Apple Software Renderer',
  ])('reads %s as software', (renderer) => {
    expect(classifyGpu(renderer, null).verdict).toBe('software');
  });

  it('trusts a failed performance-caveat probe even when the name looks like a GPU', () => {
    expect(classifyGpu('ANGLE (Intel, Intel(R) UHD Graphics 620, D3D11)', true).verdict).toBe('software');
  });

  it('falls back to the probe when the browser hides the renderer', () => {
    expect(classifyGpu('WebKit WebGL', false)).toMatchObject({ verdict: 'hardware', name: 'GPU' });
    expect(classifyGpu('', null).verdict).toBe('unknown');
  });
});

describe('shortGpuName', () => {
  it.each([
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 (0x00002206) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'NVIDIA GeForce RTX 3080'],
    ['ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics OpenGL Engine, OpenGL 4.1)', 'Intel(R) Iris(TM) Plus Graphics'],
    ['ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), or similar', 'NVIDIA GeForce GTX 980 or similar'],
    ['Apple M1, or similar', 'Apple M1 or similar'],
    ['ANGLE (Qualcomm, Vulkan 1.3.128 (Adreno (TM) 740 (0x43050A01)), Qualcomm Technologies Inc. Adreno Vulkan Driver)', 'Adreno (TM) 740'],
    ['ANGLE (ARM, Vulkan 1.1.177 (Mali-G78 (0x92020010)), Mali-G78)', 'Mali-G78'],
    ['ANGLE (Intel, Vulkan 1.3.255 (Intel(R) Xe Graphics (TGL GT2) (0x00009A49)), Intel open-source Mesa driver-23.2.1)', 'Intel(R) Xe Graphics (TGL GT2)'],
    ['Apple GPU', 'Apple GPU'],
    ['Adreno (TM) 740', 'Adreno (TM) 740'],
  ])('%s → %s', (raw, short) => {
    expect(shortGpuName(raw)).toBe(short);
  });
});

describe('fmtCount', () => {
  it.each([
    [0, '0'],
    [960, '960'],
    [9_999, '9999'],
    [48_210, '48.2k'],
    [999_949, '999.9k'],
    [999_950, '1.00M'],
    [1_234_567, '1.23M'],
    [12_345_678, '12.3M'],
  ])('%d → %s', (n, s) => {
    expect(fmtCount(n)).toBe(s);
  });
});
