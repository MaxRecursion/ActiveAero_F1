/**
 * Car sound. The engine is a real recording (see sound/samples/CREDITS.txt) played by position, not
 * by speed: an AudioWorklet reads it at the rpm the drive model asks for (sound/scrub.ts), with one
 * recording under power and one off it, and throttle and load balance between them so the engine
 * itself changes character, not just its volume. Front and rear wing travel, wind, tyres and brakes
 * are quiet noise layers underneath.
 *
 * Nothing here synthesises an engine: no oscillators anywhere. If a recording is missing or will not
 * decode, the engine is silent. Nothing is fetched, decoded or started until the listener first
 * turns sound on, and muting silences every layer and suspends the audio context.
 */
import { ESTIMATES } from '../physics/constants';
import {
  IDLE_RPM,
  TOP_GEAR_RPM,
  steadyLoad,
  stepFlaps,
  stepGear,
  type FlapStep,
  type GearStep,
} from './sound/drive';
import { ENGINE_SAMPLES } from './sound/samples/engine';
import type { EngineSamples, VoiceSpec } from './sound/samples';
import { ENGINE_VOICE, type VoiceSourceMessage } from './sound/voiceProtocol';
import workletUrl from './sound/engineVoice.worklet.ts?worker&url';

export interface SoundInput {
  kmh: number;
  /** 0 Corner … 1 Straight: the animated flap position. */
  straightT: number;
  /** 0 overrun … 1 full power. Omitted: the car is holding this speed. */
  load?: number;
  /** 0–1 brake intensity. */
  brake?: number;
  /** Signed motor kW: + deploying, − harvesting. */
  mguKKw?: number;
}

export type EngineState = 'asleep' | 'loading' | 'ready' | 'failed';

export interface SoundReadout {
  gear: number;
  rpm: number;
  load: number;
  brake: number;
  mguKKw: number;
  straightT: number;
  muted: boolean;
  engine: EngineState;
}

export interface EngineSoundOptions {
  /** Use this context (tests render offline); otherwise one is made when sound is first turned on. */
  context?: BaseAudioContext;
  samples?: EngineSamples;
  /** Fetch an audio file; replaced in tests. */
  fetchAudio?: (url: string) => Promise<ArrayBuffer>;
  /** Where the worklet module is loaded from; replaced in tests. */
  workletModule?: string;
  /** Play the wing, wind, tyre and brake layers too. Default true; the render rig turns them off to measure the engine alone. */
  layers?: boolean;
}

const clamp01 = (n: number) => (n <= 0 ? 0 : n >= 1 ? 1 : n);
const DRAG_OPEN = ESTIMATES.straightMode.cdAFactor;
/** A gear change takes the power off for this long, s. */
const SHIFT_CUT_S = 0.09;
/** The engine's level at the bus, relative to the recording's own level. */
const ENGINE_LEVEL = 0.9;
/** The engine's level at idle, as a share of its level at the top of the rev range. */
const IDLE_LEVEL = 0.5;

interface Graph {
  ctx: BaseAudioContext;
  /** Where every layer, the engine included, joins before the master fader. */
  bus: AudioNode;
  master: GainNode;
  engine: AudioWorkletNode | null;
  wind: GainNode;
  tyre: GainNode;
  rush: GainNode;
  latch: GainNode;
  brake: GainNode;
}

function band(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q: number): BiquadFilterNode {
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  return filter;
}

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x2545f491;
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = seed / 2147483648 - 1;
  }
  return buffer;
}

const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`engine recording ${res.status}`);
  return res.arrayBuffer();
};

/** A decoded recording as one mono channel. */
function mono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += data[i] / buffer.numberOfChannels;
  }
  return out;
}

