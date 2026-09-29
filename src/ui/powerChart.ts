/**
 * Station 2, zone C — power against speed, drawn by hand in SVG.
 *
 * Top speed is where the power reaching the tyres meets the power the air and the road take.
 * Available power is flat until the rules start fading the electric motor at 290 km/h; the power
 * needed grows with speed³, less steeply with the flaps open. Curves depend only on the model,
 * so they are drawn once (and on resize, in real pixels); each frame only the cursor moves.
 */
import { REGS } from '../physics/constants';
import { availablePowerW, mguKLimitKw, requiredPowerW, topSpeedKmh } from '../physics/powertrain';
import type { AeroMode } from './types';
import { attrSlot, h, s } from './dom';
import { fmtKmh } from './format';
import { POWER_SCALE_KW } from './aeroReadouts';

export interface PowerChart {
  el: HTMLElement;
  render(speedKmh: number, mode: AeroMode, availableW: number, requiredW: number): void;
  dispose(): void;
}

const X_MIN = 100;
const X_MAX = 350;
const X_STEP = 50;
const Y_STEP_KW = 200;
const SAMPLE_KMH = 1;
const PAD = { l: 30, r: 10, t: 8, b: 20 };

/** Where the regulated motor limit starts to fall and where it reaches zero, km/h. */
function taperRange(): [number, number] {
  let start = X_MIN;
  while (start < X_MAX && mguKLimitKw(start + 1) >= REGS.mguKMaxKw.value) start++;
  let end = start;
  while (end < 400 && mguKLimitKw(end) > 0) end++;
  return [start, end];
}

