/**
 * Floor: since 2022 the floor makes most of the downforce. Its underside is shaped into two Venturi
 * tunnels — raised inlets behind the front wheels, a low throat under the car, then the diffuser
 * ramping up at the rear — so air under the car speeds up and its pressure drops.
 * Built as one board whose underside height varies along and across the car.
 */
import * as THREE from 'three';
import { range, smooth } from '../geometry/curves';
import { loft } from '../geometry/loft';
import { plateXY, roundedBox, shape, type P2 } from '../geometry/primitives';
import { FLOOR_Y } from '../dims';
import type { PartMaterials } from '../materials';
import { PieceSet } from '../pieces';

const FLOOR_X = { front: 1.38, exit: -1.95 } as const;
const THICKNESS = FLOOR_Y.top - FLOOR_Y.bottom;

/** Planform half-width: widest between the axles, pinched in ahead of the rear tyres. */
const halfWidth = smooth([
  [1.38, 0.42],
  [1.2, 0.62],
  [0.95, 0.79],
  [0.7, 0.825],
  [-0.85, 0.825],
  [-1.1, 0.74],
  [-1.3, 0.56],
  [-1.5, 0.525],
  [-1.95, 0.52],
]);

/** Tunnel roof rise at the inlets (drops to the throat under the cockpit). */
const inletRise = smooth([
  [1.38, 0.15],
  [1.15, 0.11],
  [0.9, 0.06],
  [0.55, 0.012],
  [0.3, 0],
]);

/** Diffuser ramp: the underside lifts toward the exit so the tunnel flow can slow and recover pressure. */
const diffuserRise = smooth([
  [-1.2, 0],
  [-1.5, 0.04],
  [-1.75, 0.11],
  [-1.95, 0.19],
]);

/** How much of the tunnel shape applies at |z|: none on the centre plank, none on the outer edge. */
function tunnelMask(az: number): number {
  return THREE.MathUtils.smoothstep(az, 0.14, 0.3) * (1 - THREE.MathUtils.smoothstep(az, 0.72, 0.8));
}

/** Underside height of the floor at (x, z). */
export function floorUnderside(x: number, z: number): number {
  return FLOOR_Y.bottom + inletRise(x) * tunnelMask(Math.abs(z)) + diffuserRise(x);
}

const ACROSS = 44;

/** One cross-section ring: across the top from +z to -z, then back along the underside. */
function floorRing(x: number): THREE.Vector3[] {
  const w = halfWidth(x);
  const zs = range(w, -w, ACROSS);
  const top = zs.map((z) => new THREE.Vector3(x, floorUnderside(x, z) + THICKNESS, z));
  const bottom = [...zs].reverse().map((z) => new THREE.Vector3(x, floorUnderside(x, z), z));
  return [...top, ...bottom];
}

/** A vertical fence from the plank line up into the floor underside, following the tunnel roof. */
function fence(z: number, x0: number, x1: number): THREE.BufferGeometry {
  const xs = range(x0, x1, 14);
  const pts: P2[] = [
    ...xs.map((x): P2 => [x, floorUnderside(x, z) + 0.006]),
    ...[...xs].reverse().map((x): P2 => [x, FLOOR_Y.plank + 0.006]),
  ];
  return plateXY(shape(pts), z, 0.01);
}

/** A diffuser strake: hangs from the ramped roof down to the floor's reference plane. */
function strake(z: number, x0: number, x1: number): THREE.BufferGeometry {
  const xs = range(x0, x1, 14);
  const pts: P2[] = [
    ...xs.map((x): P2 => [x, floorUnderside(x, z) + 0.006]),
    [x1, FLOOR_Y.bottom],
    [x0, FLOOR_Y.bottom],
  ];
  return plateXY(shape(pts), z, 0.01);
}

export function buildFloor(mats: PartMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'floor';
  const pieces = new PieceSet();

  const stations = range(FLOOR_X.front, FLOOR_X.exit, 60);
  pieces.add('carbon', loft(stations.map(floorRing)), 30);

  // Plank (skid block) under the centre line; its wear is how ride height is policed.
  pieces.add('carbonLight', roundedBox([2.2, 0.02, 0.3], [0.05, FLOOR_Y.plank + 0.01, 0], 0.008, 2), false);

  // Inlet fences split the flow into the tunnels; strakes straighten it in the diffuser.
  for (const z of [0.3, 0.44, 0.58]) pieces.addPair('carbon', fence(z, 1.4, 0.75), 30);
  pieces.addPair('carbon', strake(0.26, -1.2, -1.94), 30);
  pieces.addPair('carbon', strake(0.515, -1.3, -1.94), 30);

  // Floor edge: a small upturned lip that seals the tunnels against air leaking in from the side.
  const lip = shape([
    [0.9, FLOOR_Y.top - 0.004],
    [0.85, FLOOR_Y.top + 0.03],
    [-0.8, FLOOR_Y.top + 0.045],
    [-0.9, FLOOR_Y.top + 0.03],
    [-0.95, FLOOR_Y.top - 0.004],
  ]);
  pieces.addPair('carbon', plateXY(lip, 0.815, 0.012), 30);

  pieces.build(group, mats);
  return group;
}
