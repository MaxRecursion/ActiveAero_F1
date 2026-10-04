import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngineSound } from './engineSound';
import type { EngineSamples } from './sound/samples';

vi.mock('./sound/engineVoice.worklet.ts?worker&url', () => ({ default: 'worklet.js' }));

/** A just-enough Web Audio: records what is built and every value an AudioParam is told to take. */
class FakeParam {
  value = 0;
  events: [string, number, number][] = [];
  setValueAtTime(v: number, t: number) {
    this.value = v;
    this.events.push(['set', v, t]);
  }
  setTargetAtTime(v: number, t: number) {
    this.value = v;
    this.events.push(['target', v, t]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push(['ramp', v, t]);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.events.push(['exp', v, t]);
  }
  cancelScheduledValues() {}
}
class FakeNode {
  connect() {}
  disconnect() {}
}
const contexts: FakeContext[] = [];
const built: string[] = [];
class FakeContext {
  sampleRate = 48000;
  currentTime = 0;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  destination = new FakeNode();
  suspended = 0;
  resumed = 0;
  audioWorklet = { addModule: vi.fn(async () => {}) };
  masters: FakeParam[] = [];
  constructor() {
    contexts.push(this);
  }
  private node<T extends object>(kind: string, extra: T) {
    built.push(kind);
    return Object.assign(new FakeNode(), extra);
  }
  createGain() {
    const gain = new FakeParam();
    this.masters.push(gain);
    return this.node('gain', { gain });
  }
  createDynamicsCompressor() {
    return this.node('compressor', { threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(), attack: new FakeParam(), release: new FakeParam() });
  }
  createBiquadFilter() {
    return this.node('biquad', { type: 'lowpass', frequency: new FakeParam(), Q: new FakeParam() });
  }
  createBufferSource() {
    return this.node('bufferSource', { buffer: null, loop: false, start() {} });
  }
  createBuffer(_c: number, length: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  decodeAudioData = vi.fn(async (bytes: ArrayBuffer) => {
    const data = new Float32Array(bytes.byteLength / 4 || 4096);
    return { numberOfChannels: 1, length: data.length, getChannelData: () => data };
  });
  async resume() {
    this.resumed++;
    this.state = 'running';
  }
  async suspend() {
    this.suspended++;
    this.state = 'suspended';
  }
  async close() {
    this.state = 'closed';
  }
}
const workletNodes: { params: Map<string, FakeParam>; posted: unknown[] }[] = [];
class FakeWorkletNode extends FakeNode {
  parameters = new Map<string, FakeParam>(['rpmPower', 'rpmCoast', 'power', 'coast'].map((n) => [n, new FakeParam()]));
  port = { posted: [] as unknown[], postMessage(m: unknown) { this.posted.push(m); } };
  constructor() {
    super();
    built.push('worklet');
    workletNodes.push({ params: this.parameters, posted: this.port.posted });
  }
}

const voice = { url: 'engine.m4a', map: { sr: 44100, f0: [100, 150, 200, 250], at: [0, 10000, 20000, 30000] }, gain: 1, rev: [[0, 110], [1, 240]] as [number, number][] };
const SAMPLES: EngineSamples = { power: voice, coast: { ...voice, url: 'coast.m4a' } };
const NONE: EngineSamples = { power: { ...voice, url: '' }, coast: { ...voice, url: '' } };
const fetchAudio = async () => new ArrayBuffer(40000);

beforeEach(() => {
  contexts.length = 0;
  built.length = 0;
  workletNodes.length = 0;
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('engine sound', () => {
  it('starts nothing until the listener turns sound on', () => {
    const sound = createEngineSound({ samples: SAMPLES, fetchAudio });
    for (let i = 0; i < 30; i++) sound.update({ kmh: i * 10, straightT: 0 });
    expect(contexts).toHaveLength(0);
    expect(built).toEqual([]);
    expect(sound.read().engine).toBe('asleep');
    expect(sound.read().muted).toBe(true);
  });

  it('is silent, not synthesised, when the recording is missing', async () => {
    const sound = createEngineSound({ samples: NONE, fetchAudio });
    sound.setMuted(false);
    await sound.whenReady();
    for (let i = 0; i < 30; i++) sound.update({ kmh: 100 + i * 6, straightT: 0, load: 1 });
    expect(sound.read().engine).toBe('failed');
    expect(workletNodes).toHaveLength(0);
    expect(built).not.toContain('worklet');
    expect(built).not.toContain('oscillator');
  });

  it('is silent when the recording will not decode', async () => {
    const sound = createEngineSound({ samples: SAMPLES, fetchAudio: async () => { throw new Error('404'); } });
    sound.setMuted(false);
    await sound.whenReady();
    expect(sound.read().engine).toBe('failed');
    expect(workletNodes).toHaveLength(0);
  });

  it('plays the recordings through the worklet and never builds an oscillator', async () => {
    const sound = createEngineSound({ samples: SAMPLES, fetchAudio });
    sound.setMuted(false);
    await sound.whenReady();
    expect(sound.read().engine).toBe('ready');
    expect(workletNodes).toHaveLength(1);
    const msg = workletNodes[0].posted[0] as { type: string; power: { rpm: Float32Array; at: Float32Array }; coast: { rpm: Float32Array } };
    expect(msg.type).toBe('sources');
    expect(Array.from(msg.power.rpm)).toEqual([100, 150, 200, 250]);
    // positions are converted from the file's rate to the context's
    expect(msg.power.at[1]).toBeCloseTo(10000 * (48000 / 44100), 3);
    expect(built).not.toContain('oscillator');
  });

  it('sets the voice speed from the drive model and moves the balance with load', async () => {
    const sound = createEngineSound({ samples: SAMPLES, fetchAudio });
    sound.setMuted(false);
    await sound.whenReady();
    const p = workletNodes[0].params;
    sound.update({ kmh: 0, straightT: 0, load: 0.05 }, 0);
    expect(p.get('rpmPower')!.value).toBeCloseTo(110, 1); // parked: the idle end of the recording's range
    expect(p.get('power')!.value).toBeLessThan(p.get('coast')!.value);
    sound.update({ kmh: 200, straightT: 0, load: 1 }, 1);
    expect(p.get('rpmPower')!.value).toBeGreaterThan(110);
    expect(p.get('rpmPower')!.value).toBeLessThanOrEqual(240);
    expect(p.get('power')!.value).toBeGreaterThan(0.55);
    expect(p.get('coast')!.value).toBeLessThan(0.05);
  });

  it('takes the power off for an instant at a gear change', async () => {
    const sound = createEngineSound({ samples: SAMPLES, fetchAudio });
    sound.setMuted(false);
    await sound.whenReady();
    const p = workletNodes[0].params;
    let t = 0;
    let gearBefore = 1;
    let cut = false;
    for (let kmh = 0; kmh < 120; kmh += 1.5, t += 1 / 60) {
      sound.update({ kmh, straightT: 0, load: 1 }, t);
      const g = sound.read().gear;
      if (g > gearBefore) {
        expect(p.get('power')!.value).toBeLessThan(0.3);
        cut = true;
      }
      gearBefore = g;
    }
    expect(cut).toBe(true);
  });

  it('mute silences every layer and stops the context; unmuting resumes', async () => {
    const sound = createEngineSound({ samples: SAMPLES, fetchAudio });
    sound.setMuted(false);
    await sound.whenReady();
    const ctx = contexts[0];
    sound.update({ kmh: 250, straightT: 0, load: 1 }, 0.5);
    // The one fader every layer, the engine included, passes through.
    const master = ctx.masters[0];
    sound.setMuted(true, 1);
    expect(master.events.at(-1)).toEqual(['ramp', 0, 1.04]);
    expect(sound.read().muted).toBe(true);
    vi.advanceTimersByTime(200);
    expect(ctx.suspended).toBe(1);
    // While muted the engine is not even driven.
    const before = workletNodes[0].params.get('rpmPower')!.events.length;
    sound.update({ kmh: 300, straightT: 0, load: 1 }, 2);
    expect(workletNodes[0].params.get('rpmPower')!.events.length).toBe(before);
    sound.setMuted(false, 3);
    expect(ctx.resumed).toBeGreaterThan(0);
    expect(master.events.at(-1)).toEqual(['ramp', 1, 3.04]);
  });
});
