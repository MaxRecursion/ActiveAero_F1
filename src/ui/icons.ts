/**
 * Inline SVG icons, drawn on a 20-unit grid with 1.6 px strokes so they sit with the hairline UI.
 * Built as DOM (not markup strings) so nothing is ever parsed from text.
 */
import { s } from './dom';

export type IconName = 'play' | 'pause' | 'reset' | 'about' | 'close' | 'graph' | 'numbers' | 'wheel' | 'replay' | 'volume' | 'volumeMuted' | 'sun' | 'moon';

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
  // A wheel seen side-on: tyre, the brake disc inside it, and the hub.
  wheel: () => [
    s('circle', { cx: 10, cy: 10, r: 7.4, ...STROKE }),
    s('circle', { cx: 10, cy: 10, r: 4.4, ...STROKE, 'stroke-dasharray': '1.6 1.9' }),
    s('circle', { cx: 10, cy: 10, r: 1.4, fill: 'currentColor' }),
  ],
  replay: () => [s('path', { d: 'M4.2 10a5.8 5.8 0 1 0 1.9-4.3M4 3.6v3.6h3.6', ...STROKE })],
  volume: () => [
    s('path', { d: 'M3 8v4h3l4 3V5L6 8H3M13 8a3 3 0 0 1 0 4M14.5 5.5a6.5 6.5 0 0 1 0 9', ...STROKE }),
  ],
  volumeMuted: () => [
    s('path', { d: 'M3 8v4h3l4 3V5L6 8H3M13 8l4 4M17 8l-4 4', ...STROKE }),
  ],
  sun: () => [
    s('circle', { cx: 10, cy: 10, r: 3.2, ...STROKE }),
    s('path', { d: 'M10 2.5v1.8M10 15.7v1.8M17.5 10h-1.8M4.3 10H2.5M15.3 4.7 14 6M6 14l-1.3 1.3M15.3 15.3 14 14M6 6 4.7 4.7', ...STROKE }),
  ],
  moon: () => [s('path', { d: 'M16.2 12.6A6.7 6.7 0 0 1 7.4 3.8a6.8 6.8 0 1 0 8.8 8.8Z', ...STROKE })],
  // A spec-sheet table: header rule and a column rule.
  numbers: () => [
    s('rect', { x: 3.5, y: 4, width: 13, height: 12, rx: 1.2, ...STROKE }),
    s('path', { d: 'M3.5 8h13M8.5 8v8M8.5 12h8', ...STROKE }),
  ],
};

export function icon(name: IconName): SVGSVGElement {
  return s('svg', { viewBox: '0 0 20 20', width: 20, height: 20, 'aria-hidden': 'true', focusable: 'false', class: 'icon' }, PARTS[name]());
}
