/**
 * Suspension: double wishbones, a push/pull rod to the inboard springs, a steering or toe link,
 * and the upright inside each wheel. Wishbone legs are faired (elliptic) because they sit in the
 * airflow. Each side is its own group so explode can spread the two sides apart.
 */
import * as THREE from 'three';
import { mirrorZ, roundedBox, strut } from '../geometry/primitives';
import { AXLE_X, TYRE, wheelZ } from '../dims';
import type { PartMaterials } from '../materials';
import { PieceSet } from '../pieces';

type V3 = THREE.Vector3Tuple;
const v = (p: V3) => new THREE.Vector3(...p);

interface Corner {
  upperFront: V3;
  upperRear: V3;
  upperOuter: V3;
  lowerFront: V3;
  lowerRear: V3;
  lowerOuter: V3;
  rod: [V3, V3];
  link: [V3, V3];
  /** Driveshaft (rear only). */
  shaft?: [V3, V3];
}

const fz = wheelZ(TYRE.front);
const rz = wheelZ(TYRE.rear);
const F = AXLE_X.front;
const R = AXLE_X.rear;

/** Right-side (+z) pick-up points. Front: pushrod to the top of the tub. */
const FRONT: Corner = {
  upperFront: [F + 0.2, 0.4, 0.08],
  upperRear: [F - 0.28, 0.45, 0.12],
  upperOuter: [F - 0.02, 0.5, fz - 0.15],
  lowerFront: [F + 0.26, 0.22, 0.07],
  lowerRear: [F - 0.32, 0.2, 0.14],
  lowerOuter: [F + 0.01, 0.2, fz - 0.13],
  rod: [
    [F - 0.02, 0.22, fz - 0.17],
    [F - 0.12, 0.5, 0.1],
  ],
  link: [
    [F + 0.12, 0.3, 0.08],
    [F + 0.13, 0.28, fz - 0.14],
  ],
};

/** Rear: pullrod from the top of the upright down to the gearbox. */
const REAR: Corner = {
  upperFront: [R + 0.3, 0.46, 0.14],
  upperRear: [R - 0.14, 0.45, 0.11],
  upperOuter: [R, 0.52, rz - 0.2],
  lowerFront: [R + 0.36, 0.17, 0.2],
  lowerRear: [R - 0.2, 0.2, 0.13],
  lowerOuter: [R + 0.01, 0.16, rz - 0.19],
  rod: [
    [R + 0.02, 0.5, rz - 0.22],
    [R + 0.12, 0.23, 0.14],
  ],
  link: [
    [R - 0.24, 0.3, 0.1],
    [R - 0.12, 0.3, rz - 0.2],
  ],
  shaft: [
    [R, TYRE.rear.radius, 0.1],
    [R, TYRE.rear.radius, rz - 0.2],
  ],
};

function cornerPieces(
  c: Corner,
  axleX: number,
  wheelZc: number,
  radius: number,
  pieces: PieceSet,
  side: 1 | -1,
): void {
  const add = (
    key: 'carbon' | 'metal' | 'carbonLight',
    g: THREE.BufferGeometry,
    crease: number | false = 50,
  ) => pieces.add(key, side === 1 ? g : swap(g), crease);
  const faired = (a: V3, b: V3) => strut(v(a), v(b), 0.013, 2.2);
  add('carbon', faired(c.upperFront, c.upperOuter));
  add('carbon', faired(c.upperRear, c.upperOuter));
  add('carbon', faired(c.lowerFront, c.lowerOuter));
  add('carbon', faired(c.lowerRear, c.lowerOuter));
  add('carbon', faired(...c.link));
  add('metal', strut(v(c.rod[0]), v(c.rod[1]), 0.011));
  if (c.shaft) add('metal', strut(v(c.shaft[0]), v(c.shaft[1]), 0.022, 1, 14));
  // Upright, its outer half tucked inside the rim.
  add('carbonLight', roundedBox([0.1, radius, 0.07], [axleX, radius, wheelZc - 0.14], 0.025, 2), false);
}

function swap(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = mirrorZ(g);
  g.dispose();
  return m;
}

export interface SuspensionBuild {
  group: THREE.Group;
  /** Right (+z) and left (-z) halves, spread apart by explode. */
  sides: [right: THREE.Group, left: THREE.Group];
}

export function buildSuspension(mats: PartMaterials, axle: 'front' | 'rear'): SuspensionBuild {
  const group = new THREE.Group();
  group.name = axle === 'front' ? 'suspensionFront' : 'suspensionRear';
  const corner = axle === 'front' ? FRONT : REAR;
  const sides = ([1, -1] as const).map((side) => {
    const half = new THREE.Group();
    half.name = `${group.name}:${side === 1 ? 'right' : 'left'}`;
    const pieces = new PieceSet();
    cornerPieces(corner, AXLE_X[axle], wheelZ(TYRE[axle]), TYRE[axle].radius, pieces, side);
    pieces.build(half, mats);
    group.add(half);
    return half;
  }) as [THREE.Group, THREE.Group];
  return { group, sides };
}
