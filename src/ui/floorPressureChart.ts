/**
 * Station 6, zone B — the pressure under the floor along the car's centreline, drawn by hand in SVG.
 *
 * x runs along the car the way air meets it: the front of the floor on the left, the diffuser exit
 * on the right. y is the pressure coefficient with suction drawn upward (−Cp up), so the filled
 * area is the floor's grip on the road: the bigger the area, the more downforce. Ticks mark the
 * diffuser inlet (throat) and exit; where the diffuser flow has separated the area is hatched.
 * The axes are fixed, so a change in shape is a change in the car. Text is drawn in real pixels
 * (redrawn on resize); each frame only the curve moves, and only when it changed.
 */
import type { Station6View } from './types';
import { attrSlot, h, s, textSlot } from './dom';
import { MINUS } from './format';
import { ticks } from './aeroMapMath';

export interface FloorPressureChart {
  el: HTMLElement;
  render(pressure: Station6View['pressure']): void;
  dispose(): void;
}

/** Suction scale: −Cp from just below zero to 3 (the deepest suction the map reaches is ≈ 2.6). */
const SUCTION_MAX = 3;
const SUCTION_MIN = -0.25;
let patternCount = 0;

const fmtCp = (cp: number) => (cp < -0.005 ? `${MINUS}${Math.abs(cp).toFixed(1)}` : Math.abs(cp).toFixed(1));

