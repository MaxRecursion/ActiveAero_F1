/** Indexed-triangle-mesh helpers for the model pipeline: adjacency, island clean-up, creased normals. */

/** Per-triangle centroid (x,y,z interleaved) and unit normal. */
export function triangleData(positions, index) {
  const nt = index.length / 3;
  const centroid = new Float32Array(nt * 3);
  const normal = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = index[t * 3] * 3, b = index[t * 3 + 1] * 3, c = index[t * 3 + 2] * 3;
    for (let k = 0; k < 3; k++) centroid[t * 3 + k] = (positions[a + k] + positions[b + k] + positions[c + k]) / 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    normal[t * 3] = nx / l;
    normal[t * 3 + 1] = ny / l;
    normal[t * 3 + 2] = nz / l;
  }
  return { centroid, normal };
}

/** Triangle neighbours across shared edges → CSR { start, list }. Non-manifold edges link every pair. */
export function edgeAdjacency(index, vertexCount) {
  const nt = index.length / 3;
  const edges = new Map();
  for (let t = 0; t < nt; t++)
    for (let k = 0; k < 3; k++) {
      const a = index[t * 3 + k], b = index[t * 3 + ((k + 1) % 3)];
      const key = a < b ? a * vertexCount + b : b * vertexCount + a;
      const e = edges.get(key);
      if (e === undefined) edges.set(key, t);
      else if (typeof e === 'number') edges.set(key, [e, t]);
      else e.push(t);
    }
  const count = new Uint32Array(nt + 1);
  for (const e of edges.values())
    if (typeof e !== 'number') for (const t of e) count[t + 1] += e.length - 1;
  for (let t = 0; t < nt; t++) count[t + 1] += count[t];
  const list = new Uint32Array(count[nt]);
  const fill = count.slice(0, nt);
  for (const e of edges.values())
    if (typeof e !== 'number') for (const t of e) for (const u of e) if (u !== t) list[fill[t]++] = u;
  return { start: count, list };
}

/**
 * Connected regions of equal label over `adj`; regions smaller than `minTris` (and not in `keep`) take the
 * label they share the most edges with. Repeats so that chains of islands resolve. Returns the number relabelled.
 */
export function absorbIslands(labels, adj, minTris, keep = new Set()) {
  const nt = labels.length;
  let changed = 0;
  for (let pass = 0; pass < 4; pass++) {
    const region = new Int32Array(nt).fill(-1);
    const regions = [];
    for (let s = 0; s < nt; s++) {
      if (region[s] >= 0) continue;
      const id = regions.length;
      const members = [s];
      region[s] = id;
      for (let i = 0; i < members.length; i++) {
        const t = members[i];
        for (let j = adj.start[t]; j < adj.start[t + 1]; j++) {
          const u = adj.list[j];
          if (region[u] < 0 && labels[u] === labels[s]) {
            region[u] = id;
            members.push(u);
          }
        }
      }
      regions.push(members);
    }
    let passChanged = 0;
    for (const members of regions) {
      const label = labels[members[0]];
      if (members.length >= minTris || keep.has(label)) continue;
      const votes = new Map();
      for (const t of members)
        for (let j = adj.start[t]; j < adj.start[t + 1]; j++) {
          const l = labels[adj.list[j]];
          if (l !== label) votes.set(l, (votes.get(l) ?? 0) + 1);
        }
      let best = -1, bestVotes = 0;
      for (const [l, v] of votes) if (v > bestVotes) [best, bestVotes] = [l, v];
      if (best < 0) continue;
      for (const t of members) labels[t] = best;
      passChanged += members.length;
    }
    changed += passChanged;
    if (passChanged === 0) break;
  }
  return changed;
}

/**
 * Region rules classify sliver triangles by centroid, leaving a fringe along every boundary. Any triangle
 * with no neighbour of its own label whose neighbours agree on another one takes that label.
 * `skip` labels are neither changed nor spread. Returns the number relabelled.
 */
export function smoothLabels(labels, adj, skip = new Set(), passes = 3) {
  let changed = 0;
  for (let pass = 0; pass < passes; pass++) {
    const next = labels.slice();
    let n = 0;
    for (let t = 0; t < labels.length; t++) {
      const own = labels[t];
      if (skip.has(own)) continue;
      const votes = new Map();
      for (let j = adj.start[t]; j < adj.start[t + 1]; j++) {
        const l = labels[adj.list[j]];
        if (skip.has(l)) continue;
        votes.set(l, (votes.get(l) ?? 0) + 1);
      }
      const total = adj.start[t + 1] - adj.start[t];
      let best = own, bestVotes = votes.get(own) ?? 0;
      for (const [l, v] of votes) if (v > bestVotes && v >= 2 && v * 2 > total) [best, bestVotes] = [l, v];
      if (best !== own) {
        next[t] = best;
        n++;
      }
    }
    labels.set(next);
    changed += n;
    if (n === 0) break;
  }
  return changed;
}

