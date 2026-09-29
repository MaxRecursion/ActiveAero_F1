/**
 * Inline SVG icons, drawn on a 20-unit grid with 1.6 px strokes so they sit with the hairline UI.
 * Built as DOM (not markup strings) so nothing is ever parsed from text.
 */
import { s } from './dom';

export type IconName = 'play' | 'pause' | 'reset' | 'about' | 'close' | 'graph' | 'numbers';

const STROKE = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };

const PARTS: Record<IconName, () => SVGElement[]> = {
  play: () => [s('path', { d: 'M6.5 4.5v11l9-5.5z', fill: 'currentColor' })],
  pause: () => [
    s('rect', { x: 5.5, y: 4.5, width: 3, height: 11, rx: 0.6, fill: 'currentColor' }),
    s('rect', { x: 11.5, y: 4.5, width: 3, height: 11, rx: 0.6, fill: 'currentColor' }),
  ],
  // A viewfinder with a centre dot: "back to the framed shot".
  reset: () => [
    s('path', { d: 'M3.5 7V3.5H7M13 3.5h3.5V7M16.5 13v3.5H13M7 16.5H3.5V13', ...STROKE }),
    s('circle', { cx: 10, cy: 10, r: 1.8, fill: 'currentColor' }),
  ],
  about: () => [
    s('circle', { cx: 10, cy: 10, r: 7, ...STROKE }),
    s('path', { d: 'M8 8.1a2.1 2.1 0 1 1 3 1.9c-.6.3-1 .8-1 1.5v.4', ...STROKE }),
    s('circle', { cx: 10, cy: 14.3, r: 0.95, fill: 'currentColor' }),
  ],
  close: () => [s('path', { d: 'M5 5l10 10M15 5L5 15', ...STROKE })],
  graph: () => [s('path', { d: 'M3.5 3.5v13h13M5.5 14.5c4 0 7-3 9.5-9', ...STROKE })],
  // A spec-sheet table: header rule and a column rule.
  numbers: () => [
    s('rect', { x: 3.5, y: 4, width: 13, height: 12, rx: 1.2, ...STROKE }),
    s('path', { d: 'M3.5 8h13M8.5 8v8M8.5 12h8', ...STROKE }),
  ],
};

export function icon(name: IconName): SVGSVGElement {
  return s('svg', { viewBox: '0 0 20 20', width: 20, height: 20, 'aria-hidden': 'true', focusable: 'false', class: 'icon' }, PARTS[name]());
}