export function createEngineSound(options: EngineSoundOptions = {}) {
  const samples = options.samples ?? ENGINE_SAMPLES;
  const getBytes = options.fetchAudio ?? fetchBytes;
  let ctx: BaseAudioContext | undefined = options.context;
  let graph: Graph | undefined;
  let engine: EngineState = 'asleep';
  let muted = true;
  let disposed = false;
  let primed = false;
  let suspendTimer: ReturnType<typeof setTimeout> | undefined;
  let heardFlaps = false;
  let prevStraight = 0;
  let prevGear = 1;
  let cutUntil = -1;
  let ready: Promise<void> = Promise.resolve();

  const held = { kmh: 0, straightT: 0, hasLoad: false, load: 0, brake: 0, mguKKw: 0 };
  const gear: GearStep = { gear: 1, rpm: IDLE_RPM };
  const flaps: FlapStep = { moving: false, direction: 0, latchedOpen: false, latchedClosed: false };
  const readout: SoundReadout = {
    gear: 1,
    rpm: IDLE_RPM,
    load: 0,
    brake: 0,
    mguKKw: 0,
    straightT: 0,
    muted: true,
    engine: 'asleep',
  };

  /** Move `param` toward `value`; the first call lands there at once so nothing sweeps up from zero. */
  function glide(param: AudioParam, value: number, seconds: number, at: number) {
    if (!primed) param.setValueAtTime(value, at);
    else param.setTargetAtTime(value, at, seconds);
  }

  /** A one-shot decay. The floor is tiny because an exponential ramp cannot land on zero. */
  function puff(param: AudioParam, peak: number, decay: number, at: number) {
    param.cancelScheduledValues(at);
    param.setValueAtTime(Math.max(peak, 0.0008), at);
    param.exponentialRampToValueAtTime(0.0008, at + decay);
  }

  function build(c: BaseAudioContext): Graph {
    const master = c.createGain();
    master.gain.value = 0;
    const compressor = c.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 10;
    compressor.ratio.value = 2;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.25;
    compressor.connect(master);
    master.connect(c.destination);

    const noise = c.createBufferSource();
    noise.buffer = noiseBuffer(c);
    noise.loop = true;
    const layer = (type: BiquadFilterType, freq: number, q: number) => {
      const filter = band(c, type, freq, q);
      const gain = c.createGain();
      gain.gain.value = 0;
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(compressor);
      return gain;
    };
    const wind = layer('lowpass', 480, 0.7);
    const tyre = layer('bandpass', 2200, 0.5);
    const rush = layer('bandpass', 900, 0.5);
    const latch = layer('highpass', 1400, 0.7);
    const brake = layer('bandpass', 1600, 0.8);
    noise.start();
    return { ctx: c, bus: compressor, master, engine: null, wind, tyre, rush, latch, brake };
  }

  /** Gear, load and flap edges from this frame's input. */
  function sense(at: number) {
    stepGear(gear.gear, held.kmh, gear);
    // One gear at a time is a shift the driver makes; a slider jump across many gears is not.
    if (Math.abs(gear.gear - prevGear) === 1) cutUntil = at + SHIFT_CUT_S;
    prevGear = gear.gear;
    held.load = held.hasLoad ? clamp01(held.load) : steadyLoad(held.kmh, held.straightT);
    if (!heardFlaps) {
      prevStraight = held.straightT;
      heardFlaps = true;
      flaps.moving = false;
      flaps.direction = 0;
      flaps.latchedOpen = false;
      flaps.latchedClosed = false;
    } else {
      stepFlaps(prevStraight, held.straightT, flaps);
      prevStraight = held.straightT;
    }
    readout.gear = gear.gear;
    readout.rpm = gear.rpm;
    readout.load = held.load;
    readout.brake = held.brake;
    readout.mguKKw = held.mguKKw;
    readout.straightT = held.straightT;
  }

  /** The source frequency a voice plays for engine speed `rpm`, read off the voice's own rev curve. */
  function f0For(spec: VoiceSpec, rpm: number): number {
    const u = clamp01((rpm - IDLE_RPM) / (TOP_GEAR_RPM - IDLE_RPM));
    const curve = spec.rev;
    for (let i = 1; i < curve.length; i++) {
      if (u <= curve[i][0]) {
        const [u0, f0] = curve[i - 1];
        const [u1, f1] = curve[i];
        return f0 + ((f1 - f0) * (u - u0)) / (u1 - u0);
      }
    }
    return curve[curve.length - 1][1];
  }

  function apply(at: number) {
    const g = graph;
    if (!g) return;
    const kmh = held.kmh;
    const speedN = Math.min(1.3, Math.max(0, kmh / 300));
    const straight = clamp01(held.straightT);
    // A gear change takes the power off for an instant: the engine falls onto its overrun voice, then back.
    const load = at < cutUntil ? Math.min(held.load, 0.05) : held.load;

    if (g.engine && engine === 'ready') {
      const p = g.engine.parameters;
      glide(p.get('rpmPower')!, f0For(samples.power, gear.rpm), 0.035, at);
      glide(p.get('rpmCoast')!, f0For(samples.coast, gear.rpm), 0.035, at);
      // Equal-power balance between the two recordings, and a parked car is a good deal quieter than one at the limit.
      const level = (IDLE_LEVEL + (1 - IDLE_LEVEL) * clamp01((gear.rpm - IDLE_RPM) / (TOP_GEAR_RPM - IDLE_RPM))) * ENGINE_LEVEL;
      glide(p.get('power')!, Math.sqrt(load) * samples.power.gain * level, 0.04, at);
      glide(p.get('coast')!, Math.sqrt(1 - load) * samples.coast.gain * level, 0.05, at);
    }

    const drag = 1 + (DRAG_OPEN - 1) * straight;
    if (options.layers === false) return finishFrame();
    glide(g.wind.gain, 0.1 * speedN * speedN * drag, 0.16, at);
    glide(g.tyre.gain, 0.04 * Math.min(1, speedN), 0.12, at);
    const opening = flaps.direction > 0 ? 1 : 0.4;
    glide(g.rush.gain, (flaps.moving ? 1 : 0) * 0.12 * speedN * speedN * opening, 0.05, at);
    glide(g.brake.gain, clamp01(held.brake) * Math.min(1, kmh / 140) * 0.08, 0.06, at);
    if (flaps.latchedOpen || flaps.latchedClosed) puff(g.latch.gain, 0.12, 0.06, at);
    finishFrame();
  }

  function finishFrame() {
    flaps.latchedOpen = false;
    flaps.latchedClosed = false;
    primed = true;
  }

  /** Fetch, decode and hand the recordings to the worklet. Any failure leaves the engine silent. */
  async function loadEngine(c: BaseAudioContext, g: Graph) {
    engine = 'loading';
    readout.engine = engine;
    try {
      if (!samples.power.url || !samples.coast.url) throw new Error('engine recording missing');
      await c.audioWorklet.addModule(options.workletModule ?? workletUrl);
      const decoded = new Map<string, Float32Array>();
      for (const spec of [samples.power, samples.coast]) {
        if (decoded.has(spec.url)) continue;
        const bytes = await getBytes(spec.url);
        decoded.set(spec.url, mono(await c.decodeAudioData(bytes)));
      }
      if (disposed) return;
      const source = (spec: VoiceSpec, first: boolean) => {
        const pcm = decoded.get(spec.url)!;
        const k = c.sampleRate / spec.map.sr;
        return { pcm: first ? pcm : pcm.slice(), rpm: Float32Array.from(spec.map.f0), at: Float32Array.from(spec.map.at, (v) => v * k) };
      };
      const message: VoiceSourceMessage = {
        type: 'sources',
        power: source(samples.power, true),
        coast: source(samples.coast, samples.coast.url !== samples.power.url),
      };
      const node = new AudioWorkletNode(c, ENGINE_VOICE, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      const transfer = new Set<ArrayBuffer>();
      for (const s of [message.power, message.coast]) transfer.add(s.pcm.buffer as ArrayBuffer);
      node.port.postMessage(message, [...transfer]);
      node.connect(g.bus);
      g.engine = node;
      engine = 'ready';
    } catch {
      // A missing or undecodable recording is never replaced with a synthesised engine.
      engine = 'failed';
    }
    readout.engine = engine;
  }

  /** Create the context on first use and start loading. Must run inside the listener's click. */
  function wake() {
    if (disposed || graph) return;
    if (!ctx) ctx = new AudioContext();
    graph = build(ctx);
    ready = loadEngine(ctx, graph);
  }

  function update(input: SoundInput, atTime?: number) {
    held.kmh = input.kmh > 0 ? input.kmh : 0;
    held.straightT = input.straightT;
    held.load = input.load ?? 0;
    held.hasLoad = input.load !== undefined;
    held.brake = input.brake ?? 0;
    held.mguKKw = input.mguKKw ?? 0;
    const at = atTime ?? (ctx ? ctx.currentTime : 0);
    sense(at);
    if (!graph || (muted && primed)) {
      flaps.latchedOpen = false;
      flaps.latchedClosed = false;
      return;
    }
    apply(at);
  }

  function setMuted(on: boolean, atTime?: number) {
    muted = on;
    readout.muted = on;
    if (suspendTimer) clearTimeout(suspendTimer);
    if (!on) {
      primed = false; // land on the current state at once rather than gliding from where it was muted
      wake();
      if (ctx instanceof AudioContext && ctx.state === 'suspended') void ctx.resume().catch(() => {});
    }
    if (!graph || !ctx) return;
    const at = atTime ?? ctx.currentTime;
    const gain = graph.master.gain;
    gain.cancelScheduledValues(at);
    gain.setValueAtTime(gain.value, at);
    gain.linearRampToValueAtTime(on ? 0 : 1, at + 0.04);
    // Muted for real: once the fade has finished the context stops running.
    if (on && ctx instanceof AudioContext) {
      const live = ctx;
      suspendTimer = setTimeout(() => {
        if (muted && !disposed) void live.suspend().catch(() => {});
      }, 120);
    }
  }

  function dispose() {
    disposed = true;
    if (suspendTimer) clearTimeout(suspendTimer);
    if (graph && ctx instanceof AudioContext && !options.context) void ctx.close();
    graph = undefined;
    engine = 'asleep';
    readout.engine = engine;
  }

  return {
    update,
    setMuted,
    /** Resolves once the recordings have loaded (or failed); tests await it. */
    whenReady: () => ready,
    read: () => readout,
    dispose,
  };
}

export type EngineSound = ReturnType<typeof createEngineSound>;