/**
 * Smooth normals that stop at creases: at each vertex the incident faces are grouped by angle (faces within
 * `creaseDeg` of a group's first face share a normal, corner-angle weighted) and each group becomes its own vertex.
 * → { positions, normals, index } with duplicated vertices only where the surface bends sharply.
 */
export function creaseNormals(positions, index, creaseDeg) {
  const nv = positions.length / 3;
  const nt = index.length / 3;
  const cosLimit = Math.cos((creaseDeg * Math.PI) / 180);
  const { normal: fn } = triangleData(positions, index);
  const start = new Uint32Array(nv + 1);
  for (let i = 0; i < index.length; i++) start[index[i] + 1]++;
  for (let v = 0; v < nv; v++) start[v + 1] += start[v];
  const slot = start.slice(0, nv);
  const corner = new Uint32Array(index.length); // corner ids (t*3+k) grouped by vertex
  for (let c = 0; c < index.length; c++) corner[slot[index[c]]++] = c;

  const outPos = [], outNrm = [];
  const outIndex = new Uint32Array(index.length);
  const cornerAngle = (c) => {
    const t = (c / 3) | 0, k = c % 3;
    const v = index[c] * 3, a = index[t * 3 + ((k + 1) % 3)] * 3, b = index[t * 3 + ((k + 2) % 3)] * 3;
    const ax = positions[a] - positions[v], ay = positions[a + 1] - positions[v + 1], az = positions[a + 2] - positions[v + 2];
    const bx = positions[b] - positions[v], by = positions[b + 1] - positions[v + 1], bz = positions[b + 2] - positions[v + 2];
    const d = (ax * bx + ay * by + az * bz) / ((Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz)) || 1);
    return Math.acos(Math.max(-1, Math.min(1, d)));
  };
  for (let v = 0; v < nv; v++) {
    const groups = []; // { seed: face, sum: [x,y,z], corners: [] }
    for (let i = start[v]; i < start[v + 1]; i++) {
      const c = corner[i], t = (c / 3) | 0;
      let g = groups.find((q) => fn[q.seed * 3] * fn[t * 3] + fn[q.seed * 3 + 1] * fn[t * 3 + 1] + fn[q.seed * 3 + 2] * fn[t * 3 + 2] >= cosLimit);
      if (!g) groups.push((g = { seed: t, sum: [0, 0, 0], corners: [] }));
      const w = cornerAngle(c);
      for (let k = 0; k < 3; k++) g.sum[k] += fn[t * 3 + k] * w;
      g.corners.push(c);
    }
    for (const g of groups) {
      const id = outPos.length / 3;
      outPos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
      const l = Math.hypot(...g.sum) || 1;
      outNrm.push(g.sum[0] / l, g.sum[1] / l, g.sum[2] / l);
      for (const c of g.corners) outIndex[c] = id;
    }
  }
  return { positions: Float32Array.from(outPos), normals: Float32Array.from(outNrm), index: outIndex };
}

/**
 * Renumber the vertices an index buffer uses into a compact mesh.
 * → { positions, index, source } where source[i] is the input vertex that became vertex i.
 */
export function compact(positions, index) {
  const map = new Map();
  const source = [];
  const outIndex = new Uint32Array(index.length);
  for (let i = 0; i < index.length; i++) {
    let id = map.get(index[i]);
    if (id === undefined) {
      id = source.length;
      map.set(index[i], id);
      source.push(index[i]);
    }
    outIndex[i] = id;
  }
  const outPos = new Float32Array(source.length * 3);
  source.forEach((v, i) => outPos.set(positions.subarray(v * 3, v * 3 + 3), i * 3));
  return { positions: outPos, index: outIndex, source: Uint32Array.from(source) };
}

/** The triangles `tris` of an indexed mesh as a compact mesh (see `compact`). */
export function subMesh(positions, index, tris) {
  const picked = new Uint32Array(tris.length * 3);
  tris.forEach((t, i) => picked.set(index.subarray(t * 3, t * 3 + 3), i * 3));
  return compact(positions, picked);
}

/** Area-weighted smooth vertex normals (feature-blind: only a hint for the simplifier's error metric). */
export function vertexNormals(positions, index) {
  const n = new Float32Array(positions.length);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) (n[v] += nx), (n[v + 1] += ny), (n[v + 2] += nz);
  }
  for (let v = 0; v < n.length; v += 3) {
    const l = Math.hypot(n[v], n[v + 1], n[v + 2]) || 1;
    n[v] /= l;
    n[v + 1] /= l;
    n[v + 2] /= l;
  }
  return n;
}
