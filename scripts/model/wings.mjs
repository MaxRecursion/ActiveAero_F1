/**
 * Wing elements are separate solids that the STL export welded only through end plates and pylons, whose
 * faces stand across the span (normal ≈ ±z) while the elements' surfaces face up or down. Dropping the
 * across-span faces therefore leaves one connected piece per element; the pieces chosen by `pick` become the
 * active flap, and the flap then reclaims the dropped faces whose corners all lie on it (its own tip caps).
 */

const ACROSS_SPAN = 0.5; // |n.z| at or above this is an end-plate / pylon face

/** Connected pieces (≥ minTris) of `part` triangles with |n.z| below the cut, with their vertex bounds. */
function elementPieces(part, { labels, adj, normal, positions, index }, minTris) {
  const nt = labels.length;
  const seen = new Uint8Array(nt);
  const usable = (t) => labels[t] === part && Math.abs(normal[t * 3 + 2]) < ACROSS_SPAN;
  const pieces = [];
  for (let s = 0; s < nt; s++) {
    if (seen[s] || !usable(s)) continue;
    const tris = [s];
    seen[s] = 1;
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      for (let j = adj.start[t]; j < adj.start[t + 1]; j++) {
        const u = adj.list[j];
        if (!seen[u] && usable(u)) {
          seen[u] = 1;
          tris.push(u);
        }
      }
    }
    if (tris.length >= minTris) pieces.push({ tris, bounds: boundsOf(tris, positions, index) });
  }
  return pieces;
}

export function boundsOf(tris, positions, index) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris)
    for (let k = 0; k < 3; k++) {
      const v = index[t * 3 + k] * 3;
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], positions[v + a]);
        max[a] = Math.max(max[a], positions[v + a]);
      }
    }
  return { min, max };
}

/**
 * Relabel the pieces of `part` accepted by `pick(bounds, triCount)` as `flap`. Returns the flap's triangles.
 * `mesh` = { labels, adj, normal, positions, index }.
 */
export function splitFlap(part, flap, mesh, pick, minTris = 5000) {
  const { labels } = mesh;
  const flapTris = [];
  for (const piece of elementPieces(part, mesh, minTris))
    if (pick(piece.bounds, piece.tris.length)) for (const t of piece.tris) flapTris.push(t);
  for (const t of flapTris) labels[t] = flap;
  const onFlap = new Set();
  for (const t of flapTris) for (let k = 0; k < 3; k++) onFlap.add(mesh.index[t * 3 + k]);
  for (let t = 0; t < labels.length; t++)
    if (labels[t] === part && [0, 1, 2].every((k) => onFlap.has(mesh.index[t * 3 + k]))) {
      labels[t] = flap;
      flapTris.push(t);
    }
  return flapTris;
}

/**
 * Hinge line across the span at `chordFrac` of the flap chord back from its leading edge (max x), at the mean
 * height of the flap's vertices there. `dir` = +1 gives the axis a→b along +z, -1 along -z.
 * Rotating by a positive angle about a→b: +z axis turns the trailing edge (−x) downward, −z turns it up.
 */
export function hingeAcross(tris, { positions, index }, chordFrac, dir) {
  const { min, max } = boundsOf(tris, positions, index);
  const x = max[0] - chordFrac * (max[0] - min[0]);
  let sum = 0, n = 0;
  for (const t of tris)
    for (let k = 0; k < 3; k++) {
      const v = index[t * 3 + k] * 3;
      if (Math.abs(positions[v] - x) < 0.01) (sum += positions[v + 1]), n++;
    }
  const y = n ? sum / n : (min[1] + max[1]) / 2;
  const z = Math.max(max[2], -min[2]);
  const r = (v) => Math.round(v * 1e4) / 1e4;
  return { a: [r(x), r(y), r(-dir * z)], b: [r(x), r(y), r(dir * z)] };
}
