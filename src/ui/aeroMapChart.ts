/**
 * Station 6, zone C — the aero map, the station's hero chart.
 *
 * x is the front ride height, y the rear ride height (mm, the floor's reference plane above the
 * road at each axle). Colour is the downforce coefficient ClA from the physics map, on a one-hue
 * ramp (more is darker on paper, brighter in the dark theme) with a scale bar in m²; thin contours
 * mark every 0.2 m². Dashed lines are aero balance (% of the downforce on the front axle). Hatching
 * marks where the floor has stalled — below its peak the diffuser flow separates and the downforce
 * falls away — and grey where the plank would be on the road.
 *
 * On top: the reference point (where every number equals the other stations' constants), the
 * static set-up (a hollow ring, draggable), the path the car takes across the map as speed builds
 * from 0 to 350 km/h (ticks every 100 km/h) and where it is now (a filled dot; it rings when the
 * car porpoises). The heat map is a canvas drawn once per size and theme; the overlays are SVG in
 * real pixels, so text never scales. Per frame only the dots move.
 *
 * Keyboard and screen-reader users set the heights with the sliders in zone A; the map is an
 * image with a spoken summary of the current point.
 */
import { aeroMapAt, aeroMapGrid, MAP_RANGE, SETUP_RANGE, type MapGrid } from '../physics/aeromap';
import type { RideHeights, Station6View } from './types';
import { attrSlot, h, s } from './dom';
import { fmtKmh, fmtMm } from './format';
import { contours, hex, labelSpot, parseColor, rampTable, sampleGrid, ticks, type RGB } from './aeroMapMath';

export interface AeroMapChart {
  el: HTMLElement;
  render(view: Station6View): void;
  dispose(): void;
}

/** Colour scale of ClA, m²: fixed, so a colour always means the same downforce. */
export const CLA_SCALE = { min: 2, max: 3.6, step: 0.4 } as const;
const CONTOUR_STEP = 0.2;
/** Aero balance iso-lines, % front. */
const BALANCE_STEP = 2;
/** Map samples: 0.5 mm × 1 mm for colour and contours; a coarser grid for the floor and plank fields. */
const FINE = { nf: 121, nr: 141 };
const COARSE = { nf: 61, nr: 71 };
/** Trajectory ticks, km/h. */
const SPEED_TICKS = [100, 200, 300];
const RAMP_STEPS = 5;

const [F0, F1] = MAP_RANGE.frontMm;
const [R0, R1] = MAP_RANGE.rearMm;

/** Everything about the map that does not depend on the screen: computed once, on first draw. */
interface MapData {
  fine: MapGrid;
  /** Ruhrmann's η on the coarse grid, and the η below which the physics calls the floor stalled. */
  eta: Float32Array;
  stallEta: number;
  /** Plank clearance on the coarse grid, mm (≤ 0: on the road). */
  plank: Float32Array;
  claLines: { level: number; lines: number[][] }[];
  balanceLines: { level: number; lines: number[][] }[];
  stallLines: number[][];
  plankLines: number[][];
}

function buildData(): MapData {
  const fine = aeroMapGrid(FINE.nf, FINE.nr);
  const n = COARSE.nf * COARSE.nr;
  const eta = new Float32Array(n);
  const plank = new Float32Array(n);
  // The physics names the regime from η alone; find the η that separates "stalled" from the rest
  // so the boundary can be drawn as a smooth line instead of a staircase of grid cells.
  let stalledMax = -Infinity;
  let otherMin = Infinity;
  for (let j = 0; j < COARSE.nr; j++) {
    for (let i = 0; i < COARSE.nf; i++) {
      const p = aeroMapAt({ frontMm: F0 + ((F1 - F0) * i) / (COARSE.nf - 1), rearMm: R0 + ((R1 - R0) * j) / (COARSE.nr - 1) });
      const k = j * COARSE.nf + i;
      eta[k] = p.floor.eta;
      plank[k] = p.plankClearanceMm;
      if (p.floor.regime === 'stalled') stalledMax = Math.max(stalledMax, p.floor.eta);
      else otherMin = Math.min(otherMin, p.floor.eta);
    }
  }
  const stallEta = stalledMax === -Infinity ? -1 : otherMin === Infinity ? Infinity : (stalledMax + otherMin) / 2;
  const levels = (min: number, max: number, step: number) => ticks(min, max, step);
  let sMin = Infinity;
  let sMax = -Infinity;
  for (const v of fine.frontShare) {
    sMin = Math.min(sMin, v * 100);
    sMax = Math.max(sMax, v * 100);
  }
  return {
    fine,
    eta,
    stallEta,
    plank,
    claLines: levels(CLA_SCALE.min, CLA_SCALE.max, CONTOUR_STEP).map((level) => ({ level, lines: contours(fine.clA, FINE.nf, FINE.nr, level) })),
    balanceLines: levels(Math.ceil(sMin), Math.floor(sMax), BALANCE_STEP).map((level) => ({
      level,
      lines: contours(fine.frontShare, FINE.nf, FINE.nr, level / 100),
    })),
    stallLines: Number.isFinite(stallEta) ? contours(eta, COARSE.nf, COARSE.nr, stallEta) : [],
    plankLines: contours(plank, COARSE.nf, COARSE.nr, 0),
  };
}

