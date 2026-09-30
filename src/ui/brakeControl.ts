/**
 * Station 4's own controls, added under the speed slider: the Brake button (which reads "Pause",
 * "Resume" or "Brake again" as the stop moves on) and the playback rate. The slider itself is the
 * shared speed control, relabelled "Brake from".
 */
import type { Station4View } from './types';
import { h } from './dom';
import { BRAKE_RATES, brakeAction } from './brakeMath';
import { icon, type IconName } from './icons';

export interface BrakeControlOptions {
  onPlayToggle(): void;
  onRate(rate: number): void;
}

export interface BrakeControl {
  el: HTMLElement;
  render(view: Station4View): void;
  dispose(): void;
}

const RATE_TEXT: Record<number, { text: string; name: string }> = {
  0.25: { text: '¼×', name: 'Quarter speed' },
  0.5: { text: '½×', name: 'Half speed' },
  1: { text: '1×', name: 'Real time' },
};

export function createBrakeControl(opts: BrakeControlOptions): BrakeControl {
  const label = h('span', 'brake-btn-label');
  const btn = h('button', { class: 'brake-btn', attrs: { type: 'button', 'aria-keyshortcuts': 'Space' } });
  const rateBtns = BRAKE_RATES.map((r) => {
    const b = h('button', { class: 'rate-btn', text: RATE_TEXT[r].text, attrs: { type: 'button', 'aria-label': RATE_TEXT[r].name, 'aria-pressed': 'false' } });
    b.dataset.rate = String(r);
    return b;
  });
  const rates = h('div', { class: 'rate-seg', attrs: { role: 'group', 'aria-label': 'Playback speed' } }, rateBtns);
  const el = h('div', 'brake-ctrl', [btn, h('div', 'brake-rate', [h('span', { class: 'micro brake-rate-title', text: 'Replay speed' }), rates])]);

  let lastLabel = '';
  let lastIcon: IconName | null = null;
  let lastRate = 0;
  let lastState = '';

  function setAction(text: string, name: IconName) {
    if (text !== lastLabel) {
      lastLabel = text;
      label.textContent = text;
    }
    if (name !== lastIcon) {
      lastIcon = name;
      btn.replaceChildren(icon(name), label);
    }
  }
  function setRate(r: number) {
    lastRate = r;
    for (const b of rateBtns) b.setAttribute('aria-pressed', String(Number(b.dataset.rate) === r));
  }
  setAction('Brake', 'play');
  setRate(0.5);

  const onPlay = () => opts.onPlayToggle();
  const onRate = (e: MouseEvent) => {
    const r = Number((e.target as Element).closest<HTMLElement>('[data-rate]')?.dataset.rate);
    if (!r || r === lastRate) return;
    setRate(r);
    opts.onRate(r);
  };
  btn.addEventListener('click', onPlay);
  rates.addEventListener('click', onRate);

  return {
    el,
    render(v) {
      const action = brakeAction(v.state, v.playing);
      setAction(action.label, action.icon);
      const state = v.state === 'braking' && v.playing ? 'playing' : v.state;
      if (state !== lastState) {
        lastState = state;
        btn.dataset.state = state;
      }
      if (v.rate !== lastRate) setRate(v.rate);
    },
    dispose() {
      btn.removeEventListener('click', onPlay);
      rates.removeEventListener('click', onRate);
    },
  };
}
