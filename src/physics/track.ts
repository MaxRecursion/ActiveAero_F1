/**
 * A fictional 5.06 km circuit, built from straights and constant-radius arcs so every corner has
 * an exact radius for the physics. The loop closes exactly: three straight lengths were solved so
 * the end point and heading meet the start (total turn −360°, clockwise).
 *
 * Coordinates: metres, start/finish at the origin heading along +x; map y grows to the left.
 */

export type Segment =
  | { kind: 'straight'; length: number }
  | { kind: 'arc'; radius: number; /** degrees, + left / − right */ angle: number; label: string };

export const CIRCUIT_NAME = 'Tunnel Park (fictional)';

export const SEGMENTS: readonly Segment[] = [
  { kind: 'straight', length: 820 },
  { kind: 'arc', radius: 28, angle: -80, label: 'T1' },
  { kind: 'straight', length: 265.413 },
  { kind: 'arc', radius: 70, angle: 55, label: 'T2' },
  { kind: 'straight', length: 160 },
  { kind: 'arc', radius: 115, angle: -50, label: 'T3' },
  { kind: 'straight', length: 720 },
  { kind: 'arc', radius: 18, angle: -115, label: 'T4' },
  { kind: 'straight', length: 380 },
  { kind: 'arc', radius: 160, angle: 45, label: 'T5' },
  { kind: 'straight', length: 140 },
  { kind: 'arc', radius: 260, angle: -80, label: 'T6' },
  { kind: 'straight', length: 925.812 },
  { kind: 'arc', radius: 32, angle: -55, label: 'T7' },
  { kind: 'arc', radius: 32, angle: 55, label: 'T8' },
  { kind: 'straight', length: 235.812 },
  { kind: 'arc', radius: 48, angle: -105, label: 'T9' },
  { kind: 'straight', length: 484.192 },
  { kind: 'arc', radius: 90, angle: -30, label: 'T10' },
];

export interface TrackPoint {
  /** Distance from the start line, m. */
  s: number;
  x: number;
  y: number;
  /** Curvature 1/r (0 on straights), 1/m. */
  curvature: number;
  /** Index into SEGMENTS. */
  segment: number;
}

export interface Corner {
  label: string;
  /** Distance of the corner's midpoint. */
  s: number;
  x: number;
  y: number;
  radius: number;
}

export interface Track {
  length: number;
  points: TrackPoint[];
  corners: Corner[];
  /** Start distance and length of each straight, in lap order. */
  straights: { segment: number; start: number; length: number }[];
}

export function segmentLength(seg: Segment): number {
  return seg.kind === 'straight' ? seg.length : (Math.abs(seg.angle) * Math.PI * seg.radius) / 180;
}

/** Sample the circuit every `ds` metres. */
export function buildTrack(ds = 2): Track {
  const points: TrackPoint[] = [];
  const corners: Corner[] = [];
  const straights: Track['straights'] = [];
  let x = 0;
  let y = 0;
  let heading = 0;
  let s0 = 0;

  SEGMENTS.forEach((seg, index) => {
    const len = segmentLength(seg);
    const n = Math.max(1, Math.round(len / ds));
    const step = len / n;
    if (seg.kind === 'straight') {
      straights.push({ segment: index, start: s0, length: len });
      for (let i = 0; i < n; i++) {
        const d = i * step;
        points.push({ s: s0 + d, x: x + d * Math.cos(heading), y: y + d * Math.sin(heading), curvature: 0, segment: index });
      }
      x += len * Math.cos(heading);
      y += len * Math.sin(heading);
    } else {
      const sign = Math.sign(seg.angle);
      const a = (seg.angle * Math.PI) / 180;
      const cx = x - sign * seg.radius * Math.sin(heading);
      const cy = y + sign * seg.radius * Math.cos(heading);
      const at = (h: number) => ({ x: cx + sign * seg.radius * Math.sin(h), y: cy - sign * seg.radius * Math.cos(h) });
      for (let i = 0; i < n; i++) {
        const p = at(heading + (a * i) / n);
        points.push({ s: s0 + i * step, x: p.x, y: p.y, curvature: 1 / seg.radius, segment: index });
      }
      const mid = at(heading + a / 2);
      corners.push({ label: seg.label, s: s0 + len / 2, x: mid.x, y: mid.y, radius: seg.radius });
      heading += a;
      const end = at(heading);
      x = end.x;
      y = end.y;
    }
    s0 += len;
  });

  return { length: s0, points, corners, straights };
}
