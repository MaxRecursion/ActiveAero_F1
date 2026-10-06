/**
 * Station tabs in the header ("01 Downforce", "02 Active aero").
 *
 * WAI-ARIA tabs with automatic activation: one tab in the Tab order (roving tabindex),
 * ←/→/Home/End move between stations. The whole dock is the tab panel.
 */
import type { StationId, StationMeta } from './types';
import { h } from './dom';

export interface StationTabs {
  el: HTMLElement;
  /** Select a tab without firing onPick. */
  select(id: StationId): void;
  dispose(): void;
}

export function createTabs(stations: StationMeta[], panelId: string, onPick: (id: StationId) => void): StationTabs {
  const tabs = stations.map((m, i) => {
    const b = h('button', {
      class: 'tab',
      attrs: { type: 'button', role: 'tab', id: `tab-${m.id}`, 'aria-selected': 'false', 'aria-controls': panelId, 'aria-keyshortcuts': String(i + 1), tabindex: '-1' },
    }, [h('span', { class: 'tab-num', text: m.number }), h('span', { class: 'tab-title', text: m.title })]);
    b.dataset.station = m.id;
    return b;
  });
  const el = h('div', { class: 'tabs', attrs: { role: 'tablist', 'aria-label': 'Stations' } }, tabs);

  function select(id: StationId) {
    for (const t of tabs) {
      const on = t.dataset.station === id;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on) reveal(t);
    }
  }

  /** On a phone the strip scrolls: bring the current tab into it (only the strip moves, never the page). */
  function reveal(tab: HTMLElement) {
    requestAnimationFrame(() => {
      const strip = el.getBoundingClientRect();
      const t = tab.getBoundingClientRect();
      if (t.left < strip.left) el.scrollLeft -= strip.left - t.left + 12;
      else if (t.right > strip.right) el.scrollLeft += t.right - strip.right + 12;
    });
  }

  const pick = (tab: HTMLElement | undefined, focus = false) => {
    if (!tab) return;
    if (focus) tab.focus();
    if (tab.getAttribute('aria-selected') !== 'true') onPick(tab.dataset.station as StationId);
  };
  const onClick = (e: MouseEvent) => pick((e.target as Element).closest<HTMLElement>('[role="tab"]') ?? undefined);
  const onKey = (e: KeyboardEvent) => {
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const n = tabs.length;
    const next = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    pick(tabs[next], true);
  };
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKey);

  return {
    el,
    select,
    dispose() {
      el.removeEventListener('click', onClick);
      el.removeEventListener('keydown', onKey);
    },
  };
}
