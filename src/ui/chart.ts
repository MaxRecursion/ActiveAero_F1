/**
 * Zone C — force against speed, drawn by hand in SVG.
 *
 * The curves, grid and weight line depend only on the model, so they are drawn once (and again
 * when the plot is resized, in real pixels so text never scales). Each frame only the speed
 * cursor and its two dots move.
 */
import { aeroState, ceilingSpeedKmh } from '../physics/aero';
import { attrSlot, h, s } from './dom';
import { fmtKmh, fmtKN } from './format';

export interface ForceChart {
  el: HTMLElement;
  render(speedKmh: number, downforceN: number, dragN: number): void;
  dispose(): void;
}

const Y_MAX_N = 20_000;
const Y_STEP_N = 5_000;
const X_STEP_KMH = 50;
const SAMPLE_KMH = 2.5;
const PAD = { l: 26, r: 10, t: 8, b: 20 };

export function createForceChart(opts: { minKmh: number; maxKmh: number }): ForceChart {
  const { minKmh, maxKmh } = opts;
  const weightN = aeroState(0).weightN;
  const crossKmh = ceilingSpeedKmh();
  const samples: { v: number; down: number; drag: number }[] = [];
  for (let v = minKmh; v <= maxKmh + 1e-6; v += SAMPLE_KMH) {
    const a = aeroState(v);
    samples.push({ v, down: a.downforceN, drag: a.dragN });
  }

  const staticLayer = s('g', { class: 'chart-static' });
  // Annotations sit above the moving cursor so it never strikes through their text.
  const labelLayer = s('g', { class: 'chart-labels' });
  const cursorLine = s('line', { class: 'chart-cursor' });
  const dotDown = s('circle', { class: 'chart-dot chart-dot--down', r: 4 });
  const dotDrag = s('circle', { class: 'chart-dot chart-dot--drag', r: 4 });
  const svg = s(
    'svg',
    {
      class: 'chart-svg',
      role: 'img',
      'aria-label': `Chart of force against speed. Downforce and drag both grow with the square of speed. Downforce passes the car's weight of ${fmtKN(weightN)} kilonewtons at about ${fmtKmh(crossKmh)} km/h.`,
    },
    [staticLayer, s('g', { class: 'chart-live', 'aria-hidden': 'true' }, [cursorLine, dotDown, dotDrag]), labelLayer],
  );
  const plot = h('div', 'chart-plot', [svg]);

  const legendItem = (tone: string, label: string) =>
    h('span', `legend-item legend-item--${tone}`, [h('i', { class: 'legend-key', attrs: { 'aria-hidden': 'true' } }), label]);

  const el = h('section', { class: 'zone zone-chart', attrs: { 'aria-label': 'Force against speed' } }, [
    h('h2', 'micro zone-title', [h('span', { class: 'idx', text: 'C' }), 'Force vs speed']),
    h('div', 'chart-head', [
      h('p', { class: 'chart-title', text: 'Force grows with speed²' }),
      h('div', 'chart-legend', [legendItem('down', 'Downforce'), legendItem('drag', 'Drag'), legendItem('weight', 'Weight')]),
    ]),
    plot,
  ]);

  let w = 0;
  let ht = 0;
  const x = (kmh: number) => PAD.l + ((kmh - minKmh) / (maxKmh - minKmh)) * (w - PAD.l - PAD.r);
  const y = (n: number) => ht - PAD.b - (Math.min(n, Y_MAX_N) / Y_MAX_N) * (ht - PAD.b - PAD.t);
  const f = (n: number) => n.toFixed(1);

  function text(content: string, attrs: Record<string, string | number>) {
    const t = s('text', attrs);
    t.textContent = content;
    return t;
  }

  function curve(key: 'down' | 'drag') {
    return samples.map((p, i) => `${i ? 'L' : 'M'}${f(x(p.v))} ${f(y(p[key]))}`).join('');
  }

  function drawStatic() {
    const x0 = x(minKmh);
    const x1 = x(maxKmh);
    const yBase = y(0);
    const parts: SVGElement[] = [];
    for (let n = 0; n <= Y_MAX_N; n += Y_STEP_N) {
      parts.push(s('line', { class: n ? 'chart-grid' : 'chart-axis', x1: x0, x2: x1, y1: f(y(n)), y2: f(y(n)) }));
      parts.push(text(String(n / 1000), { class: 'chart-tick', x: x0 - 6, y: f(y(n) + 3.5), 'text-anchor': 'end' }));
    }
    for (let v = minKmh; v <= maxKmh; v += X_STEP_KMH) {
      if (v > minKmh) parts.push(s('line', { class: 'chart-grid chart-grid--v', x1: f(x(v)), x2: f(x(v)), y1: PAD.t, y2: yBase }));
      const anchor = v === minKmh ? 'start' : v + X_STEP_KMH > maxKmh ? 'end' : 'middle';
      parts.push(text(String(v), { class: 'chart-tick', x: f(x(v)), y: ht - 6, 'text-anchor': anchor }));
    }
    parts.push(text('kN', { class: 'chart-unit', x: x0 + 6, y: PAD.t + 10 }));
    parts.push(text('km/h', { class: 'chart-unit', x: x1 - 4, y: yBase - 6, 'text-anchor': 'end' }));

    const downPath = curve('down');
    parts.push(s('path', { class: 'chart-area', d: `${downPath}L${f(x1)} ${f(yBase)}L${f(x0)} ${f(yBase)}Z` }));
    parts.push(s('path', { class: 'chart-curve chart-curve--drag', d: curve('drag') }));
    parts.push(s('path', { class: 'chart-curve chart-curve--down', d: downPath }));

    const yW = y(weightN);
    parts.push(s('line', { class: 'chart-weight', x1: x0, x2: x1, y1: f(yW), y2: f(yW) }));
    const weightLabel = s('text', { class: 'chart-weight-label', x: x0 + 6, y: f(yW - 5) }, [
      s('tspan', { class: 'chart-caps' }, ['WEIGHT']),
      s('tspan', { dx: 6 }, [`${fmtKN(weightN)} kN`]),
    ]);
    const labels: SVGElement[] = [weightLabel];

    const xc = x(crossKmh);
    parts.push(s('line', { class: 'chart-cross-drop', x1: f(xc), x2: f(xc), y1: f(yW), y2: yBase }));
    labels.push(s('circle', { class: 'chart-cross', cx: f(xc), cy: f(yW), r: 4 }));
    labels.push(text(`${fmtKmh(crossKmh)} km/h`, { class: 'chart-cross-label', x: f(xc + 7), y: f(yW + 14) }));

    staticLayer.replaceChildren(...parts);
    labelLayer.replaceChildren(...labels);
    cursorLine.setAttribute('y1', String(PAD.t));
    cursorLine.setAttribute('y2', f(yBase));
  }

  const setCx = attrSlot(cursorLine, 'x1');
  const setCx2 = attrSlot(cursorLine, 'x2');
  const setDownX = attrSlot(dotDown, 'cx');
  const setDownY = attrSlot(dotDown, 'cy');
  const setDragX = attrSlot(dotDrag, 'cx');
  const setDragY = attrSlot(dotDrag, 'cy');
  const setSize = attrSlot(svg, 'viewBox');

  const last = { speed: 0, down: 0, drag: 0 };
  function placeCursor() {
    if (!w) return;
    const cx = f(x(Math.min(maxKmh, Math.max(minKmh, last.speed))));
    setCx(cx);
    setCx2(cx);
    setDownX(cx);
    setDragX(cx);
    setDownY(f(y(last.down)));
    setDragY(f(y(last.drag)));
  }

  const ro = new ResizeObserver(() => {
    const nw = Math.round(plot.clientWidth);
    const nh = Math.round(plot.clientHeight);
    if (!nw || !nh || (nw === w && nh === ht)) return;
    w = nw;
    ht = nh;
    setSize(`0 0 ${w} ${ht}`);
    drawStatic();
    placeCursor();
  });
  ro.observe(plot);

  return {
    el,
    render(speedKmh, downforceN, dragN) {
      last.speed = speedKmh;
      last.down = downforceN;
      last.drag = dragN;
      placeCursor();
    },
    dispose() {
      ro.disconnect();
    },
  };
}
