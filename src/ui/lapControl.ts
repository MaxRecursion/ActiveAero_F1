/**
 * Station 3, zone A — the lap control. Replaces the speed slider: the car's live speed, what the
 * power unit is doing right now (a chip in the phase's colour), play / pause and the playback
 * rate, the lap clock, and under them the lap timeline that doubles as the scrubber.
 */
import type { LapPhase } from '../physics/lap';
import type { Station3View } from './types';
import { h, textSlot } from './dom';
import { fmtKmh, fmtS } from './format';
import { icon } from './icons';
import { createLapTimeline } from './lapTimeline';
import { PHASES } from './lapMath';

export interface LapControlOptions {
  onPlayToggle(): void;
  onRate(rate: number): void;
  onScrub(tS: number): void;
}

export interface LapControl {
  el: HTMLElement;
  setPlaying(playing: boolean): void;
  render(view: Station3View): void;
  dispose(): void;
}

const RATES = [0.5, 1, 2] as const;
const rateLabel = (r: number) => `${r === 0.5 ? '0.5' : String(r)}×`;

export function createLapControl(opts: LapControlOptions): LapControl {
  const num = h('span', { class: 'speed-num', text: '0' });
  const readout = h('div', { class: 'speed-readout lap-speed-readout', attrs: { 'aria-hidden': 'true' } }, [
    num,
    h('span', { class: 'speed-unit', text: 'km/h' }),
  ]);

  const chipText = h('span', 'phase-chip-text');
  const chip = h('p', { class: 'phase-chip', attrs: { 'data-phase': 'engine' } }, [h('i', { class: 'phase-dot', attrs: { 'aria-hidden': 'true' } }), chipText]);

  const playLabel = h('span', { class: 'visually-hidden', text: 'Play lap' });
  const play = h('button', { class: 'lap-play', attrs: { type: 'button', 'aria-keyshortcuts': 'Space' } }, [icon('play'), playLabel]);
  const rateBtns = RATES.map((r) => {
    const b = h('button', { class: 'rate-btn', text: rateLabel(r), attrs: { type: 'button', 'aria-pressed': String(r === 1) } });
    b.dataset.rate = String(r);
    return b;
  });
  const rates = h('div', { class: 'rate-seg', attrs: { role: 'group', 'aria-label': 'Playback speed' } }, rateBtns);
  const ctrl = h('div', 'lap-ctrl', [play, rates]);

  const clockNow = h('span', 'lap-clock-now');
  const clockTotal = h('span', 'lap-clock-total');
  const clock = h('p', { class: 'lap-clock', attrs: { 'aria-hidden': 'true' } }, [clockNow, h('span', { class: 'lap-clock-sep', text: ' / ' }), clockTotal, h('span', { class: 'lap-clock-unit', text: ' s' })]);

  const timeline = createLapTimeline(opts.onScrub);

  const el = h('section', { class: 'zone zone-lap', attrs: { 'aria-label': 'Lap' } }, [
    h('h2', 'micro zone-title', [h('span', { class: 'idx', text: 'A' }), 'Lap']),
    h('div', 'lap-body', [readout, chip, ctrl, clock, timeline.el]),
  ]);

  const setNum = textSlot(num);
  const setChip = textSlot(chipText);
  const setNow = textSlot(clockNow);
  const setTotal = textSlot(clockTotal);
  let lastPhase: LapPhase | null = null;
  let lastRate = 1;
  let playing: boolean | null = null;

  const onPlay = () => opts.onPlayToggle();
  const onRate = (e: MouseEvent) => {
    const r = Number((e.target as Element).closest<HTMLElement>('[data-rate]')?.dataset.rate);
    if (!r || r === lastRate) return;
    setRate(r);
    opts.onRate(r);
  };
  play.addEventListener('click', onPlay);
  rates.addEventListener('click', onRate);

  function setRate(r: number) {
    lastRate = r;
    for (const b of rateBtns) b.setAttribute('aria-pressed', String(Number(b.dataset.rate) === r));
  }

  function setPlaying(on: boolean) {
    if (on === playing) return;
    playing = on;
    playLabel.textContent = on ? 'Pause lap' : 'Play lap';
    play.querySelector('svg')?.replaceWith(icon(on ? 'pause' : 'play'));
    play.classList.toggle('is-playing', on);
  }
  setPlaying(false);

  return {
    el,
    setPlaying,
    render(v) {
      setNum(fmtKmh(v.kmh));
      if (v.phase !== lastPhase) {
        lastPhase = v.phase;
        chip.dataset.phase = v.phase;
        setChip(PHASES[v.phase].label);
      }
      if (v.rate !== lastRate) setRate(v.rate);
      setNow(fmtS(v.tS));
      setTotal(fmtS(v.lap.lapTimeS));
      timeline.render(v);
    },
    dispose() {
      play.removeEventListener('click', onPlay);
      rates.removeEventListener('click', onRate);
      timeline.dispose();
    },
  };
}
