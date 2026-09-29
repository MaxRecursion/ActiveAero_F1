#!/usr/bin/env node
/**
 * Source download → public/models/car.glb: the 2026 concept car split into named parts in the car frame.
 *   npm run model                 full pipeline (split → decimate → creased normals → meshopt)
 *   npm run model -- --debug      also write scripts/model/.out/car-debug.glb (full resolution, split only)
 *   npm run model -- --debug-only stop after the debug export (fast; for tuning the part rules)
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { loadCar } from './frame.mjs';
import { absorbIslands, creaseNormals, edgeAdjacency, smoothLabels, subMesh, triangleData } from './mesh.mjs';
import { decimate, seamVertices } from './decimate.mjs';
import { boundsOf, hingeAcross, splitFlap } from './wings.mjs';
import { PART_IDS, PART_INDEX as P, classifyBody } from './parts.mjs';
import { buildDocument, compressDocument, writeGlb } from './glb.mjs';
import { measure } from './measure.mjs';

const argv = process.argv.slice(2);
const DEBUG = argv.includes('--debug') || argv.includes('--debug-only');
const DEBUG_ONLY = argv.includes('--debug-only');
const OUT_DIR = new URL('./.out/', import.meta.url).pathname;
const t0 = performance.now();
const log = (msg) => console.log(`[model ${((performance.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

const car = await loadCar();
const { positions, index, triComp, comps } = car;
const nt = triComp.length;
log(`loaded ${nt} triangles, ${comps.length} components`);

// ── 1. label every triangle ──────────────────────────────────────────────────────
const NONE = 255;
const labels = new Uint8Array(nt).fill(NONE);
const compLabel = new Int16Array(comps.length).fill(-1);
comps.forEach((c, i) => {
  const size = c.max.map((m, k) => m - c.min[k]);
  const midZ = (c.min[2] + c.max[2]) / 2;
  if (Math.max(...size) < 1e-3) compLabel[i] = NONE; // degenerate speck
  else if (Math.abs(size[0] - 0.719) < 0.01 && Math.abs(size[1] - 0.719) < 0.01) {
    const front = (c.min[0] + c.max[0]) / 2 > 0;
    compLabel[i] = P[`wheel${front ? 'F' : 'R'}${midZ > 0 ? 'R' : 'L'}`];
  } else if (c.tris < 500) compLabel[i] = P.survivalCell; // mirrors
  else if (c.tris < 50000) compLabel[i] = P.rearStructure;
});
const { centroid, normal } = triangleData(positions, index);
for (let t = 0; t < nt; t++) {
  const l = compLabel[triComp[t]];
  labels[t] = l >= 0 ? l : classifyBody(centroid[t * 3], centroid[t * 3 + 1], Math.abs(centroid[t * 3 + 2]));
}
log('region rules applied');

const adj = edgeAdjacency(index, positions.length / 3);
const FIXED = new Set([P.wheelFL, P.wheelFR, P.wheelRL, P.wheelRR, P.rearStructure, NONE]);
const smoothed = smoothLabels(labels, adj, FIXED);
const moved = absorbIslands(labels, adj, 300, FIXED);
log(`fringe smoothed: ${smoothed} triangles, islands absorbed: ${moved} triangles`);


// ── 2. wing flaps ────────────────────────────────────────────────────────────────
const mesh = { labels, adj, normal, positions, index };
// Front: the two upper elements behind the mainplane (whose leading edge reaches x = 2.94).
const frontFlapTris = splitFlap(P.frontWing, P.frontWingFlaps, mesh, (b, n) => b.max[0] < 2.8 && n > 10000);
// Rear: the topmost element, the one that opens like DRS (mainplane, second element and pillar stay).
const rearFlapTris = splitFlap(P.rearWing, P.rearWingFlap, mesh, (b) => b.min[0] < -2.3 && b.min[1] > 0.8);
log(`flaps: front ${frontFlapTris.length} tris, rear ${rearFlapTris.length} tris`);

// ── 3. export ────────────────────────────────────────────────────────────────────
function splitParts(labelOf) {
  const byPart = PART_IDS.map(() => []);
  for (let t = 0; t < nt; t++) if (labelOf[t] !== NONE) byPart[labelOf[t]].push(t);
  return PART_IDS.map((id, i) => ({ id, tris: byPart[i] })).filter((p) => p.tris.length > 0);
}
const parts = splitParts(labels);
log(`parts: ${parts.map((p) => `${p.id} ${p.tris.length}`).join(', ')}`);
if (DEBUG) {
  mkdirSync(OUT_DIR, { recursive: true });
  const debugParts = parts.map((p) => {
    const m = subMesh(positions, index, p.tris);
    return { id: p.id, ...creaseNormals(m.positions, m.index, 35) };
  });
  await writeGlb(buildDocument(debugParts), `${OUT_DIR}car-debug.glb`);
  log('debug export written');
  if (DEBUG_ONLY) process.exit(0);
}

// ── 4. measurements (full resolution) ───────────────────────────────────────────
const byPart = Object.fromEntries(parts.map((p) => [p.id, p.tris]));
const bodyTris = [];
for (let t = 0; t < nt; t++) if (triComp[t] === 0) bodyTris.push(t);
const measured = measure({ positions, index }, byPart, bodyTris);

// ── 5. extras: wheel centres, flap hinges ────────────────────────────────────────
const extras = {};
comps.forEach((c, i) => {
  const id = PART_IDS[compLabel[i]];
  if (!id?.startsWith('wheel')) return;
  const r = (v) => Math.round(v * 1e4) / 1e4;
  extras[id] = { centre: c.min.map((m, k) => r((m + c.max[k]) / 2)), radius: r((c.max[1] - c.min[1]) / 2), width: r(c.max[2] - c.min[2]) };
});
// Front: turning the trailing edge down (about +z) reduces the wing's incidence. Rear: turning it up (about −z) opens the slot like DRS.
extras.frontWingFlaps = { hinge: { ...hingeAcross(frontFlapTris, mesh, 0.3, +1), openDeg: 8 } };
extras.rearWingFlap = { hinge: { ...hingeAcross(rearFlapTris, mesh, 0.1, -1), openDeg: 45 } };

// ── 6. decimate, crease-shade, compress ──────────────────────────────────────────
// Triangle ceiling and the most a part's surface may move (metres): the ceiling binds on smooth parts,
// the error bound on thin sheets and tubes.
const BUDGET = {
  wheelFL: [7000, 0.005], wheelFR: [7000, 0.005], wheelRL: [8000, 0.005], wheelRR: [8000, 0.005],
  frontWing: [26000, 0.0007], frontWingFlaps: [16000, 0.0005], rearWing: [18000, 0.0007], rearWingFlap: [6000, 0.0004],
  nose: [8000, 0.002], survivalCell: [10000, 0.0015], halo: [6000, 0.0006], bodywork: [28000, 0.002], floor: [22000, 0.003],
  suspensionFront: [12000, 0.0008], suspensionRear: [10000, 0.0008], rearStructure: [2000, 0.002],
};
const seam = seamVertices(index, labels, positions.length / 3);
const finalParts = parts.map((p) => {
  const m = subMesh(positions, index, p.tris);
  const lock = Uint8Array.from(m.source, (v) => seam[v]);
  const d = decimate({ positions: m.positions, index: m.index, lock }, ...BUDGET[p.id]);
  const shaded = creaseNormals(d.positions, d.index, 35);
  log(`${p.id.padEnd(16)} ${String(p.tris.length).padStart(7)} -> ${String(d.index.length / 3).padStart(6)} tris, error ${(d.error * 1000).toFixed(2)} mm`);
  return { id: p.id, ...shaded, extras: extras[p.id] };
});
const total = finalParts.reduce((n, p) => n + p.index.length / 3, 0);
const doc = buildDocument(finalParts, { unseen: { source: 'F1 2026 concept (polygon model), Qvist_designs, CC BY 4.0', measured } });
const io = await compressDocument(doc);
mkdirSync(new URL('../../public/models/', import.meta.url).pathname, { recursive: true });
const OUT = new URL('../../public/models/car.glb', import.meta.url).pathname;
await writeGlb(doc, OUT, io);
log(`wrote ${OUT}: ${total} triangles, ${(statSync(OUT).size / 1e6).toFixed(2)} MB`);
writeFileSync(`${OUT_DIR}measured.json`, JSON.stringify(measured, null, 1));