export function createPowerChart(): PowerChart {
  const tops = { corner: topSpeedKmh(0), straight: topSpeedKmh(1) };
  const [taperFrom, taperTo] = taperRange();
  const samples: { v: number; has: number; corner: number; straight: number }[] = [];
  for (let v = X_MIN; v <= X_MAX + 1e-6; v += SAMPLE_KMH) {
    samples.push({ v, has: availablePowerW(v) / 1000, corner: requiredPowerW(v, 0).totalW / 1000, straight: requiredPowerW(v, 1).totalW / 1000 });
  }

  const staticLayer = s('g', { class: 'chart-static' });
  const labelLayer = s('g', { class: 'chart-labels' });
  const cursorLine = s('line', { class: 'chart-cursor' });
  const dotHas = s('circle', { class: 'chart-dot chart-dot--weight', r: 4 });
  const dotNeed = s('circle', { class: 'chart-dot chart-dot--drag', r: 4 });
  const live = s('g', { class: 'chart-live', 'aria-hidden': 'true' }, [cursorLine, dotNeed, dotHas]);
  const svg = s(
    'svg',
    {
      class: 'chart-svg chart-svg--power',
      role: 'img',
      'aria-label':
        `Chart of power against speed. Power available is flat until ${fmtKmh(taperFrom)} km/h, then falls as the rules fade the electric motor out by ${fmtKmh(taperTo)} km/h. ` +
        `Power needed grows with the cube of speed. The lines cross at about ${fmtKmh(tops.corner)} km/h in Corner Mode and ${fmtKmh(tops.straight)} km/h in Straight Mode.`,
    },
    [staticLayer, live, labelLayer],
  );
  const plot = h('div', 'chart-plot', [svg]);

  const legendItem = (tone: string, text: string) =>
    h('span', `legend-item legend-item--${tone}`, [h('i', { class: 'legend-key', attrs: { 'aria-hidden': 'true' } }), text]);

  const el = h('section', { class: 'zone zone-chart', attrs: { 'aria-label': 'Power against speed' } }, [
    h('h2', 'micro zone-title', [h('span', { class: 'idx', text: 'C' }), 'Power vs speed']),
    h('div', 'chart-head', [
      h('p', { class: 'chart-title', text: 'Top speed is where the lines cross' }),
      h('div', 'chart-legend', [
        legendItem('has', 'Available'),
        legendItem('need-corner', 'Needed · Corner'),
        legendItem('need-straight', 'Needed · Straight'),
      ]),
    ]),
    plot,
  ]);

  let w = 0;
  let ht = 0;
  const x = (kmh: number) => PAD.l + ((kmh - X_MIN) / (X_MAX - X_MIN)) * (w - PAD.l - PAD.r);
  const y = (kw: number) => ht - PAD.b - (Math.min(kw, POWER_SCALE_KW) / POWER_SCALE_KW) * (ht - PAD.b - PAD.t);
  const f = (n: number) => n.toFixed(1);
  const text = (content: string, attrs: Record<string, string | number>) => s('text', attrs, [content]);
  const curve = (key: 'has' | 'corner' | 'straight') =>
    samples
      .filter((p) => p[key] <= POWER_SCALE_KW)
      .map((p, i) => `${i ? 'L' : 'M'}${f(x(p.v))} ${f(y(p[key]))}`)
      .join('');

  const needPaths = { corner: s('path', {}), straight: s('path', {}) };
  const hasPath = s('path', { class: 'chart-curve chart-curve--has' });
  const crossDots = { corner: s('circle', { r: 4 }), straight: s('circle', { r: 4 }) };

  function drawStatic() {
    const x0 = x(X_MIN);
    const x1 = x(X_MAX);
    const yBase = y(0);
    const parts: SVGElement[] = [];

    // The regulated taper: shaded lightly, named along its foot where the plot is empty.
    const xt0 = x(taperFrom);
    const xt1 = x(Math.min(taperTo, X_MAX));
    parts.push(s('rect', { class: 'chart-taper', x: f(xt0), y: PAD.t, width: f(xt1 - xt0), height: f(yBase - PAD.t) }));

    for (let kw = 0; kw <= POWER_SCALE_KW; kw += Y_STEP_KW) {
      parts.push(s('line', { class: kw ? 'chart-grid' : 'chart-axis', x1: x0, x2: x1, y1: f(y(kw)), y2: f(y(kw)) }));
      parts.push(text(String(kw), { class: 'chart-tick', x: x0 - 6, y: f(y(kw) + 3.5), 'text-anchor': 'end' }));
    }
    for (let v = X_MIN; v <= X_MAX; v += X_STEP) {
      if (v > X_MIN) parts.push(s('line', { class: 'chart-grid chart-grid--v', x1: f(x(v)), x2: f(x(v)), y1: PAD.t, y2: yBase }));
      const anchor = v === X_MIN ? 'start' : v + X_STEP > X_MAX ? 'end' : 'middle';
      parts.push(text(String(v), { class: 'chart-tick', x: f(x(v)), y: ht - 6, 'text-anchor': anchor }));
    }
    parts.push(text('kW', { class: 'chart-unit', x: x0 + 6, y: PAD.t + 10 }));

    const inactive = mode === 'corner' ? 'straight' : 'corner';
    needPaths.corner.setAttribute('d', curve('corner'));
    needPaths.straight.setAttribute('d', curve('straight'));
    // The commanded mode's curve is drawn last so it sits on top where the two touch.
    hasPath.setAttribute('d', curve('has'));
    parts.push(needPaths[inactive], needPaths[mode], hasPath);

    const labels: SVGElement[] = [
      text(`Motor limit fades · ${REGS.mguKTaper.ref}`, { class: 'chart-taper-label', x: f(xt1 - 4), y: f(yBase - 6), 'text-anchor': 'end' }),
    ];
    // Crossing labels stack above the plot's empty top-right: Straight on the top row, Corner
    // under it, each hanging left of its drop line so neither line strikes through a label.
    const rows = { straight: PAD.t + 9, corner: PAD.t + 21 };
    for (const m of ['corner', 'straight'] as const) {
      const xc = x(tops[m]);
      const yc = y(availablePowerW(tops[m]) / 1000);
      parts.push(s('line', { class: `chart-top-drop chart-top-drop--${m}`, x1: f(xc), x2: f(xc), y1: f(rows[m] - 8), y2: f(yc) }));
      crossDots[m].setAttribute('cx', f(xc));
      crossDots[m].setAttribute('cy', f(yc));
      labels.push(crossDots[m], text(fmtKmh(tops[m]), { class: `chart-top-label chart-top-label--${m}`, x: f(xc - 4), y: f(rows[m]), 'text-anchor': 'end' }));
    }
    for (const m of ['corner', 'straight'] as const) setEmphasis(m, m === mode);

    staticLayer.replaceChildren(...parts);
    labelLayer.replaceChildren(...labels);
    cursorLine.setAttribute('y1', String(PAD.t));
    cursorLine.setAttribute('y2', f(yBase));
  }

  function setEmphasis(m: AeroMode, on: boolean) {
    const state = on ? 'is-active' : 'is-dim';
    needPaths[m].setAttribute('class', `chart-curve chart-curve--need-${m} ${state}`);
    crossDots[m].setAttribute('class', `chart-cross chart-cross--${m} ${state}`);
  }

  const setCx = attrSlot(cursorLine, 'x1');
  const setCx2 = attrSlot(cursorLine, 'x2');
  const setHasX = attrSlot(dotHas, 'cx');
  const setHasY = attrSlot(dotHas, 'cy');
  const setNeedX = attrSlot(dotNeed, 'cx');
  const setNeedY = attrSlot(dotNeed, 'cy');
  const setSize = attrSlot(svg, 'viewBox');
  const setLiveVisible = attrSlot(live, 'visibility');

  let mode: AeroMode = 'corner';
  const last = { speed: 0, has: 0, need: 0 };
  function placeCursor() {
    if (!w) return;
    // Below the chart's range there is nothing to point at; hide rather than pin to the edge.
    setLiveVisible(last.speed < X_MIN ? 'hidden' : 'visible');
    const cx = f(x(Math.min(X_MAX, last.speed)));
    setCx(cx);
    setCx2(cx);
    setHasX(cx);
    setNeedX(cx);
    setHasY(f(y(last.has / 1000)));
    setNeedY(f(y(last.need / 1000)));
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
    render(speedKmh, nextMode, availableW, requiredW) {
      if (nextMode !== mode) {
        mode = nextMode;
        setEmphasis('corner', mode === 'corner');
        setEmphasis('straight', mode === 'straight');
        // Keep the commanded curve above the other one (available power stays on top).
        if (w) staticLayer.append(needPaths[mode], hasPath);
      }
      last.speed = speedKmh;
      last.has = availableW;
      last.need = requiredW;
      placeCursor();
    },
    dispose() {
      ro.disconnect();
    },
  };
}
