/**
 * Measurements the runtime needs, read off the full-resolution split (car frame, metres): where the aero
 * surfaces are, the cockpit opening, and how much room the closed body skin leaves for a power unit.
 * The body is one watertight skin, so "inside the skin" is free space; crossing parity finds it.
 */
import { boundsOf } from './wings.mjs';

const median = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
const r3 = (v) => Math.round(v * 1000) / 1000;
const rv = (a) => a.map(r3);

/** Segments where the plane axis = value cuts the triangles `tris`, as 2D points on the two other axes (a, b). */
function slice({ positions, index }, tris, axis, value, [ua, va]) {
  const segs = [];
  for (const t of tris) {
    const pts = [];
    for (let k = 0; k < 3; k++) {
      const i = index[t * 3 + k] * 3, j = index[t * 3 + ((k + 1) % 3)] * 3;
      const d0 = positions[i + axis] - value, d1 = positions[j + axis] - value;
      if (d0 === d1 || d0 * d1 > 0) continue;
      const s = d0 / (d0 - d1);
      pts.push([positions[i + ua] + s * (positions[j + ua] - positions[i + ua]), positions[i + va] + s * (positions[j + va] - positions[i + va])]);
    }
    if (pts.length === 2) segs.push(pts);
  }
  return segs;
}