const fineAt = (field: ArrayLike<number>, f: number, r: number) =>
  sampleGrid(field, FINE.nf, FINE.nr, ((f - F0) / (F1 - F0)) * (FINE.nf - 1), ((r - R0) / (R1 - R0)) * (FINE.nr - 1));
const coarseAt = (field: ArrayLike<number>, f: number, r: number) =>
  sampleGrid(field, COARSE.nf, COARSE.nr, ((f - F0) / (F1 - F0)) * (COARSE.nf - 1), ((r - R0) / (R1 - R0)) * (COARSE.nr - 1));

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function createAeroMapChart(onSetup: (setup: RideHeights) => void): AeroMapChart {
  const canvas = h('canvas', { class: 'am-heat', attrs: { 'aria-hidden': 'true' } });
  const staticLayer = s('g', { class: 'am-static' });
  const labelLayer = s('g', { class: 'am-labels' });
  const pathHalo = s('path', { class: 'am-path-halo' });
  const path = s('path', { class: 'am-path' });
  const pathTicks = s('g', { class: 'am-path-ticks' });
  const rangeRect = s('rect', { class: 'am-range' });
  const setupRing = s('circle', { class: 'am-setup', r: 6.5 });
  const setupHit = s('circle', { class: 'am-setup-hit', r: 20 });
  const setupLabel = s('text', { class: 'am-setup-label' }, ['set-up']);
  const setupGroup = s('g', { class: 'am-setup-group' }, [setupHit, setupRing, setupLabel]);
  const pulse = s('circle', { class: 'am-pulse', r: 6 });
  const nowDot = s('circle', { class: 'am-now', r: 5 });
  const nowGroup = s('g', { class: 'am-now-group' }, [pulse, nowDot]);
  const hoverLineX = s('line', { class: 'am-hover-line' });
  const hoverLineY = s('line', { class: 'am-hover-line' });
  const hoverBox = s('rect', { class: 'am-hover-box', rx: 3 });
  const hoverText1 = s('text', { class: 'am-hover-text' });
  const hoverText2 = s('text', { class: 'am-hover-text am-hover-text--strong' });
  const hover = s('g', { class: 'am-hover', visibility: 'hidden' }, [hoverLineX, hoverLineY, hoverBox, hoverText1, hoverText2]);
  const svg = s('svg', { class: 'am-svg', role: 'img', 'aria-label': 'Aero map' }, [
    staticLayer,
    rangeRect,
    pathHalo,
    path,
    pathTicks,
    labelLayer,
    s('g', { class: 'am-live', 'aria-hidden': 'true' }, [setupGroup, nowGroup]),
    hover,
  ]);
  const plot = h('div', 'am-plot', [canvas, svg]);

  // Scale bar: the ramp itself, with m² ticks under it.
  const rampBar = h('span', 'am-scale-bar');
  const rampTicks = h(
    'span',
    'am-scale-ticks',
    // Every other step (2.0 · 2.8 · 3.6): the bar is short and five figures would run together.
    [CLA_SCALE.min, (CLA_SCALE.min + CLA_SCALE.max) / 2, CLA_SCALE.max].map((v) => {
      const t = h('span', { class: 'am-scale-tick', text: v.toFixed(1) });
      t.style.left = `${(((v - CLA_SCALE.min) / (CLA_SCALE.max - CLA_SCALE.min)) * 100).toFixed(2)}%`;
      return t;
    }),
  );
  const legendItem = (cls: string, label: string) => h('span', `legend-item ${cls}`, [h('i', { class: 'legend-key', attrs: { 'aria-hidden': 'true' } }), label]);
  const el = h('section', { class: 'zone zone-chart zone-amap', attrs: { 'aria-label': 'Aero map: downforce and balance against ride height' } }, [
    h('h2', 'micro zone-title', [h('span', { class: 'idx', text: 'C' }), 'Aero map']),
    h('div', 'chart-head am-head', [
      h('p', { class: 'chart-title', text: 'Downforce by ride height' }),
      h('div', { class: 'chart-legend am-legend', attrs: { 'aria-hidden': 'true' } }, [
        h('span', 'am-scale', [h('span', { class: 'am-scale-name', text: 'ClA m²' }), h('span', 'am-scale-body', [rampBar, rampTicks])]),
        legendItem('am-key--balance', '% front'),
        legendItem('am-key--stall', 'Floor stalled'),
      ]),
    ]),
    plot,
  ]);

  let data: MapData | null = null;
  let w = 0;
  let ht = 0;
  const pad = { l: 30, r: 10, t: 20, b: 20 };
  const pw = () => w - pad.l - pad.r;
  const ph = () => ht - pad.t - pad.b;
  const x = (f: number) => pad.l + ((f - F0) / (F1 - F0)) * pw();
  const y = (r: number) => pad.t + ((R1 - r) / (R1 - R0)) * ph();
  const fAt = (px: number) => F0 + ((px - pad.l) / pw()) * (F1 - F0);
  const rAt = (py: number) => R1 - ((py - pad.t) / ph()) * (R1 - R0);
  const f1 = (n: number) => n.toFixed(1);
  /** Ride height for the spoken summary, signed: the front can read below the road when the rear is high. */
  const spokenMm = (mm: number) => `${Math.round(mm) < 0 ? 'minus ' : ''}${fmtMm(Math.abs(mm))} mm`;
  const text = (content: string, attrs: Record<string, string | number>) => s('text', attrs, [content]);

  /** Polyline in grid coordinates of a grid over MAP_RANGE → pixels, flat. */
  const toPx = (line: number[], nf: number, nr: number) => {
    const out: number[] = new Array(line.length);
    for (let k = 0; k < line.length; k += 2) {
      out[k] = x(F0 + (line[k] / (nf - 1)) * (F1 - F0));
      out[k + 1] = y(R0 + (line[k + 1] / (nr - 1)) * (R1 - R0));
    }
    return out;
  };
  const pathD = (pts: number[]) => {
    let d = '';
    for (let k = 0; k < pts.length; k += 2) d += `${k ? 'L' : 'M'}${f1(pts[k])} ${f1(pts[k + 1])}`;
    return d;
  };

  // ── the heat map (canvas) ─────────────────────────────────────────────────────
  function token(name: string, fallback: RGB): RGB {
    return parseColor(getComputedStyle(plot).getPropertyValue(name)) ?? fallback;
  }
  function drawHeat() {
    if (!data || !w || !ht) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.max(1, Math.round(pw() * dpr));
    const ch = Math.max(1, Math.round(ph() * dpr));
    canvas.width = cw;
    canvas.height = ch;
    canvas.style.left = `${pad.l}px`;
    canvas.style.top = `${pad.t}px`;
    canvas.style.width = `${pw()}px`;
    canvas.style.height = `${ph()}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const stops = Array.from({ length: RAMP_STEPS }, (_, i) => token(`--am-ramp-${i}`, [35, 86, 246]));
    const lut = rampTable(stops, 256);
    rampBar.style.background = `linear-gradient(to right, ${Array.from({ length: 9 }, (_, i) => {
      const k = Math.round((i / 8) * 255) * 3;
      return hex([lut[k], lut[k + 1], lut[k + 2]]);
    }).join(', ')})`;
    const hatch = token('--am-hatch', [22, 24, 29]);
    const grey = token('--am-plank', [200, 200, 200]);
    const hatchAlpha = Number(getComputedStyle(plot).getPropertyValue('--am-hatch-alpha')) || 0.4;

    const d = data;
    const img = ctx.createImageData(cw, ch);
    const px = img.data;
    const period = 6 * dpr;
    const half = 0.55 * dpr;
    const fPerPx = (F1 - F0) / cw;
    const rPerPx = (R1 - R0) / ch;
    for (let py = 0; py < ch; py++) {
      const r = R1 - (py + 0.5) * rPerPx;
      for (let qx = 0; qx < cw; qx++) {
        const f = F0 + (qx + 0.5) * fPerPx;
        const t = clamp01((fineAt(d.fine.clA, f, r) - CLA_SCALE.min) / (CLA_SCALE.max - CLA_SCALE.min));
        const li = Math.round(t * 255) * 3;
        let cr = lut[li];
        let cg = lut[li + 1];
        let cb = lut[li + 2];

        // Stalled floor: desaturate a little and hatch. The edge is anti-aliased from the field's
        // own gradient, so the boundary is as smooth as the physics.
        const e = coarseAt(d.eta, f, r) - d.stallEta;
        let stall = e < 0 ? 1 : 0;
        if (Math.abs(e) < 0.05) {
          const gx = coarseAt(d.eta, f + fPerPx, r) - d.stallEta - e;
          const gy = coarseAt(d.eta, f, r - rPerPx) - d.stallEta - e;
          stall = clamp01(0.5 - e / (Math.hypot(gx, gy) || 1e-9));
        }
        if (stall > 0) {
          const lum = 0.3 * cr + 0.59 * cg + 0.11 * cb;
          const k = 0.35 * stall;
          cr += (lum - cr) * k;
          cg += (lum - cg) * k;
          cb += (lum - cb) * k;
          const m = (qx + py) % period;
          const dist = Math.min(m, period - m) / Math.SQRT2;
          const cov = clamp01(half + 0.5 - dist) * stall * hatchAlpha;
          cr += (hatch[0] - cr) * cov;
          cg += (hatch[1] - cg) * cov;
          cb += (hatch[2] - cb) * cov;
        }

        // Plank on the road: greyed out.
        const c = coarseAt(d.plank, f, r);
        let ground = c <= 0 ? 1 : 0;
        if (Math.abs(c) < 3) {
          const gx = coarseAt(d.plank, f + fPerPx, r) - c;
          const gy = coarseAt(d.plank, f, r - rPerPx) - c;
          ground = clamp01(0.5 - c / (Math.hypot(gx, gy) || 1e-9));
        }
        if (ground > 0) {
          const k = 0.88 * ground;
          cr += (grey[0] - cr) * k;
          cg += (grey[1] - cg) * k;
          cb += (grey[2] - cb) * k;
        }

        const o = (py * cw + qx) * 4;
        px[o] = cr;
        px[o + 1] = cg;
        px[o + 2] = cb;
        px[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ── the overlays that depend only on the map and the size ─────────────────────
  /** Where labels went, so later ones keep clear. */
  let placed: { x: number; y: number }[] = [];
  function drawStatic() {
    if (!data || !w || !ht) return;
    const d = data;
    pad.l = w < 360 ? 26 : 30;
    const parts: SVGElement[] = [];
    const labels: SVGElement[] = [];
    const box = { x0: pad.l, y0: pad.t, x1: w - pad.r, y1: ht - pad.b };
    placed = [];
    // Keep labels off the reference marker and the corners where the axis units sit.
    if (lastView) placed.push({ x: x(lastView.reference.frontMm), y: y(lastView.reference.rearMm) });

    // Axes: ticks and units outside the plot, a hairline frame.
    for (const f of ticks(F0, F1, 10)) {
      parts.push(s('line', { class: 'am-tick', x1: f1(x(f)), x2: f1(x(f)), y1: f1(ht - pad.b), y2: f1(ht - pad.b + 3) }));
      // The last figure's place is taken by the axis name.
      if (f === F1) continue;
      parts.push(text(String(f), { class: 'chart-tick', x: f1(x(f)), y: f1(ht - pad.b + 13), 'text-anchor': f === F0 ? 'start' : 'middle' }));
    }
    const rStep = ph() < 150 ? 40 : 20;
    for (const r of ticks(R0, R1, rStep)) {
      if (r === R0) continue;
      parts.push(s('line', { class: 'am-tick', x1: f1(pad.l - 3), x2: f1(pad.l), y1: f1(y(r)), y2: f1(y(r)) }));
      parts.push(text(String(r), { class: 'chart-tick', x: f1(pad.l - 5), y: f1(y(r) + 3.5), 'text-anchor': 'end' }));
    }
    parts.push(s('rect', { class: 'am-frame', x: pad.l + 0.5, y: pad.t + 0.5, width: f1(pw() - 1), height: f1(ph() - 1) }));
    // Axis names sit clear of the figures: the rear's above the top-left corner, the front's in place of its last figure.
    parts.push(text('rear, mm', { class: 'chart-unit', x: 2, y: f1(pad.t - 7), 'text-anchor': 'start' }));
    parts.push(text('front, mm', { class: 'chart-unit am-unit-x', x: f1(w - pad.r), y: f1(ht - pad.b + 13), 'text-anchor': 'end' }));
    placed.push({ x: w - pad.r - 20, y: ht - pad.b }, { x: pad.l, y: pad.t });

    // ClA contours: thin, every 0.2 m²; labels on the round ones.
    for (const { level, lines } of d.claLines) {
      const major = Math.abs(level * 10 - Math.round(level * 10)) < 1e-6 && Math.round(level * 10) % 4 === 0;
      for (const line of lines) {
        const pts = toPx(line, FINE.nf, FINE.nr);
        parts.push(s('path', { class: `am-contour${major ? ' am-contour--major' : ''}`, d: pathD(pts) }));
        if (!major && level !== 3.2) continue;
        const spot = labelSpot(pts, box, placed, 16, 10);
        if (!spot) continue;
        placed.push(spot);
        labels.push(
          text(level.toFixed(1), {
            class: 'am-contour-label',
            x: f1(spot.x),
            y: f1(spot.y),
            transform: `rotate(${f1(spot.angle)} ${f1(spot.x)} ${f1(spot.y)})`,
            'text-anchor': 'middle',
            'dominant-baseline': 'central',
          }),
        );
      }
    }

    // Aero balance: dashed, labelled "% front".
    for (const { level, lines } of d.balanceLines) {
      for (const line of lines) {
        const pts = toPx(line, FINE.nf, FINE.nr);
        if (pts.length < 8) continue;
        parts.push(s('path', { class: 'am-balance', d: pathD(pts) }));
        const spot = labelSpot(pts, box, placed, 18, 9);
        if (!spot) continue;
        placed.push(spot);
        labels.push(
          text(`${level}%`, {
            class: 'am-balance-label',
            x: f1(spot.x),
            y: f1(spot.y),
            transform: `rotate(${f1(spot.angle)} ${f1(spot.x)} ${f1(spot.y)})`,
            'text-anchor': 'middle',
            'dominant-baseline': 'central',
          }),
        );
      }
    }

    // The floor's stall line and the plank's line, with their names along them.
    const edge = (lines: number[][], nf: number, nr: number, cls: string, name: string, below: boolean) => {
      let best: number[] | null = null;
      for (const line of lines) {
        const pts = toPx(line, nf, nr);
        parts.push(s('path', { class: cls, d: pathD(pts) }));
        if (!best || pts.length > best.length) best = pts;
      }
      if (!best) return;
      const spot = labelSpot(best, box, placed, 22, 8);
      if (!spot) return;
      // Hang the name on the side of the line where the region is.
      const rad = ((spot.angle + 90) * Math.PI) / 180;
      const off = below ? 8 : -8;
      const lx = spot.x + Math.cos(rad) * off;
      const ly = spot.y + Math.sin(rad) * off;
      placed.push({ x: lx, y: ly });
      labels.push(
        text(name, {
          class: `${cls}-label`,
          x: f1(lx),
          y: f1(ly),
          transform: `rotate(${f1(spot.angle)} ${f1(lx)} ${f1(ly)})`,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
        }),
      );
    };
    edge(d.stallLines, COARSE.nf, COARSE.nr, 'am-stall', 'FLOOR STALLED', true);
    edge(d.plankLines, COARSE.nf, COARSE.nr, 'am-plank', 'PLANK ON ROAD', true);

    // The reference point: where the map equals the constants stations 1–5 use.
    if (lastView) {
      const rx = x(lastView.reference.frontMm);
      const ry = y(lastView.reference.rearMm);
      parts.push(s('path', { class: 'am-ref', d: `M${f1(rx - 4)} ${f1(ry)}H${f1(rx + 4)}M${f1(rx)} ${f1(ry - 4)}V${f1(ry + 4)}` }));
      labels.push(text('ref', { class: 'am-ref-label', x: f1(rx + 6), y: f1(ry - 5) }));
    }

    staticLayer.replaceChildren(...parts);
    labelLayer.replaceChildren(...labels);
    rangeRect.setAttribute('x', f1(x(SETUP_RANGE.frontMm[0])));
    rangeRect.setAttribute('y', f1(y(SETUP_RANGE.rearMm[1])));
    rangeRect.setAttribute('width', f1(x(SETUP_RANGE.frontMm[1]) - x(SETUP_RANGE.frontMm[0])));
    rangeRect.setAttribute('height', f1(y(SETUP_RANGE.rearMm[0]) - y(SETUP_RANGE.rearMm[1])));
  }

  // ── the set-up's path across the map ───────────────────────────────────────────
  let drawnTrajectory: Station6View['trajectory'] | null = null;
  function drawTrajectory() {
    const tr = lastView?.trajectory;
    if (!tr || !w || !ht || tr.length < 2) return;
    drawnTrajectory = tr;
    let d = '';
    for (let k = 0; k < tr.length; k++) d += `${k ? 'L' : 'M'}${f1(x(tr[k].frontMm))} ${f1(y(tr[k].rearMm))}`;
    path.setAttribute('d', d);
    pathHalo.setAttribute('d', d);
    const marks: SVGElement[] = [];
    const end = tr[tr.length - 1];
    for (const kmh of [...SPEED_TICKS, end.kmh]) {
      const p = pointAt(tr, kmh);
      if (!p) continue;
      const cx = x(p.frontMm);
      const cy = y(p.rearMm);
      // Label on the outside of the bend: away from where the path came from.
      const prev = pointAt(tr, Math.max(0, kmh - 20)) ?? p;
      const ang = Math.atan2(cy - y(prev.rearMm), cx - x(prev.frontMm));
      const lx = cx + Math.cos(ang - Math.PI / 2) * 9;
      const ly = cy + Math.sin(ang - Math.PI / 2) * 9;
      marks.push(s('circle', { class: 'am-path-tick', cx: f1(cx), cy: f1(cy), r: 2.5 }));
      marks.push(
        text(kmh === end.kmh ? `${fmtKmh(kmh)} km/h` : fmtKmh(kmh), {
          class: 'am-path-label',
          x: f1(lx),
          y: f1(ly),
          'text-anchor': lx < cx - 2 ? 'end' : lx > cx + 2 ? 'start' : 'middle',
          'dominant-baseline': 'central',
        }),
      );
    }
    pathTicks.replaceChildren(...marks);
  }

  // ── live: set-up ring, the car now, the spoken summary ───────────────────────────
  const setSetupT = attrSlot(setupGroup, 'transform');
  const setNowT = attrSlot(nowGroup, 'transform');
  const setState = attrSlot(plot, 'data-state');
  const setAria = attrSlot(svg, 'aria-label');
  const setLabelAnchor = attrSlot(setupLabel, 'text-anchor');
  const setLabelX = attrSlot(setupLabel, 'x');
  const setViewBox = attrSlot(svg, 'viewBox');
  let lastView: Station6View | null = null;

  function placeLive() {
    const v = lastView;
    if (!v || !w || !ht) return;
    const sx = x(v.setup.frontMm);
    const sy = y(v.setup.rearMm);
    setSetupT(`translate(${f1(sx)} ${f1(sy)})`);
    // The ring's name sits on the side with more room.
    const left = sx > pad.l + pw() * 0.7;
    setLabelAnchor(left ? 'end' : 'start');
    setLabelX(left ? '-11' : '11');
    setNowT(`translate(${f1(x(Math.min(F1, Math.max(F0, v.dynamic.frontMm))))} ${f1(y(Math.min(R1, Math.max(R0, v.dynamic.rearMm))))})`);
  }

  function describe(v: Station6View): string {
    const floor = v.floor.regime === 'stalled' ? 'floor stalled' : v.floor.regime === 'peak' ? 'floor at its peak' : 'floor attached';
    const bounce = v.bounce.unstable ? `, porpoising at ${v.bounce.frequencyHz.toFixed(1)} hertz` : '';
    return (
      `Aero map, downforce coefficient against front and rear ride height. At ${fmtKmh(v.speedKmh)} km/h the car runs ` +
      `${spokenMm(v.dynamic.frontMm)} front and ${spokenMm(v.dynamic.rearMm)} rear: ClA ${v.clA.toFixed(2)} square metres, ` +
      `${v.frontSharePct.toFixed(1)} % of it on the front axle, ${floor}${v.bottoming ? ', plank on the road' : ''}${bounce}. ` +
      `Static set-up ${fmtMm(v.setup.frontMm)} / ${fmtMm(v.setup.rearMm)} mm.`
    );
  }

  // ── dragging the set-up ───────────────────────────────────────────────────────────
  let dragId: number | null = null;
  let sent = '';
  /** Where in the ring the pointer grabbed it (px), so the ring does not jump to the pointer. */
  const grab = { dx: 0, dy: 0 };
  const toPlot = (e: PointerEvent) => {
    const rect = svg.getBoundingClientRect();
    return { px: ((e.clientX - rect.left) / rect.width) * w, py: ((e.clientY - rect.top) / rect.height) * ht };
  };
  const toSetup = (e: PointerEvent): RideHeights => {
    const { px: gx, py: gy } = toPlot(e);
    const px = gx - grab.dx;
    const py = gy - grab.dy;
    return {
      frontMm: Math.round(Math.min(SETUP_RANGE.frontMm[1], Math.max(SETUP_RANGE.frontMm[0], fAt(px)))),
      rearMm: Math.round(Math.min(SETUP_RANGE.rearMm[1], Math.max(SETUP_RANGE.rearMm[0], rAt(py)))),
    };
  };
  const send = (rh: RideHeights) => {
    const key = `${rh.frontMm}|${rh.rearMm}`;
    if (key === sent) return;
    sent = key;
    onSetup(rh);
  };
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragId = e.pointerId;
    sent = lastView ? `${lastView.setup.frontMm}|${lastView.setup.rearMm}` : '';
    if (lastView) {
      const { px, py } = toPlot(e);
      grab.dx = px - x(lastView.setup.frontMm);
      grab.dy = py - y(lastView.setup.rearMm);
    }
    setupHit.setPointerCapture(e.pointerId);
    plot.classList.add('is-dragging');
    hideHover();
    e.preventDefault();
  };
  const onDrag = (e: PointerEvent) => {
    if (e.pointerId === dragId) send(toSetup(e));
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== dragId) return;
    dragId = null;
    plot.classList.remove('is-dragging');
    if (setupHit.hasPointerCapture(e.pointerId)) setupHit.releasePointerCapture(e.pointerId);
  };
  setupHit.addEventListener('pointerdown', onDown);
  setupHit.addEventListener('pointermove', onDrag);
  setupHit.addEventListener('pointerup', onUp);
  setupHit.addEventListener('pointercancel', onUp);

  // ── hover: read any point of the map (mouse only) ─────────────────────────────────
  const setHover = attrSlot(hover, 'visibility');
  function hideHover() {
    setHover('hidden');
  }
  const onHover = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || dragId !== null || !data) return hideHover();
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * w;
    const py = ((e.clientY - rect.top) / rect.height) * ht;
    if (px < pad.l || px > w - pad.r || py < pad.t || py > ht - pad.b) return hideHover();
    const f = fAt(px);
    const r = rAt(py);
    const cla = fineAt(data.fine.clA, f, r);
    const share = fineAt(data.fine.frontShare, f, r) * 100;
    const ground = coarseAt(data.plank, f, r) <= 0;
    const stalled = coarseAt(data.eta, f, r) < data.stallEta;
    hoverLineX.setAttribute('x1', f1(px));
    hoverLineX.setAttribute('x2', f1(px));
    hoverLineX.setAttribute('y1', String(pad.t));
    hoverLineX.setAttribute('y2', f1(ht - pad.b));
    hoverLineY.setAttribute('x1', String(pad.l));
    hoverLineY.setAttribute('x2', f1(w - pad.r));
    hoverLineY.setAttribute('y1', f1(py));
    hoverLineY.setAttribute('y2', f1(py));
    hoverText1.textContent = `F ${fmtMm(f)} · R ${fmtMm(r)} mm`;
    hoverText2.textContent = `ClA ${cla.toFixed(2)} m² · ${share.toFixed(1)}% front${ground ? ' · plank down' : stalled ? ' · stalled' : ''}`;
    const bw = Math.max(hoverText1.getComputedTextLength(), hoverText2.getComputedTextLength()) + 14;
    const bh = 34;
    const bx = px + 12 + bw > w - pad.r ? px - 12 - bw : px + 12;
    const by = py - 12 - bh < pad.t ? py + 12 : py - 12 - bh;
    hoverBox.setAttribute('x', f1(bx));
    hoverBox.setAttribute('y', f1(by));
    hoverBox.setAttribute('width', f1(bw));
    hoverBox.setAttribute('height', String(bh));
    hoverText1.setAttribute('x', f1(bx + 7));
    hoverText1.setAttribute('y', f1(by + 13));
    hoverText2.setAttribute('x', f1(bx + 7));
    hoverText2.setAttribute('y', f1(by + 27));
    setHover('visible');
  };
  plot.addEventListener('pointermove', onHover);
  plot.addEventListener('pointerleave', hideHover);

  // ── size and theme ────────────────────────────────────────────────────────────────
  let heatFrame = 0;
  function redrawAll() {
    if (!w || !ht || !lastView) return;
    data ??= buildData();
    // The left margin depends on the width; set it before the heat map, which is drawn inside it.
    pad.l = w < 360 ? 26 : 30;
    drawHeat();
    drawStatic();
    drawTrajectory();
    placeLive();
  }
  const ro = new ResizeObserver(() => {
    const nw = Math.round(plot.clientWidth);
    const nh = Math.round(plot.clientHeight);
    if (!nw || !nh || (nw === w && nh === ht)) return;
    w = nw;
    ht = nh;
    setViewBox(`0 0 ${w} ${ht}`);
    // A window being resized fires many times a frame; draw once.
    cancelAnimationFrame(heatFrame);
    heatFrame = requestAnimationFrame(redrawAll);
  });
  ro.observe(plot);
  const themeObserver = new MutationObserver(() => drawHeat());
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  return {
    el,
    render(v) {
      const first = !lastView;
      lastView = v;
      if (first) {
        redrawAll();
      } else if (v.trajectory !== drawnTrajectory) {
        drawTrajectory();
      }
      placeLive();
      setState(v.bounce.unstable ? 'porpoising' : v.bottoming ? 'bottoming' : v.floor.regime);
      setAria(describe(v));
    },
    dispose() {
      ro.disconnect();
      themeObserver.disconnect();
      cancelAnimationFrame(heatFrame);
      setupHit.removeEventListener('pointerdown', onDown);
      setupHit.removeEventListener('pointermove', onDrag);
      setupHit.removeEventListener('pointerup', onUp);
      setupHit.removeEventListener('pointercancel', onUp);
      plot.removeEventListener('pointermove', onHover);
      plot.removeEventListener('pointerleave', hideHover);
    },
  };
}

/** The trajectory point at a speed (linear between samples), or null outside it. */
function pointAt(tr: Station6View['trajectory'], kmh: number): { frontMm: number; rearMm: number } | null {
  if (!tr.length || kmh < tr[0].kmh || kmh > tr[tr.length - 1].kmh) return null;
  for (let k = 1; k < tr.length; k++) {
    if (tr[k].kmh < kmh) continue;
    const a = tr[k - 1];
    const b = tr[k];
    const t = b.kmh === a.kmh ? 0 : (kmh - a.kmh) / (b.kmh - a.kmh);
    return { frontMm: a.frontMm + (b.frontMm - a.frontMm) * t, rearMm: a.rearMm + (b.rearMm - a.rearMm) * t };
  }
  return tr[0];
}
