/** A small synthesized engine whirr, unlocked by the first user gesture. */
export function createEngineSound() {
  let context: AudioContext | undefined;
  let engineGain: GainNode | undefined;
  let filter: BiquadFilterNode | undefined;
  let fundamental: OscillatorNode | undefined;
  let overtone: OscillatorNode | undefined;
  let speedKmh = 0;
  let muted = true;

  function unlock() {
    if (!context) {
      context = new AudioContext();
      engineGain = context.createGain();
      filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.7;
      engineGain.gain.value = 0;
      filter.connect(engineGain);
      engineGain.connect(context.destination);

      fundamental = context.createOscillator();
      fundamental.type = 'sawtooth';
      fundamental.connect(filter);
      fundamental.start();

      overtone = context.createOscillator();
      overtone.type = 'triangle';
      const overtoneGain = context.createGain();
      overtoneGain.gain.value = 0.12;
      overtone.connect(overtoneGain);
      overtoneGain.connect(filter);
      overtone.start();
    }
    if (context.state === 'suspended') void context.resume().catch(() => {});
    setSpeed(speedKmh);
  }

  function setSpeed(kmh: number) {
    speedKmh = Math.max(0, kmh);
    if (!context || !engineGain || !filter || !fundamental || !overtone) return;

    const now = context.currentTime;
    const speed = Math.min(1, speedKmh / 360);
    const frequency = 48 + speed * 112;
    fundamental.frequency.setTargetAtTime(frequency, now, 0.08);
    overtone.frequency.setTargetAtTime(frequency * 3.98, now, 0.08);
    filter.frequency.setTargetAtTime(500 + speed * 2600, now, 0.12);
    engineGain.gain.setTargetAtTime(muted || speedKmh < 2 ? 0 : 0.035 + speed * 0.07, now, 0.16);
  }

  function setMuted(on: boolean) {
    muted = on;
    setSpeed(speedKmh);
  }

  function dispose() {
    if (!context) return;
    void context.close();
    context = undefined;
  }

  return { unlock, setSpeed, setMuted, dispose };
}