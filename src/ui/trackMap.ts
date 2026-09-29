/**
 * Station 3, zone C — the circuit map, drawn by hand in SVG.
 *
 * The outline is fitted and centred in the plot (aspect kept), then painted along the lap in the
 * phase colours the timeline uses, so the two read as one picture: where the battery fills, where
 * it is spent. Corner labels sit on the outside of each bend. A dot follows the car; a click or
 * tap on the map sends the car to the nearest point of the track.
 */
import { CIRCUIT_NAME } from '../physics/track';
import type { LapTrace, Station3View } from './types';
import { attrSlot, h, s } from './dom';
import { indexAtDistance, PHASE_ORDER, PHASES, phaseRuns } from './lapMath';

export interface TrackMap {
  el: HTMLElement;
  render(view: Station3View): void;
  dispose(): void;
}

const FIT_PAD = 22;
/** Corner labels closer than this (px) share one label, e.g. "T7/8". */
const LABEL_MIN_GAP = 16;
const LABEL_OFFSET = 11;

/** Legend names are shorter than the chip's: the legend has less room. */
const LEGEND: Record<string, string> = {
  deploy: 'Deploy',
  clip: 'Super clipping',
  brake: 'Braking',
  engine: 'Engine only',
  lift: 'Mid-corner',
};

