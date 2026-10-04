/**
 * The engine voice, running on the audio thread: two recorded engines (one under power, one off
 * it) each scrubbed to the speed the main thread asks for. All the arithmetic is in scrub.ts; this
 * file only moves samples. It is bundled as its own module and loaded with `audioWorklet.addModule`.
 */
import { ScrubVoice } from './scrub';
import { ENGINE_VOICE, type VoiceSourceMessage } from './voiceProtocol';

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

class EngineVoiceProcessor extends AudioWorkletProcessor {
  static parameterDescriptors = [
    { name: 'rpmPower', defaultValue: 100, minValue: 1, maxValue: 5000, automationRate: 'k-rate' },
    { name: 'rpmCoast', defaultValue: 100, minValue: 1, maxValue: 5000, automationRate: 'k-rate' },
    { name: 'power', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
    { name: 'coast', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
  ];

  private power: ScrubVoice | null = null;
  private coast: ScrubVoice | null = null;
  private lastPower = 0;
  private lastCoast = 0;
  private mix = new Float32Array(128);

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<VoiceSourceMessage>) => {
      if (event.data.type !== 'sources') return;
      this.power = new ScrubVoice(event.data.power, 1);
      this.coast = new ScrubVoice(event.data.coast, 2);
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][], p: Record<string, Float32Array>): boolean {
    const out = outputs[0];
    const left = out[0];
    const right = out[1] ?? left;
    const n = left.length;
    if (this.mix.length < n) this.mix = new Float32Array(n);
    const mix = this.mix;
    mix.fill(0, 0, n);
    const gp = p.power[0];
    const gc = p.coast[0];
    if (this.power && (gp > 1e-5 || this.lastPower > 1e-5)) this.power.render(mix, n, p.rpmPower[0], this.lastPower, gp);
    if (this.coast && (gc > 1e-5 || this.lastCoast > 1e-5)) this.coast.render(mix, n, p.rpmCoast[0], this.lastCoast, gc);
    this.lastPower = gp;
    this.lastCoast = gc;
    left.set(mix.subarray(0, n));
    if (right !== left) right.set(mix.subarray(0, n));
    return true;
  }
}

// Only inside an AudioWorkletGlobalScope; importing this file elsewhere (tests) registers nothing.
if (typeof (globalThis as { registerProcessor?: unknown }).registerProcessor === 'function') {
  registerProcessor(ENGINE_VOICE, EngineVoiceProcessor);
}
