/**
 * Lofted bodies: a body is a list of cross-sections along X, skinned into one smooth surface.
 * Sections are tapered superellipses — the family that covers a monocoque (boxy, narrower at the
 * top), a nose (rounder) and a sidepod with an undercut (wide shoulder, pinched bottom).
 */
import * as THREE from 'three';
import { LoftGeometry } from 'three/addons/geometries/LoftGeometry.js';
import { smooth } from './curves';

export interface Section {
  x: number;
  yBot: number;
  yTop: number;
  /** Half-width at the bottom of the section. */
  wBot: number;
  /** Half-width at the top of the section. */
  wTop: number;
  /** Centre z. Default 0. */
  z?: number;
  /** Superellipse exponent: 2 = ellipse, larger = boxier. Default 2.6. */
  n?: number;
  /**
   * Shape of the width change from bottom to top: 1 = straight taper; < 1 reaches the top width
   * quickly (a sidepod undercut); > 1 stays near the bottom width (an engine cover's hips).
   */
  bias?: number;
}

type Full = Required<Section>;
const full = (s: Section): Full => ({ z: 0, n: 2.6, bias: 1, ...s });

/** Point on a section at angle θ (0 = +z side, π/2 = top), exact superellipse. */
export function sectionPoint(s: Section, theta: number, out = new THREE.Vector3()): THREE.Vector3 {
  const f = full(s);
  const e = 2 / f.n;
  const c = Math.cos(theta);
  const sn = Math.sin(theta);
  const v = Math.sign(sn) * Math.abs(sn) ** e;
  const u = Math.sign(c) * Math.abs(c) ** e;
  const t = (v + 1) / 2;
  const w = f.wBot + (f.wTop - f.wBot) * t ** f.bias;
  return out.set(f.x, (f.yBot + f.yTop) / 2 + ((f.yTop - f.yBot) / 2) * v, f.z + w * u);
}

/** Closed ring of `count` points, counter-clockwise seen from -X. */
export function ring(s: Section, count: number): THREE.Vector3[] {
  return Array.from({ length: count }, (_, i) => sectionPoint(s, (i / count) * Math.PI * 2 - Math.PI / 2));
}

/** Sample keyed sections at the given stations, every field through a smooth curve. */
export function sampleSections(keys: readonly Section[], xs: readonly number[]): Section[] {
  const k = keys.map(full);
  const field = (name: keyof Full) => smooth(k.map((s) => [s.x, s[name]] as const));
  const f = {
    yBot: field('yBot'),
    yTop: field('yTop'),
    wBot: field('wBot'),
    wTop: field('wTop'),
    z: field('z'),
    n: field('n'),
    bias: field('bias'),
  };
  return xs.map((x) => ({
    x,
    yBot: f.yBot(x),
    yTop: f.yTop(x),
    wBot: f.wBot(x),
    wTop: f.wTop(x),
    z: f.z(x),
    n: f.n(x),
    bias: f.bias(x),
  }));
}

/** Scale a section about its own centre (keeps x unless given). */
export function scaled(s: Section, k: number, x = s.x): Section {
  const f = full(s);
  const mid = (f.yBot + f.yTop) / 2;
  const h = ((f.yTop - f.yBot) / 2) * k;
  return { ...f, x, yBot: mid - h, yTop: mid + h, wBot: f.wBot * k, wTop: f.wTop * k };
}

/**
 * Sections that close a body with a rounded (elliptical) end over `length` metres beyond `s`,
 * in direction `dir` along X. The last section is tiny and gets capped.
 */
export function roundEnd(s: Section, dir: 1 | -1, length: number, steps = 5): Section[] {
  return Array.from({ length: steps }, (_, i) => {
    const a = ((i + 1) / steps) * (Math.PI / 2) * 0.94;
    return scaled(s, Math.cos(a), s.x + dir * length * Math.sin(a));
  });
}

/**
 * An intake: the body starts with a recessed dark mouth, a rounded lip, then the full section.
 * Returns the leading sections (to prepend) and how many of them are "inside" (to tint dark).
 * The body loft must continue in -X from `s`.
 */
export function mouth(s: Section, depth: number): { sections: Section[]; inside: number } {
  return {
    sections: [
      scaled(s, 0.74, s.x - depth),
      scaled(s, 0.84, s.x - 0.012),
      scaled(s, 0.93, s.x + 0.006),
      scaled(s, 0.985, s.x - 0.01),
    ],
    inside: 2,
  };
}

export interface LoftOptions {
  /** Treat rings as closed loops (default) or open strips. */
  closed?: boolean;
  /** Cap both ends (default true). */
  caps?: boolean;
  /** Vertex tint per ring point (row = ring index); null = untinted. Caps take their ring's `col = -1` tint. */
  tint?: (row: number, col: number) => THREE.Color | null;
}

const WHITE = new THREE.Color(1, 1, 1);

/**
 * Skin rings into a watertight, outward-facing geometry (normals are computed later by the piece set).
 * LoftGeometry's walls face outward only for one ring winding, while its caps always face outward;
 * rings wound the other way are reversed first so walls and caps agree.
 */
export function loft(rings: THREE.Vector3[][], opts: LoftOptions = {}): THREE.BufferGeometry {
  const closed = opts.closed ?? true;
  const caps = opts.caps ?? true;
  const flip = closed && !wallsFaceOutward(rings);
  const cols = rings[0].length;
  const src = flip ? rings.map((r) => [...r].reverse()) : rings;
  const g = new LoftGeometry(src, { closed, capStart: caps, capEnd: caps });
  g.deleteAttribute('uv');
  if (opts.tint) {
    const tint = opts.tint;
    const at = (row: number, col: number) => tint(row, col < 0 || !flip ? col : cols - 1 - col);
    const perRow = closed ? cols + 1 : cols;
    const grid = rings.length * perRow;
    const count = g.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let v = 0; v < count; v++) {
      let c: THREE.Color | null;
      if (v < grid) c = at(Math.floor(v / perRow), (v % perRow) % cols);
      else c = at(v - grid < cols ? 0 : rings.length - 1, -1);
      (c ?? WHITE).toArray(colors, v * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  return g;
}

const centroid = (r: THREE.Vector3[]) =>
  r.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(r.length);

/**
 * LoftGeometry's walls face outward when each ring runs counter-clockwise seen from the last ring
 * looking back: i.e. the ring's Newell normal points along the loft direction.
 */
function wallsFaceOutward(rings: THREE.Vector3[][]): boolean {
  const mid = rings[Math.floor(rings.length / 2)];
  const n = new THREE.Vector3();
  for (let i = 0; i < mid.length; i++) {
    const p = mid[i];
    const q = mid[(i + 1) % mid.length];
    n.x += (p.y - q.y) * (p.z + q.z);
    n.y += (p.z - q.z) * (p.x + q.x);
    n.z += (p.x - q.x) * (p.y + q.y);
  }
  const dir = centroid(rings[rings.length - 1]).sub(centroid(rings[0]));
  return n.dot(dir) >= 0;
}
