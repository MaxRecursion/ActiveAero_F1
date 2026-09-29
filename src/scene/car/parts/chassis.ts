/**
 * Survival cell (the carbon tub the driver sits in, with the fuel cell behind) and the nose.
 * The cockpit is a real opening: the top of each tub section dips into a well, so the helmet sits
 * *in* the car, and the well is tinted dark the way an open cockpit reads in a studio.
 */
import * as THREE from 'three';
import { linear, range } from '../geometry/curves';
import { loft, ring, roundEnd, sampleSections, sectionPoint, type Section } from '../geometry/loft';
import { CLAY_SHADOW_TINT, type PartMaterials } from '../materials';
import { PieceSet } from '../pieces';

/** Tub key sections, front bulkhead to engine mounting face. */
const TUB: Section[] = [
  { x: 1.56, yBot: 0.2, yTop: 0.55, wBot: 0.105, wTop: 0.118, n: 2.8 },
  { x: 1.2, yBot: 0.14, yTop: 0.615, wBot: 0.13, wTop: 0.165, n: 2.8 },
  { x: 0.85, yBot: 0.1, yTop: 0.648, wBot: 0.17, wTop: 0.21, n: 3 },
  { x: 0.5, yBot: 0.075, yTop: 0.665, wBot: 0.21, wTop: 0.25, n: 3.2 },
  { x: 0.1, yBot: 0.065, yTop: 0.672, wBot: 0.25, wTop: 0.27, n: 3.4 },
  { x: -0.3, yBot: 0.065, yTop: 0.672, wBot: 0.26, wTop: 0.265, n: 3.4 },
  { x: -0.78, yBot: 0.07, yTop: 0.62, wBot: 0.22, wTop: 0.19, n: 3 },
];

/** Nose key sections, tip to where it slides into the tub. Its underside rests on the front-wing mainplane. */
const NOSE: Section[] = [
  { x: 2.74, yBot: 0.1, yTop: 0.18, wBot: 0.05, wTop: 0.04, n: 2.4 },
  { x: 2.55, yBot: 0.1, yTop: 0.235, wBot: 0.07, wTop: 0.058, n: 2.5 },
  { x: 2.3, yBot: 0.112, yTop: 0.31, wBot: 0.085, wTop: 0.072, n: 2.6 },
  { x: 2.0, yBot: 0.14, yTop: 0.4, wBot: 0.098, wTop: 0.09, n: 2.7 },
  { x: 1.75, yBot: 0.168, yTop: 0.482, wBot: 0.108, wTop: 0.106, n: 2.8 },
  // The last two sections cross the tub's front bulkhead, so the join is a clean intersection.
  { x: 1.52, yBot: 0.19, yTop: 0.562, wBot: 0.115, wTop: 0.126, n: 2.8 },
  { x: 1.48, yBot: 0.2, yTop: 0.56, wBot: 0.108, wTop: 0.12, n: 2.8 },
];

/** Cockpit opening: rim half-width and well depth along x (0 depth = closed top). */
const RIM_HALF = linear([
  [0.62, 0.1],
  [0.57, 0.1],
  [0.545, 0.13],
  [0.47, 0.185],
  [0.3, 0.205],
  [-0.02, 0.21],
  [-0.09, 0.19],
  [-0.12, 0.15],
  [-0.14, 0.1],
]);
const WELL_DEPTH = linear([
  [0.57, 0],
  [0.545, 0.3],
  [0.47, 0.4],
  [-0.1, 0.4],
  [-0.12, 0.3],
  [-0.14, 0],
]);

/** Across-the-opening samples (fraction of rim half-width) from the right rim to the left rim. */
const WELL_U = [
  0.99, 0.965, 0.93, 0.88, 0.78, 0.6, 0.35, 0.12, -0.12, -0.35, -0.6, -0.78, -0.88, -0.93, -0.965, -0.99,
];
/** Well depth profile across the opening: steep walls, flat seat. */
const wellProfile = (u: number) => 1 - THREE.MathUtils.smoothstep(Math.abs(u), 0.86, 1);

