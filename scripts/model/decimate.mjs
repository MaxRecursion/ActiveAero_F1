/** Per-part decimation with meshoptimizer, keeping the seams between parts where they are. */
import { MeshoptSimplifier } from 'meshoptimizer';
import { compact, vertexNormals } from './mesh.mjs';

await MeshoptSimplifier.ready;

/**
 * Vertices that touch triangles of more than one part: these must not move, or gaps open between parts
 * (and the flaps, which turn about their own seams). → Uint8Array over the global vertices.
 */
export function seamVertices(index, labels, vertexCount) {
  const first = new Int16Array(vertexCount).fill(-1);
  const seam = new Uint8Array(first.length);
  for (let t = 0; t < labels.length; t++)
    for (let k = 0; k < 3; k++) {
      const v = index[t * 3 + k];
      if (first[v] < 0) first[v] = labels[t];
      else if (first[v] !== labels[t]) seam[v] = 1;
    }
  return seam;
}

/**
 * Simplify one part to at most `targetTris` triangles, stopping early where that would move the surface by
 * more than `maxError` metres (so thin sheets and tubes keep their shape and the budget is a ceiling).
 * Vertex normals ride along as attributes so the two faces of a thin wing sheet do not collapse into each other.
 * `lock` (per mesh vertex) pins the seam vertices. → { positions, index, error } with error in metres.
 */
export function decimate({ positions, index, lock }, targetTris, maxError) {
  if (index.length / 3 <= targetTris) return { positions, index, error: 0 };
  const [simplified, error] = MeshoptSimplifier.simplifyWithAttributes(
    index, positions, 3, vertexNormals(positions, index), 3, [1, 1, 1],
    lock, targetTris * 3, maxError, ['ErrorAbsolute'],
  );
  return { ...compact(positions, simplified), error };
}
