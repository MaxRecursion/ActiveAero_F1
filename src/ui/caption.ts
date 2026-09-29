/**
 * The caption — one sentence of "why" for the current state — plus Station 1's ceiling-test badge.
 * The caption is a polite live region, so it is only rewritten when its content really changes
 * (a rewrite is what gets announced).
 */
import type { CaptionRun, Station1View } from './types';
import { h, textSlot } from './dom';
import { fmtKmh, fmtRatio } from './format';

export interface Caption {
  el: HTMLElement;
  render(runs: CaptionRun[]): void;
  /** Station 1's ceiling badge; null hides it (other stations). */
  renderCeiling(view: Station1View | null): void;
}

/** Keep a number with its unit ("1.2 kN") on one line. */
const glue = (text: string) => text.replace(/(\d) (kN|km\/h|kg|kW|hp|N|m\/s|ms|%)/g, '$1 $2');

const keyOf = (runs: CaptionRun[]) => runs.map((r) => `${r.tone ?? ''}\u0000${r.text}`).join('\u0001');

export function createCaption(): Caption {
  const badgeState = h('strong', 'badge-state');
  const badgeDetail = h('span', 'badge-detail');
  const badge = h('div', { class: 'ceiling-badge', attrs: { hidden: '' } }, [
    badgeState,
    h('span', { class: 'badge-sep', text: '·' }),
    badgeDetail,
  ]);
  const text = h('p', { class: 'caption-text', attrs: { 'aria-live': 'polite' } });
  const el = h('div', 'ui-caption', [badge, text]);

  const setState = textSlot(badgeState);
  const setDetail = textSlot(badgeDetail);
  let lastRuns: CaptionRun[] | null = null;
  let lastKey = '';
  let lastCeiling: Station1View['ceiling'] = 'off';

  return {
    el,
    render(runs) {
      // Same array → nothing to do; a new array is compared by content before touching the DOM.
      if (runs === lastRuns) return;
      lastRuns = runs;
      const key = keyOf(runs);
      if (key === lastKey) return;
      lastKey = key;
      text.replaceChildren(
        ...runs.map((r) => (r.tone ? h('span', { class: `tone-${r.tone}`, text: glue(r.text) }) : document.createTextNode(glue(r.text)))),
      );
    },
    renderCeiling(view) {
      const ceiling = view?.ceiling ?? 'off';
      if (ceiling !== lastCeiling) {
        lastCeiling = ceiling;
        badge.hidden = ceiling === 'off';
        badge.dataset.state = ceiling;
      }
      if (!view) return;
      if (ceiling === 'sticks') {
        setState('Sticks');
        setDetail(`downforce ${fmtRatio(view.downforceToWeight)} × weight`);
      } else if (ceiling === 'falls') {
        setState('Falls');
        setDetail(`needs ${fmtKmh(view.ceilingSpeedKmh)} km/h`);
      }
    },
  };
}
