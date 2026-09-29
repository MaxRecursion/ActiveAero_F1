/**
 * Height fields of the car, seen straight down and straight up: for every (x, z) column, the
 * highest and lowest surface point. The streamline tracer only needs to know "what is under me"
 * and "what is over me", and a grid answers that in O(1) per sample.
 *
 * Built by rasterising triangles into the grid on the CPU (one pass over ~90k triangles) rather
 * than by raycasting: a vertical ray tests every triangle of every mesh whose bounds it crosses,
 * which for a few thousand samples costs seconds; the raster pass costs a few milliseconds.
 */
import * as THREE from 'three';

/** Grid extent and cell size, car frame (metres). Covers the assembled car with a margin. */
const X0 = -3.3;
const X1 = 3.3;
const Z0 = -1.1;
const Z1 = 1.1;
const CELL = 0.02;

const NX = Math.round((X1 - X0) / CELL);
const NZ = Math.round((Z1 - Z0) / CELL);

export class HeightField {
  /** Highest surface per cell; -Infinity where the column is empty. */
  private readonly hi = new Float32Array(NX * NZ).fill(-Infinity);
  /** Lowest surface per cell; +Infinity where the column is empty. */
  private readonly lo = new Float32Array(NX * NZ).fill(Infinity);

  splat(x: number, y: number, z: number): void {
    const i = Math.floor((x - X0) / CELL);
    const j = Math.floor((z - Z0) / CELL);
    if (i < 0 || i >= NX || j < 0 || j >= NZ) return;
    const k = i * NZ + j;
    if (y > this.hi[k]) this.hi[k] = y;
    if (y < this.lo[k]) this.lo[k] = y;
  }

  /** Highest surface over the band |z - zc| ≤ halfWidth at x (-Infinity if nothing is there). */
  top(x: number, zc: number, halfWidth: number): number {
    return this.reduce(x, zc, halfWidth, this.hi, Math.max, -Infinity);
  }

  /** Lowest surface over the band |z - zc| ≤ halfWidth at x (+Infinity if nothing is there). */
  bottom(x: number, zc: number, halfWidth: number): number {
    return this.reduce(x, zc, halfWidth, this.lo, Math.min, Infinity);
  }

  private reduce(
    x: number,
    zc: number,
    halfWidth: number,
    field: Float32Array,
    pick: (a: number, b: number) => number,
    empty: number,
  ): number {
    const i = Math.floor((x - X0) / CELL);
    if (i < 0 || i >= NX) return empty;
    const j0 = Math.max(0, Math.floor((zc - halfWidth - Z0) / CELL));
    const j1 = Math.min(NZ - 1, Math.floor((zc + halfWidth - Z0) / CELL));
    let out = empty;
    for (let j = j0; j <= j1; j++) out = pick(out, field[i * NZ + j]);
    return out;
  }
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();

/**
 * Rasterise meshes into a height field in the frame of `frame` (the car root).
 * Triangle interiors fill the cells whose centres they cover; edges are also walked at half-cell
 * steps, so thin vertical plates (endplates, fences) that cover no cell centre still register.
 */
export function rasterize(meshes: readonly THREE.Mesh[], frame: THREE.Object3D): HeightField {
  const field = new HeightField();
  frame.updateMatrixWorld(true);
  _inv.copy(frame.matrixWorld).invert();

  for (const mesh of meshes) {
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const pos = geometry.getAttribute('position');
    if (!pos) continue;
    const index = geometry.getIndex();
    const count = index ? index.count : pos.count;
    _m.multiplyMatrices(_inv, mesh.matrixWorld);
    for (let t = 0; t + 2 < count; t += 3) {
      const ia = index ? index.getX(t) : t;
      const ib = index ? index.getX(t + 1) : t + 1;
      const ic = index ? index.getX(t + 2) : t + 2;
      _a.fromBufferAttribute(pos, ia).applyMatrix4(_m);
      _b.fromBufferAttribute(pos, ib).applyMatrix4(_m);
      _c.fromBufferAttribute(pos, ic).applyMatrix4(_m);
      fillTriangle(field, _a, _b, _c);
      walkEdge(field, _a, _b);
      walkEdge(field, _b, _c);
      walkEdge(field, _c, _a);
    }
  }
  return field;
}

function fillTriangle(field: HeightField, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
  const area = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
  if (Math.abs(area) < 1e-9) return; // edge-on from above; the edge walk covers it
  const i0 = Math.ceil((Math.min(a.x, b.x, c.x) - X0) / CELL - 0.5);
  const i1 = Math.floor((Math.max(a.x, b.x, c.x) - X0) / CELL - 0.5);
  const j0 = Math.ceil((Math.min(a.z, b.z, c.z) - Z0) / CELL - 0.5);
  const j1 = Math.floor((Math.max(a.z, b.z, c.z) - Z0) / CELL - 0.5);
  for (let i = i0; i <= i1; i++) {
    const px = X0 + (i + 0.5) * CELL;
    for (let j = j0; j <= j1; j++) {
      const pz = Z0 + (j + 0.5) * CELL;
      const wa = ((b.x - px) * (c.z - pz) - (c.x - px) * (b.z - pz)) / area;
      const wb = ((c.x - px) * (a.z - pz) - (a.x - px) * (c.z - pz)) / area;
      const wc = 1 - wa - wb;
      if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
      field.splat(px, wa * a.y + wb * b.y + wc * c.y, pz);
    }
  }
}

function walkEdge(field: HeightField, a: THREE.Vector3, b: THREE.Vector3): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (CELL * 0.5)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    field.splat(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  }
}
