/**
 * Shared model-processing helpers: read a GLB into one world-space triangle soup, weld it, and
 * split it into connected components (the separate solid bodies of the original CAD export).
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

/** World-space positions of every triangle corner (3 floats per corner, 9 per triangle). */
export async function readSoup(file) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(file);
  const chunks = [];
  let total = 0;
  for (const scene of doc.getRoot().listScenes()) {
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      const m = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        const idx = prim.getIndices();
        const n = idx ? idx.getCount() : pos.getCount();
        const out = new Float32Array(n * 3);
        const v = [0, 0, 0];
        for (let i = 0; i < n; i++) {
          pos.getElement(idx ? idx.getScalar(i) : i, v);
          out[i * 3] = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
          out[i * 3 + 1] = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
          out[i * 3 + 2] = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
        }
        chunks.push(out);
        total += n;
      }
    });
  }
  const soup = new Float32Array(total * 3);
  let o = 0;
  for (const c of chunks) {
    soup.set(c, o);
    o += c.length;
  }
  return soup;
}

/** Weld corners that share a position (grid `eps`) → { positions, index }. */
export function weld(soup, eps) {
  const inv = 1 / eps;
  const map = new Map();
  const positions = [];
  const index = new Uint32Array(soup.length / 3);
  for (let i = 0; i < index.length; i++) {
    const x = soup[i * 3], y = soup[i * 3 + 1], z = soup[i * 3 + 2];
    const key = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = positions.length / 3;
      map.set(key, id);
      positions.push(x, y, z);
    }
    index[i] = id;
  }
  return { positions: Float32Array.from(positions), index };
}

/** Connected components over shared vertices → per-triangle component id + component list. */
export function components(welded) {
  const { positions, index } = welded;
  const nv = positions.length / 3;
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (a) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const unite = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[a] = b;
  };
  const nt = index.length / 3;
  for (let t = 0; t < nt; t++) {
    unite(index[t * 3], index[t * 3 + 1]);
    unite(index[t * 3], index[t * 3 + 2]);
  }
  const compOf = new Map();
  const triComp = new Int32Array(nt);
  const comps = [];
  for (let t = 0; t < nt; t++) {
    const r = find(index[t * 3]);
    let c = compOf.get(r);
    if (c === undefined) {
      c = comps.length;
      compOf.set(r, c);
      comps.push({ id: c, tris: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], area: 0 });
    }
    triComp[t] = c;
    const comp = comps[c];
    comp.tris++;
    for (let k = 0; k < 3; k++) {
      const v = index[t * 3 + k];
      for (let a = 0; a < 3; a++) {
        const p = positions[v * 3 + a];
        if (p < comp.min[a]) comp.min[a] = p;
        if (p > comp.max[a]) comp.max[a] = p;
      }
    }
  }
  return { triComp, comps };
}
