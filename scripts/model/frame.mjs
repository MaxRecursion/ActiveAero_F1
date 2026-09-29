/**
 * Source → car frame. The download is millimetres, Y up, car pointing −X, axle midpoint x = 1645 mm,
 * tyre bottoms at y = −30.8 mm. Ours is metres, +X forward, ground y = 0, symmetric about z = 0
 * (a 180° turn about Y plus a shift, so triangle winding is preserved).
 */
import { components, readSoup, weld } from './components.mjs';

export const SOURCE = 'models/source/f1_2026_concept_polygon_model.glb';
/** Corners closer than this (mm) are one vertex — the export is STL, so nothing is shared until welded. */
const WELD_MM = 0.01;

export const toCarFrame = (x, y, z) => [-x * 0.001 + 1.645, y * 0.001 + 0.0308, -z * 0.001];

/** → { positions (car frame, m), index, triComp, comps } with the source's connected components. */
export async function loadCar(file = SOURCE) {
  const soup = await readSoup(file);
  const welded = weld(soup, WELD_MM);
  const { triComp, comps } = components(welded);
  const p = welded.positions;
  for (let i = 0; i < p.length; i += 3) {
    const [x, y, z] = toCarFrame(p[i], p[i + 1], p[i + 2]);
    p[i] = x;
    p[i + 1] = y;
    p[i + 2] = z;
  }
  // Bounds in the new frame (component bounds were measured in source units).
  for (const c of comps) {
    c.min = [Infinity, Infinity, Infinity];
    c.max = [-Infinity, -Infinity, -Infinity];
  }
  const { index } = welded;
  for (let t = 0; t < triComp.length; t++) {
    const c = comps[triComp[t]];
    for (let k = 0; k < 3; k++)
      for (let a = 0; a < 3; a++) {
        const v = p[index[t * 3 + k] * 3 + a];
        if (v < c.min[a]) c.min[a] = v;
        if (v > c.max[a]) c.max[a] = v;
      }
  }
  return { positions: p, index, triComp, comps };
}