const OUTER_POINTS = 44;

/** θ on the upper half of a section where the surface is at lateral offset z (bisection; z(θ) is monotonic). */
function thetaAtZ(s: Section, z: number): number {
  const p = new THREE.Vector3();
  let lo = 0;
  let hi = Math.PI / 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (sectionPoint(s, mid, p).z > z) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * One tub ring: the outer arc from the right rim, under the car, to the left rim, then the well
 * across the top. Every ring has the same point count whether or not the cockpit is open there.
 */
function tubRing(s: Section, rimHalf: number, depth: number): { points: THREE.Vector3[]; dark: boolean[] } {
  const thR = thetaAtZ(s, rimHalf);
  const points: THREE.Vector3[] = [];
  const dark: boolean[] = [];
  for (let i = 0; i < OUTER_POINTS; i++) {
    const t = i / (OUTER_POINTS - 1);
    points.push(sectionPoint(s, Math.PI - thR + t * (Math.PI + 2 * thR)));
    dark.push(false);
  }
  // points now run left rim → bottom → right rim; the well runs right → left.
  for (const u of WELL_U) {
    const zu = u * rimHalf;
    const th = zu >= 0 ? thetaAtZ(s, zu) : Math.PI - thetaAtZ(s, -zu);
    const p = sectionPoint(s, th);
    const drop = depth * wellProfile(u);
    p.y -= drop;
    points.push(p);
    dark.push(drop > 0.02);
  }
  return { points, dark };
}

export function buildSurvivalCell(mats: PartMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'survivalCell';
  const pieces = new PieceSet();

  // Stations: evenly spaced, plus dense ones where the cockpit walls rise.
  const xs = new Set<number>([
    ...range(1.56, -0.78, 34),
    0.57,
    0.555,
    0.545,
    0.53,
    -0.1,
    -0.12,
    -0.13,
    -0.14,
  ]);
  const stations = [...xs].sort((a, b) => b - a);
  const sections = sampleSections(TUB, stations);
  const rings = sections.map((s) => tubRing(s, RIM_HALF(s.x), WELL_DEPTH(s.x)));
  pieces.add(
    'clay',
    loft(
      rings.map((r) => r.points),
      { tint: (row, col) => (col >= 0 && rings[row].dark[col] ? CLAY_SHADOW_TINT : null) },
    ),
  );

  // Headrest: two padded bolsters either side of the helmet, part of the tub's safety structure.
  const pad: Section[] = [
    { x: 0.2, yBot: 0.6, yTop: 0.69, wBot: 0.04, wTop: 0.03, z: 0.178, n: 2.4 },
    { x: 0.0, yBot: 0.6, yTop: 0.72, wBot: 0.045, wTop: 0.036, z: 0.174, n: 2.6 },
    { x: -0.13, yBot: 0.6, yTop: 0.725, wBot: 0.045, wTop: 0.036, z: 0.17, n: 2.6 },
  ];
  const padSections = sampleSections(pad, range(0.2, -0.13, 8));
  const padRings = [
    ...roundEnd(padSections[0], 1, 0.05, 4).reverse(),
    ...padSections,
    ...roundEnd(padSections[padSections.length - 1], -1, 0.02, 3),
  ];
  pieces.addPair('clayDark', loft(padRings.map((s) => ring(s, 24))));

  pieces.build(group, mats);
  return group;
}

export function buildNose(mats: PartMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'nose';
  const body = sampleSections(NOSE, range(2.74, 1.48, 22));
  const tip = roundEnd(body[0], 1, 0.03, 5).reverse();
  const rings = [...tip, ...body].map((s) => ring(s, 40));
  new PieceSet().add('clay', loft(rings)).build(group, mats);
  return group;
}
