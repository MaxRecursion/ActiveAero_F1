/** What the main thread and the engine worklet agree on. Types and one name only: safe to import anywhere. */
import type { ScrubSource } from './scrub';

/** Registered processor name. */
export const ENGINE_VOICE = 'engine-voice';

/** Sent once, after the recordings have decoded. Samples are in the audio context's rate. */
export interface VoiceSourceMessage {
  type: 'sources';
  power: ScrubSource;
  coast: ScrubSource;
}