export function createFloorPressureChart(): FloorPressureChart {
  const patternId = `fp-hatch-${++patternCount}`;
  const grid = s('g', { class: 'fp-grid' });
  const area = s('path', { class: 'fp-area' });
  const line = s('path', { class: 'fp-line' });
  const sepRect = s('rect', { class: 'fp-sep', fill: `url(#${patternId})` });
  const sepEdge = s('line', { class: 'fp-sep-edge' });
  const sepLabel = s('text', { class: 'fp-sep-label', 'text-anchor': 'middle' }, ['separated']);
  const sep = s('g', { class: 'fp-sep-group', visibility: 'hidden' }, [sepRect, sepEdge, sepLabel]);
  const peakDot = s('circle', { class: 'fp-peak', r: 3 });
  const peakLabel = s('text', { class: 'fp-peak-label' });
  const svg = s('svg', { class: 'fp-svg', role: 'img', 'aria-label': 'Pressure under the floor' }, [
    s('defs', {}, [
      s('pattern', { id: patternId, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, [
        s('line', { class: 'fp-hatch', x1: 0, y1: 0, x2: 0, y2: 5 }),
      ]),
    ]),
    grid,
    sep,
    area,
    line,
    peakDot,
    peakLabel,
  ]);
  const plot = h('div', 'fp-plot', [svg]);
  const el = h('div', 'fp', [
    h('span', 'micro fp-title', [h('span', { text: 'Pressure under the floor' }), h('span', { class: 'fp-aside', text: 'suction ↑' })]),
    plot,
  ]);

  let w = 0;
  let ht = 0;
  const pad = { l: 26, r: 6, t: 8, b: 15 };
  let xFront = 1.25;
  let xExit = -2;
  /** Front of the floor at the left: x falls to the right. */
  const px = (x: number) => pad.l + ((xFront - x) / (xFront - xExit)) * (w - pad.l - pad.r);
  const py = (cp: number) => {
    const suction = Math.min(SUCTION_MAX, Math.max(SUCTION_MIN, -cp));
    return pad.t + ((SUCTION_MAX - suction) / (SUCTION_MAX - SUCTION_MIN)) * (ht - pad.t - pad.b);
  };
  const f = (n: number) => n.toFixed(1);
  const text = (content: string, attrs: Record<string, string | number>) => s('text', attrs, [content]);

  const setLine = attrSlot(line, 'd');
  const setArea = attrSlot(area, 'd');
  const setSepShown = attrSlot(sep, 'visibility');
  const setSepX = attrSlot(sepRect, 'x');
  const setSepW = attrSlot(sepRect, 'width');
  const setSepEdgeX1 = attrSlot(sepEdge, 'x1');
  const setSepEdgeX2 = attrSlot(sepEdge, 'x2');
  const setSepLabelX = attrSlot(sepLabel, 'x');
  const setPeakX = attrSlot(peakDot, 'cx');
  const setPeakY = attrSlot(peakDot, 'cy');
  const setPeakLabelX = attrSlot(peakLabel, 'x');
  const setPeakLabelY = attrSlot(peakLabel, 'y');
  const setPeakAnchor = attrSlot(peakLabel, 'text-anchor');
  const setPeakText = textSlot(peakLabel);
  const setAria = attrSlot(svg, 'aria-label');
  const setViewBox = attrSlot(svg, 'viewBox');

  let last: Station6View['pressure'] | null = null;
  /** Cheap fingerprint of the last drawn curve: redraw only when it moved. */
  let drawnKey = NaN;

  function drawStatic() {
    if (!w || !ht || !last) return;
    pad.l = w < 260 ? 22 : 26;
    const y0 = py(0);
    const xt = px(last.throatX);
    const xe = px(last.exitX);
    const parts: SVGElement[] = [
      // The diffuser on a faint ground of its own, so "where the floor rises" reads at a glance.
      s('rect', { class: 'fp-diffuser', x: f(xt), y: pad.t, width: f(xe - xt), height: f(ht - pad.t - pad.b) }),
    ];
    for (const v of ticks(1, SUCTION_MAX, 1)) {
      parts.push(s('line', { class: 'chart-grid', x1: pad.l, x2: f(w - pad.r), y1: f(py(-v)), y2: f(py(-v)) }));
      parts.push(text(`${MINUS}${v}`, { class: 'chart-tick', x: pad.l - 4, y: f(py(-v) + 3.5), 'text-anchor': 'end' }));
    }
    parts.push(text('0', { class: 'chart-tick', x: pad.l - 4, y: f(y0 + 3.5), 'text-anchor': 'end' }));
    parts.push(text('Cp', { class: 'chart-unit', x: pad.l - 4, y: f(pad.t + 2), 'text-anchor': 'end' }));
    const yb = ht - pad.b;
    for (const x of [xt, xe]) parts.push(s('line', { class: 'fp-tick', x1: f(x), x2: f(x), y1: f(y0), y2: f(yb + 3) }));
    parts.push(text('front', { class: 'chart-tick', x: pad.l, y: f(ht - 3), 'text-anchor': 'start' }));
    parts.push(text('throat', { class: 'chart-tick', x: f(xt), y: f(ht - 3), 'text-anchor': 'middle' }));
    parts.push(text('diffuser', { class: 'chart-tick fp-diffuser-label', x: f((xt + xe) / 2 + 9), y: f(pad.t + 9), 'text-anchor': 'middle' }));
    parts.push(text('exit', { class: 'chart-tick', x: f(xe), y: f(ht - 3), 'text-anchor': 'end' }));
    grid.replaceChildren(...parts, s('line', { class: 'chart-axis', x1: pad.l, x2: f(w - pad.r), y1: f(y0), y2: f(y0) }));
    sepRect.setAttribute('y', String(pad.t));
    sepRect.setAttribute('height', f(y0 - pad.t));
    sepEdge.setAttribute('y1', String(pad.t));
    sepEdge.setAttribute('y2', f(y0));
    sepLabel.setAttribute('y', f(y0 - 4));
    drawnKey = NaN;
    drawCurve();
  }

  function drawCurve() {
    const p = last;
    if (!p || !w || !ht) return;
    const n = p.x.length;
    let key = (p.separationX ?? 9) * 7.31;
    for (let i = 0; i < n; i += 7) key += p.cp[i] * (i + 1);
    if (key === drawnKey) return;
    drawnKey = key;

    const y0 = f(py(0));
    let d = '';
    let peak = 0;
    for (let i = 0; i < n; i++) {
      d += `${i ? 'L' : 'M'}${f(px(p.x[i]))} ${f(py(p.cp[i]))}`;
      if (p.cp[i] < p.cp[peak]) peak = i;
    }
    setLine(d);
    setArea(`${d}L${f(px(p.x[n - 1]))} ${y0}L${f(px(p.x[0]))} ${y0}Z`);

    const pkX = px(p.x[peak]);
    const pkY = py(p.cp[peak]);
    setPeakX(f(pkX));
    setPeakY(f(pkY));
    const right = pkX < w * 0.6;
    setPeakLabelX(f(pkX + (right ? 6 : -6)));
    setPeakLabelY(f(Math.max(pad.t + 8, pkY + 3)));
    setPeakAnchor(right ? 'start' : 'end');
    setPeakText(fmtCp(p.cp[peak]));

    if (p.separationX !== null) {
      const xs = px(p.separationX);
      const xe = px(p.exitX);
      setSepShown('visible');
      setSepX(f(xs));
      setSepW(f(Math.max(0, xe - xs)));
      setSepEdgeX1(f(xs));
      setSepEdgeX2(f(xs));
      setSepLabelX(f((xs + xe) / 2));
    } else {
      setSepShown('hidden');
    }
    const sepCm = p.separationX !== null ? Math.round((p.separationX - p.exitX) * 100) : 0;
    setAria(
      `Pressure under the floor, front to diffuser exit: strongest suction Cp ${fmtCp(p.cp[peak])}` +
        (Math.abs(p.x[peak] - p.throatX) < 0.15 ? ' at the diffuser inlet' : '') +
        (sepCm > 0 ? `; the diffuser flow has separated over its last ${sepCm} cm.` : '; the diffuser flow is attached.'),
    );
  }

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
    render(p) {
      const geometry = !last || last.throatX !== p.throatX || last.exitX !== p.exitX || last.x[0] !== p.x[0];
      last = p;
      if (geometry) {
        xFront = p.x[0];
        xExit = p.x[p.x.length - 1];
        drawStatic();
      } else drawCurve();
    },
    dispose() {
      ro.disconnect();
    },
  };
}
