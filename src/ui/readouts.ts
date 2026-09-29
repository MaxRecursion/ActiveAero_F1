/**
 * Zone B — the numbers: downforce (with "× car weight" and "kg pressing down"), drag, drag power,
 * and a stacked bar splitting downforce between front wing, floor and rear wing.
 *
 * Deliberately not aria-live: these change every frame during a sweep. The caption carries the
 * spoken summary; screen-reader users can read these on demand.
 */
import { ESTIMATES, type AeroSurfaceId } from '../physics/constants';
import type { Station1View } from './types';
import { h, styleSlot, textSlot } from './dom';
import { fmtHp, fmtKg, fmtKN, fmtKW, fmtRatio } from './format';

export interface Readouts {
  el: HTMLElement;
  render(view: Station1View): void;
}

type Tone = 'down' | 'drag';

/**
 * One readout cell: micro label, big number + unit, optional sub-lines.
 * `inline` puts the sub-lines on the number's baseline (saves a row where space is tight).
 */
function cell(tone: Tone, label: string, unit: string, subs: number, extra = '', inline = false) {
  const value = h('span', 'ro-num');
  const subEls = Array.from({ length: subs }, (_, i) => h('span', `ro-sub ro-sub-${i + 1}`));
  const valueRow = h('span', 'ro-value', [value, h('span', { class: 'ro-unit', text: unit }), ...(inline ? subEls : [])]);
  const el = h('div', `ro ro--${tone} ${extra}`.trim(), [
    h('span', 'micro ro-label', [h('i', { class: 'swatch', attrs: { 'aria-hidden': 'true' } }), label]),
    valueRow,
    ...(inline ? [] : subEls),
  ]);
  return { el, value: textSlot(value), subs: subEls.map(textSlot) };
}

export function createReadouts(): Readouts {
  const down = cell('down', 'Downforce', 'kN', 2, 'ro--main');
  const drag = cell('drag', 'Drag', 'kN', 0, 'ro--dragforce');
  const power = cell('drag', 'Drag power', 'kW', 1, 'ro--power', true);
  // Mobile-only cell: the "kg pressing down" line promoted to its own tile in the 2×2 grid.
  const kg = cell('down', 'Pressing down', 'kg', 0, 'ro--kg');

  const segs = new Map<AeroSurfaceId, { width: (v: string) => void; label: (v: string) => void; value: (v: string) => void }>();
  const bar = h('div', { class: 'split-bar', attrs: { 'aria-hidden': 'true' } });
  const legend = h('div', 'split-legend');
  for (const { id, share } of ESTIMATES.surfaces) {
    const seg = h('span', `split-seg split-seg--${id}`);
    seg.style.flexGrow = String(share * 100); // proportions before the first non-zero frame
    bar.append(seg);
    const label = h('span', 'split-name');
    const value = h('span', 'split-val');
    legend.append(h('span', `split-item split-item--${id}`, [h('i', { class: 'swatch', attrs: { 'aria-hidden': 'true' } }), label, value]));
    segs.set(id, { width: styleSlot(seg, 'flex-grow'), label: textSlot(label), value: textSlot(value) });
  }
  const split = h('div', 'split', [
    h('span', 'micro split-title', ['Where the downforce comes from', h('span', { class: 'split-unit', text: 'kN' })]),
    bar,
    legend,
  ]);

  const el = h('section', { class: 'zone zone-read', attrs: { 'aria-label': 'Forces' } }, [
    h('h2', 'micro zone-title', [h('span', { class: 'idx', text: 'B' }), 'Forces at this speed']),
    h('div', 'ro-grid', [down.el, drag.el, power.el, kg.el, split]),
  ]);

  return {
    el,
    render(v) {
      down.value(fmtKN(v.downforceN));
      down.subs[0](`${fmtRatio(v.downforceToWeight)} × car weight`);
      down.subs[1](`= ${fmtKg(v.downforceEquivalentKg)} kg pressing down`);
      kg.value(fmtKg(v.downforceEquivalentKg));
      drag.value(fmtKN(v.dragN));
      power.value(fmtKW(v.dragPowerW));
      power.subs[0](`≈ ${fmtHp(v.dragPowerW)} hp`);

      const total = v.surfaces.reduce((sum, x) => sum + x.downforceN, 0);
      for (const surf of v.surfaces) {
        const seg = segs.get(surf.id);
        if (!seg) continue;
        // At 0 km/h every share is 0/0; keep the last proportions instead of collapsing the bar.
        if (total > 0) seg.width(((surf.downforceN / total) * 100).toFixed(2));
        seg.label(surf.label);
        seg.value(fmtKN(surf.downforceN));
      }
    },
  };
}
