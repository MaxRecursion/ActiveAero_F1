/**
 * Station 2's primary control besides speed: Corner Mode | Straight Mode.
 *
 * Two aria-pressed buttons (only one can be pressed) with a flap glyph each, a thin bar that
 * follows the real flap position while it moves, and the rule that governs the move.
 */
import { REGS } from '../physics/constants';
import type { AeroMode } from './types';
import { h, s, styleSlot } from './dom';

export interface ModeSwitch {
  el: HTMLElement;
  /** Reflect the commanded mode without firing onChange. */
  setMode(mode: AeroMode): void;
  readonly mode: AeroMode;
  /** Per-frame: flap position, 0 = Corner … 1 = Straight. */
  render(straightT: number): void;
  dispose(): void;
}

/** Main plane plus flap, side-on: steep flap = closed (Corner), flat flap = open (Straight). */
function flapGlyph(mode: AeroMode): SVGSVGElement {
  const flap = mode === 'corner' ? 'M12.6 9.2L18 3.6' : 'M12.6 9.4L18.4 8.6';
  const line = { fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' };
  return s('svg', { viewBox: '0 0 20 14', width: 20, height: 14, 'aria-hidden': 'true', focusable: 'false', class: 'mode-glyph' }, [
    s('path', { d: 'M2 11.4L10.8 10', ...line }),
    s('path', { d: flap, ...line }),
  ]);
}

const MODES: { id: AeroMode; label: string }[] = [
  { id: 'corner', label: 'Corner Mode' },
  { id: 'straight', label: 'Straight Mode' },
];

export function createModeSwitch(onChange: (mode: AeroMode) => void): ModeSwitch {
  const buttons = new Map<AeroMode, HTMLButtonElement>();
  const group = h('div', { class: 'mode-seg', attrs: { role: 'group', 'aria-labelledby': 'mode-switch-label' } });
  for (const m of MODES) {
    const b = h('button', { class: 'mode-btn', attrs: { type: 'button', 'aria-pressed': 'false', 'aria-keyshortcuts': 'M' } }, [
      flapGlyph(m.id),
      h('span', { text: m.label }),
    ]);
    b.dataset.mode = m.id;
    buttons.set(m.id, b);
    group.append(b);
  }

  const fill = h('span', 'flap-fill');
  const { value: ms, ref } = REGS.activeAeroSwitchMs;
  const el = h('div', 'mode-switch', [
    h('div', 'mode-head', [
      h('span', { class: 'micro', text: 'Wing mode', attrs: { id: 'mode-switch-label' } }),
      h('kbd', { text: 'M', attrs: { 'aria-hidden': 'true' } }),
    ]),
    group,
    h('div', { class: 'flap', attrs: { 'aria-hidden': 'true' } }, [
      h('span', 'flap-track', [fill]),
      h('span', { class: 'flap-note', text: `Flaps ≤ ${ms} ms · FIA ${ref}` }),
    ]),
    h('p', { class: 'mode-help', text: 'No DRS in 2026 — every driver can open the wings in marked activation zones.' }),
  ]);

  let mode: AeroMode = 'corner';
  function setMode(next: AeroMode) {
    mode = next;
    for (const [id, b] of buttons) b.setAttribute('aria-pressed', String(id === next));
  }
  setMode('corner');

  const onClick = (e: MouseEvent) => {
    const id = (e.target as Element).closest<HTMLElement>('[data-mode]')?.dataset.mode as AeroMode | undefined;
    if (!id || id === mode) return;
    setMode(id);
    onChange(id);
  };
  group.addEventListener('click', onClick);

  const setFill = styleSlot(fill, '--t');
  return {
    el,
    setMode,
    get mode() {
      return mode;
    },
    render(straightT) {
      setFill(Math.min(1, Math.max(0, straightT)).toFixed(3));
    },
    dispose() {
      group.removeEventListener('click', onClick);
    },
  };
}
