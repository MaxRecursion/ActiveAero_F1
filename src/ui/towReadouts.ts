import type { Station5View } from './types';
import { h, textSlot } from './dom';
import { fmtKN, fmtKW } from './format';

export interface TowReadouts {
  control: HTMLElement;
  el: HTMLElement;
  render(view: Station5View): void;
  dispose(): void;
}

function stat(label: string, tone: 'drag' | 'down' | 'energy') {
  const value = h('span', 'tow-stat-value');
  const note = h('span', 'tow-stat-note');
  return {
    el: h('div', `tow-stat tow-stat--${tone}`, [h('span', 'micro', [label]), value, note]),
    value: textSlot(value),
    note: textSlot(note),
  };
}

export function createTowReadouts(onGapInput: (gapM: number) => void): TowReadouts {
  const gapValue = h('span', 'tow-gap-value', ['6.0 m']);
  const gapInput = h('input', {
    attrs: {
      id: 'tow-gap-input',
      type: 'range',
      min: '2',
      max: '12',
      step: '0.5',
      value: '6',
      'aria-label': 'Gap between the cars',
    },
  });
  const control = h('div', 'tow-gap-control', [
    h('label', { class: 'tow-gap-label', attrs: { for: 'tow-gap-input' } }, [h('span', 'micro', ['Following gap']), gapValue]),
    gapInput,
    h('div', { class: 'tow-gap-ends', attrs: { 'aria-hidden': 'true' } }, [h('span', { text: '2 m' }), h('span', { text: '12 m' })]),
  ]);

  const drag = stat('Drag saved', 'drag');
  const power = stat('Power saved', 'energy');
  const downforce = stat('Downforce lost', 'down');
  const wake = stat('Wake strength', 'energy');
  const el = h('section', { class: 'zone zone-read zone-tow', attrs: { 'aria-label': 'Slipstream comparison' } }, [
    h('h2', 'micro zone-title', [h('span', { class: 'idx', text: 'E' }), 'Following car']),
    h('div', 'tow-metrics', [drag.el, power.el, downforce.el, wake.el]),
  ]);

  const onInput = () => onGapInput(Number(gapInput.value));
  gapInput.addEventListener('input', onInput);

  return {
    control,
    el,
    render(view) {
      if (gapInput.value !== String(view.gapM)) gapInput.value = String(view.gapM);
      gapValue.textContent = `${view.gapM.toFixed(1)} m`;
      drag.value(fmtKN(view.leadingDragN - view.followingDragN));
      drag.note(`${Math.round(view.dragReduction * 100)}% less than the lead car`);
      power.value(fmtKW(view.powerSavedW));
      power.note('drag power no longer needed');
      downforce.value(fmtKN(view.leadingDownforceN - view.followingDownforceN));
      downforce.note(`${Math.round(view.downforceLoss * 100)}% less load on the follower`);
      wake.value(`${Math.round(view.wakeStrength * 100)}%`);
      wake.note('estimated wake at this gap');
    },
    dispose() {
      gapInput.removeEventListener('input', onInput);
    },
  };
}