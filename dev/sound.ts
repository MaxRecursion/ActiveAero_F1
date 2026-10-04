/**
 * Offline render rig for the car sound. scripts/render-audio.mjs opens this page and calls
 * `window.__render(scenario, options)`; the real engine module runs against an OfflineAudioContext,
 * driven frame by frame with the cues the stations send, and the stereo result comes back as arrays.
 */
import { createEngineSound } from '../src/app/engineSound';
import type { EngineSamples } from '../src/app/sound/samples';
import { SCENARIOS } from './soundScenarios';

export interface RenderOptions {
  /** Replace the shipped recordings (urls are keys for `window.__bytes`). */
  samples?: EngineSamples;
  /** false = engine alone, no wing/wind/tyre/brake layers. */
  layers?: boolean;
  sampleRate?: number;
  /** Seconds of tail after the last cue. */
  tail?: number;
}

declare global {
  interface Window {
    __bytes?: (key: string) => Promise<string>;
    __render?: (scenario: string, options: RenderOptions) => Promise<{ sr: number; left: string; right: string; engine: string; trace: { t: number; gear: number; rpm: number; load: number; brake: number }[] }>;
    __ready?: boolean;
  }
}

const toBase64 = (a: Float32Array) => {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

window.__render = async (scenario, options) => {
  const frames = SCENARIOS[scenario]?.();
  if (!frames) throw new Error(`unknown scenario ${scenario}`);
  const sr = options.sampleRate ?? 48000;
  const seconds = frames[frames.length - 1].t + (options.tail ?? 0.6);
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
  const fetchAudio = options.samples
    ? async (key: string) => {
        const b64 = await window.__bytes!(key);
        const raw = atob(b64);
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        return out.buffer;
      }
    : undefined;
  const sound = createEngineSound({ context: ctx, samples: options.samples, fetchAudio, layers: options.layers });
  sound.setMuted(false, 0);
  await sound.whenReady();
  const trace: { t: number; gear: number; rpm: number; load: number; brake: number }[] = [];
  for (const f of frames) {
    sound.update(f.input, f.t);
    const r = sound.read();
    trace.push({ t: f.t, gear: r.gear, rpm: r.rpm, load: r.load, brake: r.brake });
  }
  const buffer = await ctx.startRendering();
  return {
    sr,
    left: toBase64(buffer.getChannelData(0)),
    right: toBase64(buffer.getChannelData(1)),
    engine: sound.read().engine,
    trace,
  };
};
window.__ready = true;