/** Group slice segments into connected chains (loops for closed sections) by shared end points. */
function chains(segs) {
  const key = (p) => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)}`;
  const at = new Map();
  segs.forEach((s, i) => s.forEach((p) => (at.get(key(p)) ?? at.set(key(p), []).get(key(p))).push(i)));
  const seen = new Uint8Array(segs.length);
  const out = [];
  for (let s = 0; s < segs.length; s++) {
    if (seen[s]) continue;
    const members = [s];
    seen[s] = 1;
    for (let i = 0; i < members.length; i++)
      for (const p of segs[members[i]]) for (const u of at.get(key(p))) if (!seen[u]) ((seen[u] = 1), members.push(u));
    out.push(members.flatMap((m) => segs[m]));
  }
  return out;
}

const bbox2 = (pts) => ({ min: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))], max: [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] });

/** Chord and top surface of the element that reaches furthest towards +x (`lead`) or −x, at span position z. */
function profileAt(mesh, tris, z, pick) {
  const loops = chains(slice(mesh, tris, 2, z, [0, 1])).map(bbox2).filter(pick);
  if (!loops.length) return null;
  const el = loops.reduce((a, b) => (b.max[0] > a.max[0] ? b : a));
  return { z, chordX: rv([el.min[0], el.max[0]]), midChordX: r3((el.min[0] + el.max[0]) / 2), topY: r3(el.max[1]), bottomY: r3(el.min[1]) };
}

/** Cells (keys "ix,iz") reachable from `start` through 4-neighbours that are in `set`. */
function floodFill(set, start) {
  const seen = new Set([start]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const [ix, iz] = queue[i].split(',').map(Number);
    for (const k of [`${ix + 1},${iz}`, `${ix - 1},${iz}`, `${ix},${iz + 1}`, `${ix},${iz - 1}`])
      if (set.has(k) && !seen.has(k)) (seen.add(k), queue.push(k));
  }
  return queue;
}

/** Highest surface of `tris` at each (x, z) cell of a 1 cm grid → Map "ix,iz" → y. */
function heightMap({ positions, index }, tris, cell = 0.01) {
  const top = new Map();
  for (const t of tris) {
    const v = [0, 1, 2].map((k) => index[t * 3 + k] * 3);
    const P = v.map((i) => [positions[i], positions[i + 1], positions[i + 2]]);
    const x0 = Math.floor(Math.min(...P.map((p) => p[0])) / cell), x1 = Math.ceil(Math.max(...P.map((p) => p[0])) / cell);
    const z0 = Math.floor(Math.min(...P.map((p) => p[2])) / cell), z1 = Math.ceil(Math.max(...P.map((p) => p[2])) / cell);
    const det = (P[1][2] - P[2][2]) * (P[0][0] - P[2][0]) + (P[2][0] - P[1][0]) * (P[0][2] - P[2][2]);
    if (Math.abs(det) < 1e-12) continue;
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const px = (ix + 0.5) * cell, pz = (iz + 0.5) * cell;
        const l0 = ((P[1][2] - P[2][2]) * (px - P[2][0]) + (P[2][0] - P[1][0]) * (pz - P[2][2])) / det;
        const l1 = ((P[2][2] - P[0][2]) * (px - P[2][0]) + (P[0][0] - P[2][0]) * (pz - P[2][2])) / det;
        const l2 = 1 - l0 - l1;
        if (l0 < 0 || l1 < 0 || l2 < 0) continue;
        const y = l0 * P[0][1] + l1 * P[1][1] + l2 * P[2][1];
        const k = `${ix},${iz}`;
        if (y > (top.get(k) ?? -Infinity)) top.set(k, y);
      }
  }
  return top;
}

/** Free space along x: at each station the interval inside the skin at z = 0 and how wide it stays. */
function clearance(mesh, tris, xs) {
  return xs.map((x) => {
    const segs = slice(mesh, tris, 0, x, [2, 1]); // (z, y)
    const crossings = [];
    for (const [a, b] of segs) if (a[0] * b[0] <= 0 && a[0] !== b[0]) crossings.push(a[1] + ((b[1] - a[1]) * -a[0]) / (b[0] - a[0]));
    crossings.sort((p, q) => p - q);
    let best = null;
    for (let i = 0; i + 1 < crossings.length; i += 2)
      if (!best || crossings[i + 1] - crossings[i] > best[1] - best[0]) best = [crossings[i], crossings[i + 1]];
    if (!best) return { x: r3(x), yLo: null };
    const halfWidthAt = (y) => {
      let hit = Infinity;
      for (const [a, b] of segs) if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) {
        const z = Math.abs(a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]));
        if (z > 1e-4) hit = Math.min(hit, z);
      }
      return hit;
    };
    const [lo, hi] = [best[0] + 0.03, best[1] - 0.03];
    const samples = Array.from({ length: 9 }, (_, i) => halfWidthAt(lo + ((hi - lo) * i) / 8));
    return { x: r3(x), yLo: r3(best[0]), yHi: r3(best[1]), halfWidthMid: r3(samples[4]), halfWidthMin: r3(Math.min(...samples.slice(2, 7))) };
  });
}

/**
 * @param mesh {positions, index}   @param byPart id → triangle list (full-resolution split)
 * @param bodyTris all triangles of the fused body shell (component 0)
 */
export function measure(mesh, byPart, bodyTris) {
  const all = Object.values(byPart).flat();
  const bounds = boundsOf(all, mesh.positions, mesh.index);
  const front = (z) => profileAt(mesh, byPart.frontWing, z, () => true);
  const rear = (z) => profileAt(mesh, byPart.rearWing, z, (b) => b.min[1] > 0.7);
  const bodyX = (x) => chains(slice(mesh, byPart.bodywork, 0, x, [2, 1]));
  const coverTop = Math.max(...bodyX(-0.15).flat().filter((p) => Math.abs(p[0]) > 0.14 && Math.abs(p[0]) < 0.34).map((p) => p[1]));
  const airbox = slice(mesh, byPart.bodywork, 0, -0.15, [2, 1]).flat().filter((p) => Math.abs(p[0]) < 0.12);
  // the flat plate outboard of the sidepod skirt (the floor label reaches up the skirt, so cap the height)
  const plate = slice(mesh, byPart.floor, 0, -0.15, [2, 1]).flat().filter((p) => Math.abs(p[0]) > 0.45 && Math.abs(p[0]) < 0.7 && p[1] < 0.115);

  // Cockpit opening: the tub's flat bowl, the cells whose top surface lies at the bowl level found mid-cockpit.
  const tub = heightMap(mesh, [...byPart.survivalCell, ...byPart.bodywork.filter((t) => mesh.positions[mesh.index[t * 3] * 3] > 0)]);
  const cells = [...tub].map(([k, y]) => [(+k.split(',')[0] + 0.5) * 0.01, (+k.split(',')[1] + 0.5) * 0.01, y]);
  const bowl = median(cells.filter(([x, z]) => x > 0.2 && x < 0.5 && Math.abs(z) < 0.1).map((c) => c[2]));
  const level = new Set([...tub].filter(([, y]) => Math.abs(y - bowl) < 0.03).map(([k]) => k));
  const open = floodFill(level, '36,0').map((k) => k.split(',').map((v) => (+v + 0.5) * 0.01));
  const ox = open.map((c) => c[0]), oz = open.map((c) => c[1]);
  const rim = Math.max(...cells.filter(([x, z]) => x > 0.1 && x < 0.9 && Math.abs(z) < 0.3).map((c) => c[2]));

  const stations = Array.from({ length: 21 }, (_, i) => -1.4 + i * 0.1);
  return {
    bounds: { min: rv(bounds.min), max: rv(bounds.max) },
    frontWingMainplane: { atCentre: front(0.002), atSpan: front(0.3) },
    rearWingMainplane: { atCentre: rear(0.002), atSpan: rear(0.3) },
    floorTopYAtXm015: r3(median(plate.map((p) => p[1]))),
    engineCoverTopYAtXm015: r3(coverTop),
    airboxTopYAtXm015: r3(Math.max(...airbox.map((p) => p[1]))),
    cockpitOpening: { centre: [r3((Math.min(...ox) + Math.max(...ox)) / 2), r3(bowl), 0], x: rv([Math.min(...ox), Math.max(...ox)]), halfWidthZ: r3(Math.max(...oz.map(Math.abs))), bowlY: r3(bowl), rimY: r3(rim) },
    bodyClearance: clearance(mesh, bodyTris, stations),
  };
}