export function createTrackMap(onScrub: (tS: number) => void): TrackMap {
  const staticLayer = s('g', { class: 'map-static' });
  const labelLayer = s('g', { class: 'map-labels' });
  const car = s('circle', { class: 'map-car', r: 5.5 });
  const svg = s('svg', { class: 'map-svg', role: 'img', 'aria-label': `Map of ${CIRCUIT_NAME}` }, [staticLayer, labelLayer, s('g', { 'aria-hidden': 'true' }, [car])]);
  const plot = h('div', 'map-plot', [svg]);

  const legendItem = (phase: string) =>
    h('span', `legend-item legend-item--phase legend-item--${phase}`, [h('i', { class: 'legend-key', attrs: { 'aria-hidden': 'true' } }), LEGEND[phase]]);
  const lengthText = h('span', 'map-length');
  const el = h('section', { class: 'zone zone-chart zone-map', attrs: { 'aria-label': 'Track map' } }, [
    h('h2', 'micro zone-title', [h('span', { class: 'idx', text: 'C' }), 'Track']),
    h('div', 'chart-head', [
      h('p', 'chart-title', [CIRCUIT_NAME.replace(/ \(fictional\)$/, ''), h('span', { class: 'map-sub' }, [' · fictional · ', lengthText])]),
      h('div', 'chart-legend map-legend', PHASE_ORDER.map(legendItem)),
    ]),
    plot,
  ]);

  let w = 0;
  let ht = 0;
  let lap: LapTrace | null = null;
  let drawnFor: LapTrace | null = null;
  let pts: { x: number; y: number }[] = [];
  let sM = 0;
  const f = (n: number) => n.toFixed(1);
  const setCx = attrSlot(car, 'cx');
  const setCy = attrSlot(car, 'cy');
  const setViewBox = attrSlot(svg, 'viewBox');
  const setLength = (() => {
    let last = '';
    return (v: string) => {
      if (v !== last) lengthText.textContent = last = v;
    };
  })();

  function drawStatic() {
    if (!lap || !w || !ht || lap.map.length < 2) return;
    drawnFor = lap;
    const map = lap.map;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of map) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    // Map y grows to the left of the start heading; screen y grows down, so flip it.
    const k = Math.min((w - 2 * FIT_PAD) / Math.max(1, maxX - minX), (ht - 2 * FIT_PAD) / Math.max(1, maxY - minY));
    const ox = (w - (maxX - minX) * k) / 2;
    const oy = (ht - (maxY - minY) * k) / 2;
    pts = map.map((p) => ({ x: ox + (p.x - minX) * k, y: oy + (maxY - p.y) * k }));
    const cx = w / 2;
    const cy = ht / 2;

    const loop = pts.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join('') + 'Z';
    const parts: SVGElement[] = [s('path', { class: 'map-road-edge', d: loop }), s('path', { class: 'map-road', d: loop })];

    // Phase colour along the lap (map and trace are sampled together, one point each).
    if (lap.trace.length === pts.length) {
      for (const run of phaseRuns(lap.trace)) {
        if (run.phase === 'lift') continue; // mid-corner stays road-coloured, as on the timeline
        const end = pts[(run.to + 1) % pts.length];
        const d = pts.slice(run.from, run.to + 1).map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join('') + `L${f(end.x)} ${f(end.y)}`;
        parts.push(s('path', { class: `map-phase map-phase--${run.phase}`, d }));
      }
    }

    // Start / finish: a short bar across the track, and which way the lap runs.
    const a = pts[0];
    const b = pts[Math.min(2, pts.length - 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const tx = (b.x - a.x) / len;
    const ty = (b.y - a.y) / len;
    parts.push(s('line', { class: 'map-start', x1: f(a.x - ty * 8), y1: f(a.y + tx * 8), x2: f(a.x + ty * 8), y2: f(a.y - tx * 8) }));

    const labels: SVGElement[] = [];
    const nearestIndex = (sM: number) => Math.min(pts.length - 1, indexAtDistance(lap!.trace, sM));
    const placed: { x: number; y: number; t: SVGTextElement }[] = [];
    for (const c of lap.corners) {
      const i = lap.trace.length === pts.length ? nearestIndex(c.s) : 0;
      const p = pts[i];
      // Outside of the bend: from the midpoint of the neighbours through the apex.
      const pa = pts[(i - 3 + pts.length) % pts.length];
      const pb = pts[(i + 3) % pts.length];
      let nx = p.x - (pa.x + pb.x) / 2;
      let ny = p.y - (pa.y + pb.y) / 2;
      let nl = Math.hypot(nx, ny);
      if (nl < 0.5) {
        nx = p.x - cx;
        ny = p.y - cy;
        nl = Math.hypot(nx, ny) || 1;
      }
      const lx = p.x + (nx / nl) * LABEL_OFFSET;
      const ly = p.y + (ny / nl) * LABEL_OFFSET;
      const near = placed.find((q) => Math.hypot(q.x - lx, q.y - ly) < LABEL_MIN_GAP);
      if (near) {
        near.t.textContent += `/${c.label.replace(/^T/, '')}`;
        continue;
      }
      const anchor = nx / nl > 0.45 ? 'start' : nx / nl < -0.45 ? 'end' : 'middle';
      const t = s('text', { class: 'map-corner', x: f(lx), y: f(ly + 3.5), 'text-anchor': anchor }, [c.label]);
      placed.push({ x: lx, y: ly, t });
      labels.push(t);
    }
    // "S/F" beside the start bar, on the inside of the circuit (corner labels sit outside).
    const side = a.y < cy ? 1 : -1;
    labels.push(s('text', { class: 'map-sf', x: f(a.x), y: f(a.y + side * 14 + (side > 0 ? 4 : 0)), 'text-anchor': 'middle' }, ['S/F']));

    staticLayer.replaceChildren(...parts);
    labelLayer.replaceChildren(...labels);
    svg.setAttribute('aria-label', `Map of ${CIRCUIT_NAME}, ${(lap.lengthM / 1000).toFixed(2)} km, ${lap.corners.length} corners, coloured by what the power unit does: ${PHASE_ORDER.map((p) => PHASES[p].label.toLowerCase()).join(', ')}.`);
    placeCar();
  }

  function placeCar() {
    if (!lap || pts.length < 2 || lap.trace.length !== pts.length) return;
    const tr = lap.trace;
    const i = indexAtDistance(tr, sM);
    const j = (i + 1) % pts.length;
    const s1 = j === 0 ? lap.lengthM : tr[j].s;
    const k = s1 > tr[i].s ? Math.min(1, Math.max(0, (sM - tr[i].s) / (s1 - tr[i].s))) : 0;
    setCx(f(pts[i].x + (pts[j].x - pts[i].x) * k));
    setCy(f(pts[i].y + (pts[j].y - pts[i].y) * k));
  }

  // A click or tap anywhere on the map sends the car to the nearest point of the track.
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || !lap || pts.length < 2 || lap.trace.length !== pts.length) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * w;
    const py = ((e.clientY - rect.top) / rect.height) * ht;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = (pts[i].x - px) ** 2 + (pts[i].y - py) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    onScrub(lap.trace[best].t);
  };
  svg.addEventListener('pointerdown', onDown);

  const ro = new ResizeObserver(() => {
    const nw = Math.round(plot.clientWidth);
    const nh = Math.round(plot.clientHeight);
    if (!nw || !nh || (nw === w && nh === ht)) return;
    w = nw;
    ht = nh;
    setViewBox(`0 0 ${w} ${ht}`);
    drawStatic();
  });
  ro.observe(plot);

  return {
    el,
    render(v) {
      if (v.lap !== lap) {
        lap = v.lap;
        setLength(`${(v.lap.lengthM / 1000).toFixed(2)} km`);
        drawStatic();
      } else if (drawnFor !== lap) drawStatic();
      sM = v.sM;
      placeCar();
    },
    dispose() {
      ro.disconnect();
      svg.removeEventListener('pointerdown', onDown);
    },
  };
}
