/**
 * Station 3's primary control — the lap timeline, drawn by hand in SVG.
 *
 * x is distance round the lap. The speed trace is drawn over its own area, banded by what the
 * power unit is doing there (deploy, super clipping, braking, engine only, mid-corner); the
 * battery's charge runs over it as a green line on a 0–4 MJ axis at the right. Corners are ticks
 * on the axis. A playhead with a handle marks the car.
 *
 * It is the scrubber too: a focusable role=slider. Drag or click anywhere to move the car
 * (pointer capture keeps a drag alive outside the plot); ←/→ step a second, Shift five,
 * Home/End jump to the line. The static drawing depends only on the lap and the plot size, so it
 * is redrawn when the lap object changes or the plot resizes; each frame only the playhead moves.
 */
import type { LapTrace, Station3View } from './types';
import { attrSlot, h, s } from './dom';
import { spokenLapPosition } from './format';
import { phaseRuns, timeAtDistance, whereOnLap } from './lapMath';

export interface LapTimeline {
  el: HTMLElement;
  render(view: Station3View): void;
  dispose(): void;
}

/** Speed axis full scale, km/h (the Station 1 slider's range). */
const Y_MAX_KMH = 350;
const Y_STEP_KMH = 100;
/** Corner ticks closer than this (px) share one label, e.g. a chicane: "T7/8". */
const CHICANE_PX = 12;
/** Approximate advance of one label character (9.5 px condensed caps), and the gap kept between labels. */
const LABEL_CHAR_PX = 5.6;
const LABEL_GAP = 5;
const KEY_STEP_S = 1;
const KEY_BIG_STEP_S = 5;

let hatchCount = 0;

/** The latest time the playhead can show: just before the line, which is 0 s of the next lap. */
const lastMoment = (lap: LapTrace) => Math.max(0, lap.lapTimeS - 0.05);

