/**
 * Station 4, zone C — the brake zone, drawn by hand in SVG and scrubbable.
 *
 * x is time since the pedal went down; speed is the dark line on the left axis, braking in g the
 * light area on the right axis. The part of the stop already driven is drawn at full strength and
 * the rest faded, so the playhead reads as progress. The whole plot is a focusable slider: drag or
 * click to park the car anywhere in the stop, ←/→ step 0.1 s (Shift 0.5 s), Home/End jump to the
 * pedal-down and stopped moments. The static drawing depends only on the zone and the plot size;
 * each frame only the playhead and the clip move.
 */
import type { BrakeTrace, Station4View } from './types';
import { attrSlot, h, s } from './dom';
import { spokenZonePosition } from './format';
import { gAxis, speedAxis, timeTicks } from './brakeMath';

export interface BrakeChart {
  el: HTMLElement;
  render(view: Station4View): void;
  dispose(): void;
}

const KEY_STEP_S = 0.1;
const KEY_BIG_STEP_S = 0.5;
let clipCount = 0;

export function createBrakeChart(onScrub: (tS: number) => void): BrakeChart {
  const clipId = `brake-clip-${++clipCount}`;
  const clipRect = s('rect', { x: 0, y: -10, height: 0, width: 0 });
  const staticLayer = s('g', { class: 'brake-static' });
  const past = s('g', { class: 'brake-past', 'clip-path': `url(#${clipId})` });
  const hint = s('text', { class: 'brake-hint', 'text-anchor': 'middle' }, ['Press Brake, or drag along here']);
  const headLine = s('line', { class: 'brake-head-line' });
  const handle = s('g', { class: 'brake-handle' }, [
    s('rect', { class: 'brake-handle-body', x: -5, y: 0.5, width: 10, height: 13, rx: 2 }),
    s('line', { class: 'brake-handle-grip', x1: 0, x2: 0, y1: 4, y2: 10 }),
  ]);
  const dotSpeed = s('circle', { class: 'brake-dot brake-dot--speed', r: 3.5 });
  const dotG = s('circle', { class: 'brake-dot brake-dot--g', r: 3.5 });
  const live = s('g', { class: 'brake-live', 'aria-hidden': 'true' }, [headLine, dotSpeed, dotG, handle]);
  const svg = s('svg', { class: 'brake-svg', 'aria-hidden': 'true', focusable: 'false' }, [
    s('defs', {}, [s('clipPath', { id: clipId }, [clipRect])]),
    staticLayer,
    past,
    hint,
    live,
  ]);

  const plot = h(
    'div',
    {
      class: 'brake-plot',
      attrs: {
        role: 'slider',
        tabindex: '0',
        'aria-label': 'Position in the brake zone',
        'aria-valuemin': '0',
        'aria-valuemax': '0',
        'aria-valuenow': '0',
        'aria-orientation': 'horizontal',
      },
    },
    [svg],
  );

  const legendCorner = h('span', 'legend-text');
  const el = h('section', { class: 'zone zone-chart zone-brake-chart', attrs: { 'aria-label': 'The stop, second by second' } }, [
    h('h2', 'micro zone-title', [h('span', { class: 'idx', text: 'C' }), 'Brake zone']),
    h('div', 'chart-head', [
      h('p', { class: 'chart-title', text: 'Speed and braking, second by second' }),
      h('div', { class: 'chart-legend', attrs: { 'aria-hidden': 'true' } }, [
        h('span', 'legend-item', [h('i', 'legend-key legend-key--speed'), 'Speed']),
        h('span', 'legend-item', [h('i', 'legend-key legend-key--g'), 'Braking (g)']),
        h('span', 'legend-item', [h('i', 'legend-key legend-key--corner'), legendCorner]),
      ]),
    ]),
    plot,
  ]);

  let w = 0;
  let ht = 0;
  let zone: BrakeTrace | null = null;
  let drawnFor: BrakeTrace | null = null;
  const last = { tS: 0, sM: 0, kmh: 0, g: 0 };
  const pad = { l: 30, r: 24, t: 15, b: 17 };
  let yMax = 350;
  let gMax = 5;
  const f = (n: number) => n.toFixed(1);
  const dur = () => zone?.timeS || 1;
  const x = (t: number) => pad.l + (Math.min(Math.max(t, 0), dur()) / dur()) * (w - pad.l - pad.r);
  const yS = (kmh: number) => ht - pad.b - (Math.min(Math.max(kmh, 0), yMax) / yMax) * (ht - pad.b - pad.t);
  const yG = (g: number) => ht - pad.b - (Math.min(Math.max(g, 0), gMax) / gMax) * (ht - pad.b - pad.t);
  const text = (content: string, attrs: Record<string, string | number>) => s('text', attrs, [content]);

  const setViewBox = attrSlot(svg, 'viewBox');
  const setClipW = attrSlot(clipRect, 'width');
  const setClipH = attrSlot(clipRect, 'height');
  const setHeadX1 = attrSlot(headLine, 'x1');
  const setHeadX2 = attrSlot(headLine, 'x2');
  const setHandle = attrSlot(handle, 'transform');
  const setSpeedX = attrSlot(dotSpeed, 'cx');
  const setSpeedY = attrSlot(dotSpeed, 'cy');
  const setGX = attrSlot(dotG, 'cx');
  const setGY = attrSlot(dotG, 'cy');
  const setHintShown = attrSlot(hint, 'visibility');
  const setMax = attrSlot(plot, 'aria-valuemax');
  const setNow = attrSlot(plot, 'aria-valuenow');
  const setText = attrSlot(plot, 'aria-valuetext');
  const setCorner = (() => {
    let prev = '';
    return (v: string) => {
      if (v === prev) return;
      prev = v;
      legendCorner.textContent = v;
    };
  })();

  function drawStatic() {
    if (!zone || !w || !ht) return;
    drawnFor = zone;
    pad.l = w < 420 ? 26 : 30;
    pad.r = w < 420 ? 20 : 24;
    const sAx = speedAxis(zone.fromKmh);
    const gAx = gAxis(zone.peakDecelG);
    yMax = sAx.max;
    gMax = gAx.max;
    const x0 = x(0);
    const x1 = x(zone.timeS);
    const y0 = yS(0);
    const plotH = y0 - pad.t;
    const grid: SVGElement[] = [];

    for (let v = 0; v <= yMax; v += sAx.step) {
      const yy = yS(v);
      grid.push(s('line', { class: v ? 'chart-grid' : 'chart-axis', x1: x0, x2: x1, y1: f(yy), y2: f(yy) }));
      if (v && (plotH >= 70 || v === yMax)) grid.push(text(String(v), { class: 'chart-tick', x: x0 - 5, y: f(yy + 3.5), 'text-anchor': 'end' }));
    }
    for (let g = gAx.step; g <= gMax; g += gAx.step) {
      if (plotH >= 70 || g === gMax) grid.push(text(String(g), { class: 'chart-tick brake-g-tick', x: x1 + 5, y: f(yG(g) + 3.5) }));
    }
    for (const t of timeTicks(zone.timeS, w - pad.l - pad.r)) {
      grid.push(s('line', { class: 'chart-grid chart-grid--v', x1: f(x(t)), x2: f(x(t)), y1: pad.t, y2: f(y0) }));
      grid.push(text(String(t), { class: 'chart-tick', x: f(x(t)), y: f(y0 + 12.5), 'text-anchor': t === 0 ? 'start' : 'middle' }));
    }
    grid.push(text('km/h', { class: 'chart-unit', x: x0 - 5, y: f(pad.t - 10), 'text-anchor': 'end' }));
    grid.push(text('g', { class: 'chart-unit brake-g-tick', x: x1 + 5, y: f(pad.t - 10) }));
    grid.push(text('s', { class: 'chart-unit', x: x1 + 5, y: f(y0 + 12.5) }));
    const cornerY = f(yS(zone.toKmh));
    grid.push(s('line', { class: 'brake-corner', x1: x0, x2: x1, y1: cornerY, y2: cornerY }));

    const pts = zone.points;
    const speedD = pts.map((p, i) => `${i ? 'L' : 'M'}${f(x(p.t))} ${f(yS(p.kmh))}`).join('');
    const gTop = pts.map((p, i) => `${i ? 'L' : 'M'}${f(x(p.t))} ${f(yG(p.decelG))}`).join('');
    const areaD = `${gTop}L${f(x(pts[pts.length - 1].t))} ${f(y0)}L${f(x(pts[0].t))} ${f(y0)}Z`;
    const curves = () => [
      s('path', { class: 'brake-g-area', d: areaD }),
      s('path', { class: 'brake-g-line', d: gTop }),
      s('path', { class: 'brake-speed', d: speedD }),
    ];
    const future = s('g', { class: 'brake-future' }, curves());
    staticLayer.replaceChildren(...grid, future);
    past.replaceChildren(...curves());

    setClipH(f(ht + 20));
    hint.setAttribute('x', f((x0 + x1) / 2));
    hint.setAttribute('y', f(pad.t + plotH * 0.5));
    headLine.setAttribute('y1', f(pad.t - 1));
    headLine.setAttribute('y2', f(y0));
    placeHead();
  }

  function placeHead() {
    if (!zone || !w) return;
    const px = f(x(last.tS));
    setClipW(String(Math.max(0, Number(px))));
    setHeadX1(px);
    setHeadX2(px);
    setHandle(`translate(${px} ${f(pad.t - 14)})`);
    setSpeedX(px);
    setGX(px);
    setSpeedY(f(yS(last.kmh)));
    setGY(f(yG(last.g)));
  }

  // ── scrubbing ────────────────────────────────────────────────────────────────
  let dragId: number | null = null;
  function scrubAt(clientX: number) {
    if (!zone || !w) return;
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * w;
    onScrub(Math.min(zone.timeS, Math.max(0, ((px - pad.l) / (w - pad.l - pad.r)) * zone.timeS)));
  }
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || !zone) return;
    dragId = e.pointerId;
    plot.setPointerCapture(e.pointerId);
    plot.classList.add('is-dragging');
    scrubAt(e.clientX);
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerId === dragId) scrubAt(e.clientX);
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== dragId) return;
    dragId = null;
    plot.classList.remove('is-dragging');
    if (plot.hasPointerCapture(e.pointerId)) plot.releasePointerCapture(e.pointerId);
  };
  const onKey = (e: KeyboardEvent) => {
    if (!zone || e.altKey || e.ctrlKey || e.metaKey) return;
    const step = e.shiftKey ? KEY_BIG_STEP_S : KEY_STEP_S;
    const next: number | undefined = {
      ArrowRight: last.tS + step,
      ArrowUp: last.tS + step,
      ArrowLeft: last.tS - step,
      ArrowDown: last.tS - step,
      PageUp: last.tS + KEY_BIG_STEP_S,
      PageDown: last.tS - KEY_BIG_STEP_S,
      Home: 0,
      End: zone.timeS,
    }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    last.tS = Math.min(zone.timeS, Math.max(0, next));
    onScrub(last.tS);
  };
  plot.addEventListener('pointerdown', onDown);
  plot.addEventListener('pointermove', onMove);
  plot.addEventListener('pointerup', onUp);
  plot.addEventListener('pointercancel', onUp);
  plot.addEventListener('keydown', onKey);

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
      if (v.zone !== zone) {
        zone = v.zone;
        setMax(zone.timeS.toFixed(2));
        setCorner(`${Math.round(zone.toKmh)} km/h corner`);
        drawStatic();
      } else if (drawnFor !== zone) drawStatic();
      last.tS = v.tS;
      last.sM = v.sM;
      last.kmh = v.kmh;
      last.g = v.decelG;
      setNow(v.tS.toFixed(2));
      setText(spokenZonePosition(v.tS, v.sM, v.kmh));
      setHintShown(v.state === 'ready' ? 'visible' : 'hidden');
      placeHead();
    },
    dispose() {
      ro.disconnect();
      plot.removeEventListener('pointerdown', onDown);
      plot.removeEventListener('pointermove', onMove);
      plot.removeEventListener('pointerup', onUp);
      plot.removeEventListener('pointercancel', onUp);
      plot.removeEventListener('keydown', onKey);
    },
  };
}
