/**
 * Bodywork: sidepods, engine cover and the airbox above the driver's head. The sidepods show the
 * current design language — a high inlet, a deep undercut above the floor, and a top surface that
 * ramps down toward the rear so air is pushed onto the floor and the diffuser.
 */
import * as THREE from 'three';
import { range } from '../geometry/curves';
import { loft, mouth, ring, roundEnd, sampleSections, type Section } from '../geometry/loft';
import { plateXY, roundedBox, shape, strut } from '../geometry/primitives';
import { CLAY_SHADOW_TINT, type PartMaterials } from '../materials';
import { PieceSet } from '../pieces';

/** Right sidepod (z > 0), inlet to where it tucks into the engine cover. */
const SIDEPOD: Section[] = [
  { x: 0.42, z: 0.5, yBot: 0.4, yTop: 0.6, wBot: 0.14, wTop: 0.17, n: 4.4, bias: 0.8 },
  { x: 0.2, z: 0.48, yBot: 0.24, yTop: 0.622, wBot: 0.09, wTop: 0.23, n: 4.4, bias: 0.4 },
  { x: -0.2, z: 0.45, yBot: 0.1, yTop: 0.595, wBot: 0.11, wTop: 0.24, n: 4, bias: 0.42 },
  { x: -0.6, z: 0.39, yBot: 0.072, yTop: 0.52, wBot: 0.14, wTop: 0.21, n: 3.4, bias: 0.55 },
  { x: -1.0, z: 0.31, yBot: 0.072, yTop: 0.44, wBot: 0.16, wTop: 0.16, n: 2.9 },
  { x: -1.35, z: 0.22, yBot: 0.085, yTop: 0.37, wBot: 0.12, wTop: 0.1, n: 2.6 },
  { x: -1.55, z: 0.16, yBot: 0.11, yTop: 0.32, wBot: 0.07, wTop: 0.06, n: 2.6 },
];

/** Engine cover from the airbox inlet back over the gearbox. */
const COVER: Section[] = [
  { x: -0.12, yBot: 0.75, yTop: 0.93, wBot: 0.085, wTop: 0.06, n: 2.3, bias: 1 },
  { x: -0.24, yBot: 0.6, yTop: 0.952, wBot: 0.15, wTop: 0.08, n: 2.6, bias: 1.4 },
  { x: -0.42, yBot: 0.36, yTop: 0.945, wBot: 0.22, wTop: 0.085, n: 2.8, bias: 1.6 },
  { x: -0.75, yBot: 0.14, yTop: 0.86, wBot: 0.27, wTop: 0.085, n: 2.8, bias: 1.8 },
  { x: -1.1, yBot: 0.13, yTop: 0.72, wBot: 0.25, wTop: 0.08, n: 2.8, bias: 1.8 },
  { x: -1.5, yBot: 0.15, yTop: 0.56, wBot: 0.19, wTop: 0.07, n: 2.7, bias: 1.6 },
  { x: -1.85, yBot: 0.21, yTop: 0.45, wBot: 0.12, wTop: 0.06, n: 2.6, bias: 1.3 },
  { x: -2.0, yBot: 0.27, yTop: 0.41, wBot: 0.075, wTop: 0.045, n: 2.5 },
];

const RING = 48;

/** Height of the engine cover's top at `x` (where the floor arrow enters the car). */
export const engineCoverTop = (x: number): number => sampleSections(COVER, [x])[0].yTop;

/** Loft a body that opens with an intake at its first key section. */
function intakeBody(keys: Section[], xs: number[], depth: number, tailLength: number): THREE.BufferGeometry {
  const body = sampleSections(keys, xs);
  const m = mouth(body[0], depth);
  const all = [...m.sections, ...body.slice(1), ...roundEnd(body[body.length - 1], -1, tailLength, 4)];
  return loft(
    all.map((s) => ring(s, RING)),
    { tint: (row) => (row < m.inside ? CLAY_SHADOW_TINT : null) },
  );
}

export function buildBodywork(mats: PartMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'bodywork';
  const pieces = new PieceSet();

  pieces.addPair('clay', intakeBody(SIDEPOD, range(0.42, -1.55, 26), 0.14, 0.06));
  pieces.add('clay', intakeBody(COVER, range(-0.12, -2.0, 26), 0.1, 0.05));

  // A small fin along the spine of the engine cover (steadies the car in yaw).
  const fin = shape(
    [
      [-0.5, 0.9],
      [-0.6, 0.962],
      [-1.35, 0.74],
      [-1.35, 0.62],
      [-0.5, 0.82],
    ],
    0.02,
  );
  pieces.add('clay', plateXY(fin, 0, 0.012), 30);

  // Mirrors on short stalks above the sidepod inlets.
  pieces.addPair('carbon', roundedBox([0.06, 0.06, 0.14], [0.43, 0.69, 0.46], 0.018, 3), false);
  pieces.addPair(
    'carbon',
    strut(new THREE.Vector3(0.41, 0.6, 0.3), new THREE.Vector3(0.43, 0.68, 0.41), 0.011, 2),
  );

  pieces.build(group, mats);
  return group;
}