export function createLapTimeline(onScrub: (tS: number) => void): LapTimeline {
  const hatchId = `lap-hatch-${++hatchCount}`;
  const hatch = s('pattern', { id: hatchId, patternUnits: 'userSpaceOnUse', width: 5, height: 5, patternTransform: 'rotate(45)' }, [
    s('rect', { class: 'hatch-bg', width: 5, height: 5 }),
    s('line', { class: 'hatch-line', x1: 1, y1: 0, x2: 1, y2: 5 }),
  ]);
  const staticLayer = s('g', { class: 'lap-static' });
  const labelLayer = s('g', { class: 'lap-labels' });
  const headLine = s('line', { class: 'lap-head-line' });
  const handle = s('g', { class: 'lap-handle' }, [
    s('rect', { class: 'lap-handle-body', x: -5, y: 0.5, width: 10, height: 13, rx: 2 }),
    s('line', { class: 'lap-handle-grip', x1: 0, x2: 0, y1: 4, y2: 10 }),
  ]);
  const dotSpeed = s('circle', { class: 'lap-dot lap-dot--speed', r: 3.5 });
  const dotSoc = s('circle', { class: 'lap-dot lap-dot--soc', r: 3.5 });
  const live = s('g', { class: 'lap-live', 'aria-hidden': 'true' }, [headLine, dotSpeed, dotSoc, handle]);
  const svg = s('svg', { class: 'lap-svg', 'aria-hidden': 'true', focusable: 'false' }, [s('defs', {}, [hatch]), staticLayer, labelLayer, live]);

  const el = h(
    'div',
    {
      class: 'lap-plot',
      attrs: {
        role: 'slider',
        tabindex: '0',
        'aria-label': 'Position on the lap',
        'aria-valuemin': '0',
        'aria-valuemax': '0',
        'aria-valuenow': '0',
        'aria-orientation': 'horizontal',
      },
    },
    [svg],
  );

  let w = 0;
  let ht = 0;
  let lap: LapTrace | null = null;
  let drawnFor: LapTrace | null = null;
  const last = { tS: 0, sM: 0, kmh: 0, soc: 0 };
  const pad = { l: 28, r: 26, t: 15, b: 17 };
  const f = (n: number) => n.toFixed(1);
  const x = (m: number) => pad.l + (Math.min(Math.max(m, 0), lap?.lengthM ?? 1) / (lap?.lengthM ?? 1)) * (w - pad.l - pad.r);
  const yK = (kmh: number) => ht - pad.b - (Math.min(Math.max(kmh, 0), Y_MAX_KMH) / Y_MAX_KMH) * (ht - pad.b - pad.t);
  const yE = (mj: number) => ht - pad.b - (Math.min(Math.max(mj, 0), lap?.windowMJ ?? 4) / (lap?.windowMJ ?? 4)) * (ht - pad.b - pad.t);
  const text = (content: string, attrs: Record<string, string | number>) => s('text', attrs, [content]);

  function drawStatic() {
    if (!lap || !w || !ht) return;
    drawnFor = lap;
    // Narrow plots keep their axes but drop the in-between figures.
    pad.l = w < 420 ? 22 : 28;
    pad.r = w < 420 ? 20 : 26;
    const tr = lap.trace;
    const x0 = x(0);
    const x1 = x(lap.lengthM);
    const y0 = yK(0);
    const plotH = y0 - pad.t;
    const parts: SVGElement[] = [];
    const labels: SVGElement[] = [];

    // Phase bands under the speed trace, each run closed down to the axis.
    for (const run of phaseRuns(tr)) {
      const end = run.to + 1 < tr.length ? tr[run.to + 1] : { s: lap.lengthM, kmh: tr[0].kmh };
      let d = `M${f(x(tr[run.from].s))} ${f(y0)}`;
      for (let i = run.from; i <= run.to; i++) d += `L${f(x(tr[i].s))} ${f(yK(tr[i].kmh))}`;
      d += `L${f(x(end.s))} ${f(yK(end.kmh))}L${f(x(end.s))} ${f(y0)}Z`;
      const band = s('path', { class: `lap-band lap-band--${run.phase}`, d });
      if (run.phase === 'clip') band.setAttribute('fill', `url(#${hatchId})`);
      parts.push(band);
    }

    // Grid: speed on the left, battery charge on the right.
    const showMid = plotH >= 44;
    for (let v = 0; v <= Y_MAX_KMH; v += Y_STEP_KMH) {
      const yy = yK(v);
      parts.push(s('line', { class: v ? 'chart-grid' : 'chart-axis', x1: x0, x2: x1, y1: f(yy), y2: f(yy) }));
      if (v && (showMid || v === 300)) parts.push(text(String(v), { class: 'chart-tick', x: x0 - 5, y: f(yy + 3.5), 'text-anchor': 'end' }));
    }
    for (let km = 1000; km < lap.lengthM; km += 1000) {
      parts.push(s('line', { class: 'chart-grid chart-grid--v', x1: f(x(km)), x2: f(x(km)), y1: pad.t, y2: f(y0) }));
    }
    const win = lap.windowMJ;
    for (const mj of showMid ? [0, win / 2, win] : [0, win]) {
      labels.push(text(String(mj), { class: 'chart-tick lap-soc-tick', x: x1 + 5, y: f(yE(mj) + 3.5) }));
    }
    labels.push(text('km/h', { class: 'chart-unit', x: x0 - 5, y: f(pad.t - 5), 'text-anchor': 'end' }));
    labels.push(text('MJ', { class: 'chart-unit lap-soc-tick', x: x1 + 5, y: f(pad.t - 5) }));

    // Speed, then the battery charge on top (with a paper halo so it reads over every band).
    const speedD = tr.map((p, i) => `${i ? 'L' : 'M'}${f(x(p.s))} ${f(yK(p.kmh))}`).join('') + `L${f(x1)} ${f(yK(tr[0].kmh))}`;
    const socD = tr.map((p, i) => `${i ? 'L' : 'M'}${f(x(p.s))} ${f(yE(p.socMJ))}`).join('') + `L${f(x1)} ${f(yE(tr[0].socMJ))}`;
    parts.push(s('path', { class: 'lap-speed', d: speedD }));
    parts.push(s('path', { class: 'lap-soc-halo', d: socD }));
    parts.push(s('path', { class: 'lap-soc', d: socD }));

    // Corner ticks on the axis. Corners a few metres apart (a chicane) share one label, "T7/8";
    // on a narrow plot a label that would overlap the one before it is left out (its tick stays).
    const merged: { label: string; px: number; ticks: number[] }[] = [];
    for (const c of lap.corners) {
      const px = x(c.s);
      const prev = merged[merged.length - 1];
      if (prev && px - prev.ticks[prev.ticks.length - 1] < CHICANE_PX) {
        prev.label += `/${c.label.replace(/^T/, '')}`;
        prev.ticks.push(px);
        prev.px = (prev.ticks[0] + px) / 2;
      } else merged.push({ label: c.label, px, ticks: [px] });
    }
    let lastRight = -Infinity;
    for (const m of merged) {
      for (const px of m.ticks) parts.push(s('line', { class: 'lap-corner-tick', x1: f(px), x2: f(px), y1: f(y0), y2: f(y0 + 4) }));
      const half = (m.label.length * LABEL_CHAR_PX) / 2;
      const anchor = m.px - half < x0 - 4 ? 'start' : m.px + half > x1 + 4 ? 'end' : 'middle';
      const left = anchor === 'start' ? m.px : anchor === 'end' ? m.px - 2 * half : m.px - half;
      if (left < lastRight + LABEL_GAP) continue;
      lastRight = left + 2 * half;
      labels.push(text(m.label, { class: 'lap-corner', x: f(m.px), y: f(y0 + 13.5), 'text-anchor': anchor }));
    }

    staticLayer.replaceChildren(...parts);
    labelLayer.replaceChildren(...labels);
    headLine.setAttribute('y1', f(pad.t - 1));
    headLine.setAttribute('y2', f(y0));
    placeHead();
  }

  const setHeadX1 = attrSlot(headLine, 'x1');
  const setHeadX2 = attrSlot(headLine, 'x2');
  const setHandle = attrSlot(handle, 'transform');
  const setSpeedX = attrSlot(dotSpeed, 'cx');
  const setSpeedY = attrSlot(dotSpeed, 'cy');
  const setSocX = attrSlot(dotSoc, 'cx');
  const setSocY = attrSlot(dotSoc, 'cy');
  const setViewBox = attrSlot(svg, 'viewBox');
  const setMax = attrSlot(el, 'aria-valuemax');
  const setNow = attrSlot(el, 'aria-valuenow');
  const setText = attrSlot(el, 'aria-valuetext');

  function placeHead() {
    if (!lap || !w) return;
    const px = f(x(last.sM));
    setHeadX1(px);
    setHeadX2(px);
    setHandle(`translate(${px} ${f(pad.t - 14)})`);
    setSpeedX(px);
    setSocX(px);
    setSpeedY(f(yK(last.kmh)));
    setSocY(f(yE(last.soc)));
  }

  // ── scrubbing ────────────────────────────────────────────────────────────────
  let dragId: number | null = null;
  function scrubAt(clientX: number) {
    if (!lap || !w) return;
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * w;
    const m = ((px - pad.l) / (w - pad.l - pad.r)) * lap.lengthM;
    // The line itself is the next lap's 0 s: stop just short of it, as End does.
    onScrub(Math.min(timeAtDistance(lap, m), lastMoment(lap)));
  }
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || !lap) return;
    dragId = e.pointerId;
    el.setPointerCapture(e.pointerId);
    el.classList.add('is-dragging');
    scrubAt(e.clientX);
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerId === dragId) scrubAt(e.clientX);
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== dragId) return;
    dragId = null;
    el.classList.remove('is-dragging');
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };
  const onKey = (e: KeyboardEvent) => {
    if (!lap || e.altKey || e.ctrlKey || e.metaKey) return;
    const step = e.shiftKey ? KEY_BIG_STEP_S : KEY_STEP_S;
    const end = lastMoment(lap);
    const next: number | undefined = {
      ArrowRight: last.tS + step,
      ArrowUp: last.tS + step,
      ArrowLeft: last.tS - step,
      ArrowDown: last.tS - step,
      PageUp: last.tS + KEY_BIG_STEP_S,
      PageDown: last.tS - KEY_BIG_STEP_S,
      Home: 0,
      End: end,
    }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    last.tS = Math.min(end, Math.max(0, next));
    onScrub(last.tS);
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('keydown', onKey);

  const ro = new ResizeObserver(() => {
    const nw = Math.round(el.clientWidth);
    const nh = Math.round(el.clientHeight);
    if (!nw || !nh || (nw === w && nh === ht)) return;
    w = nw;
    ht = nh;
    setViewBox(`0 0 ${w} ${ht}`);
    drawStatic();
  });
  ro.observe(el);

  return {
    el,
    render(v) {
      if (v.lap !== lap) {
        lap = v.lap;
        setMax(v.lap.lapTimeS.toFixed(1));
        drawStatic();
      } else if (drawnFor !== lap) drawStatic();
      last.tS = v.tS;
      last.sM = v.sM;
      last.kmh = v.kmh;
      last.soc = v.socMJ;
      setNow(v.tS.toFixed(1));
      setText(spokenLapPosition(v.tS, v.sM, whereOnLap(v.lap, v.sM)));
      placeHead();
    },
    dispose() {
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('keydown', onKey);
    },
  };
}
