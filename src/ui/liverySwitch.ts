/**
 * Studio clay or one of the four 2026 colour schemes: a row of toggle buttons, each a swatch and a name; L cycles them.
 */
import { LIVERIES, type LiveryId } from '../scene/car/livery/schemes';
import { h } from './dom';

export interface LiverySwitch {
  el: HTMLElement;
  readonly id: LiveryId;
  /** Reflect a choice without firing onChange. */
  setLivery(id: LiveryId): void;
  /** Next scheme after the current one, wrapping back to clay. Fires onChange. */
  cycle(): void;
  dispose(): void;
}

export function createLiverySwitch(initial: LiveryId, onChange: (id: LiveryId) => void): LiverySwitch {
  const buttons = new Map<LiveryId, HTMLButtonElement>();
  const group = h('div', { class: 'livery', attrs: { role: 'group', 'aria-label': 'Paint scheme', 'aria-keyshortcuts': 'L', title: 'Paint scheme (L)' } });
  for (const option of LIVERIES) {
    const swatch = h('i', { class: 'livery-swatch', attrs: { 'aria-hidden': 'true' } });
    swatch.style.background = option.swatch;
    // The name is the accessible name even where the one-row header hides the text and shows the swatch alone.
    const button = h('button', { class: 'livery-btn', attrs: { type: 'button', 'aria-pressed': 'false', 'aria-label': option.label, title: option.label } }, [
      swatch,
      h('span', { class: 'livery-name', text: option.label }),
    ]);
    button.dataset.livery = option.id;
    buttons.set(option.id, button);
    group.append(button);
  }

  let id = initial;
  function setLivery(next: LiveryId) {
    id = next;
    for (const [option, button] of buttons) button.setAttribute('aria-pressed', String(option === next));
  }
  setLivery(initial);

  const onClick = (e: MouseEvent) => {
    const next = (e.target as Element).closest<HTMLElement>('[data-livery]')?.dataset.livery as LiveryId | undefined;
    if (!next || next === id) return;
    setLivery(next);
    onChange(next);
  };
  group.addEventListener('click', onClick);

  return {
    el: group,
    get id() {
      return id;
    },
    setLivery,
    cycle() {
      const index = LIVERIES.findIndex((option) => option.id === id);
      const next = LIVERIES[(index + 1) % LIVERIES.length].id;
      setLivery(next);
      onChange(next);
    },
    dispose() {
      group.removeEventListener('click', onClick);
    },
  };
}
