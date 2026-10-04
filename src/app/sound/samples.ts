/** The shape of the engine recordings the car plays. The data itself lives in samples/engine.ts. */

/** Where a recording was doing which firing frequency: ascending Hz paired with sample positions. */
export interface RpmMap {
  /** Sample rate of the source file, Hz. */
  sr: number;
  /** Firing frequency, Hz, ascending. rpm = f0 × 120 / cylinders. */
  f0: number[];
  /** The recording's position, in samples of the source file, at each of those frequencies. */
  at: number[];
}

export interface VoiceSpec {
  /** URL of the audio file. Empty means the recording is missing and this voice stays silent. */
  url: string;
  map: RpmMap;
  /** Level trim so both voices sit at the same loudness. */
  gain: number;
  /**
   * How the car's engine speed maps onto this recording: points of [position in the car's rev range 0…1, firing frequency Hz],
   * joined by straight lines. Both voices share the same curve above idle so they play one pitch; below it, a voice may
   * reach lower where its recording does (the overrun voice includes a real idle).
   */
  rev: [number, number][];
}

export interface EngineSamples {
  /** Under power. */
  power: VoiceSpec;
  /** Off power: lift, overrun, braking. */
  coast: VoiceSpec;
}
