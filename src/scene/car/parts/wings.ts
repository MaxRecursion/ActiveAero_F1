/**
 * Front and rear wings. 2026 rules make both wings active: in Straight Mode the front-wing flaps
 * and the rear-wing flap rotate to shed drag, in Corner Mode they close for maximum downforce.
 * Each moving element is built around its hinge so active aero is a single rotation.
 */
import * as THREE from 'three';
import {
  spanStations,
  upperSurfaceY,
  wingElement,
  type AirfoilSpec,
  type WingStation,
} from '../geometry/airfoil';
import { plateXY, shape } from '../geometry/primitives';
import type { PartMaterials } from '../materials';
import { PieceSet } from '../pieces';

const deg = THREE.MathUtils.degToRad;

/** A hinged element: the pivot sits on the hinge line; `open` is its rotation in Straight Mode. */
export interface Flap {
  pivot: THREE.Object3D;
  open: number;
}

export interface WingBuild {
  group: THREE.Group;
  flaps: Flap[];
  /** Upper surface of the mainplane at the centre of pressure, z = 0 (for the anchor). */
  cp: THREE.Vector3;
}

/** Wrap one element in a pivot group at `hinge`, so rotating the pivot swings it about that line. */
function hinged(
  parent: THREE.Object3D,
  mats: PartMaterials,
  name: string,
  geometry: THREE.BufferGeometry,
  hinge: THREE.Vector3,
): THREE.Object3D {
  const pivot = new THREE.Group();
  pivot.name = name;
  pivot.position.copy(hinge);
  geometry.translate(-hinge.x, -hinge.y, -hinge.z);
  new PieceSet().add('carbon', geometry, 50).build(pivot, mats);
  parent.add(pivot);
  return pivot;
}

const trailingEdge = (st: WingStation) =>
  new THREE.Vector3(st.x - st.chord * Math.cos(st.angle), st.y + st.chord * Math.sin(st.angle), 0);

// ── front wing ─────────────────────────────────────────────────────────────────

const FW_HALF_SPAN = 0.88;
const FW_MAIN: AirfoilSpec = { thickness: 0.1, camber: 0.06 };
const FW_FLAP: AirfoilSpec = { thickness: 0.11, camber: 0.07 };
const FW_CP_X = 2.4;

const fwMain = (t: number) => ({
  x: 2.74 - 0.07 * t * t,
  y: 0.085 + 0.012 * t,
  chord: 0.37 - 0.08 * t,
  angle: deg(4 + 4 * t),
});
/** Flaps sweep up toward the tips, where they meet the endplates. */
const fwFlap1 = (t: number) => ({
  x: 2.43 - 0.06 * t * t,
  y: 0.128 + 0.06 * t * t,
  chord: 0.17,
  angle: deg(16 + 10 * t),
});
const fwFlap2 = (t: number) => ({
  x: 2.29 - 0.05 * t * t,
  y: 0.172 + 0.04 * t * t,
  chord: 0.145,
  angle: deg(28 + 6 * t),
});

export function buildFrontWing(mats: PartMaterials): WingBuild {
  const group = new THREE.Group();
  group.name = 'frontWing';
  const pieces = new PieceSet();

  const main = spanStations(-FW_HALF_SPAN, FW_HALF_SPAN, 29, fwMain);
  pieces.add('carbon', wingElement(main, FW_MAIN), 50);

  // Endplates: simple, rounded 2026 plates that tie the elements together ahead of the tyres.
  const endplate = shape(
    [
      [2.77, 0.05],
      [2.78, 0.12],
      [2.62, 0.18],
      [2.42, 0.26],
      [2.26, 0.31],
      [2.14, 0.31],
      [2.1, 0.25],
      [2.12, 0.05],
    ],
    0.025,
  );
  pieces.addPair('carbon', plateXY(endplate, FW_HALF_SPAN + 0.004, 0.012), 30);
  pieces.build(group, mats);

  // The flaps hinge near their leading edges and drop their trailing edges in Straight Mode.
  const flaps: Flap[] = [];
  for (const [i, fn, open] of [
    [1, fwFlap1, deg(10)],
    [2, fwFlap2, deg(14)],
  ] as const) {
    const stations = spanStations(-FW_HALF_SPAN, FW_HALF_SPAN, 29, fn);
    const centre = stations[Math.floor(stations.length / 2)];
    const hinge = new THREE.Vector3(centre.x - centre.chord * 0.25, centre.y, 0);
    flaps.push({
      pivot: hinged(group, mats, `frontWing:flap${i}`, wingElement(stations, FW_FLAP), hinge),
      open,
    });
  }

  const centre = { z: 0, ...fwMain(0) };
  const cp = new THREE.Vector3(FW_CP_X, upperSurfaceY(centre, FW_MAIN, FW_CP_X), 0);
  return { group, flaps, cp };
}

// ── rear wing ──────────────────────────────────────────────────────────────────

const RW_HALF_SPAN = 0.5;
const RW_MAIN: AirfoilSpec = { thickness: 0.12, camber: 0.07 };
const RW_FLAP: AirfoilSpec = { thickness: 0.1, camber: 0.08 };
const RW_CP_X = -2.3;

const rwMain = (t: number) => ({ x: -2.06, y: 0.74 + 0.025 * t * t, chord: 0.27, angle: deg(9) });
const rwFlap = (t: number) => ({ x: -2.3, y: 0.812 + 0.02 * t * t, chord: 0.275, angle: deg(29) });

export function buildRearWing(mats: PartMaterials): WingBuild {
  const group = new THREE.Group();
  group.name = 'rearWing';
  const pieces = new PieceSet();

  pieces.add('carbon', wingElement(spanStations(-RW_HALF_SPAN, RW_HALF_SPAN, 21, rwMain), RW_MAIN), 50);

  const endplate = shape(
    [
      [-2.03, 0.64],
      [-1.99, 0.95],
      [-2.06, 0.978],
      [-2.57, 0.978],
      [-2.61, 0.94],
      [-2.6, 0.68],
      [-2.46, 0.61],
      [-2.12, 0.61],
    ],
    0.035,
  );
  pieces.addPair('carbon', plateXY(endplate, RW_HALF_SPAN + 0.002, 0.014), 30);

  // Swan-neck pillar: rises from the crash structure and hooks over the leading edge, so the
  // underside — the side that makes most of the downforce — stays clean. No beam wing in 2026.
  const neck = shape(
    [
      [-1.99, 0.4],
      [-1.99, 0.62],
      [-2.0, 0.74],
      [-2.03, 0.785],
      [-2.09, 0.8],
      [-2.17, 0.79],
      [-2.12, 0.772],
      [-2.07, 0.745],
      [-2.08, 0.62],
      [-2.13, 0.4],
    ],
    0.012,
  );
  pieces.add('carbon', plateXY(neck, 0, 0.022), 30);
  pieces.build(group, mats);

  // The flap hinges at its trailing edge: opening lifts the leading edge and widens the slot,
  // like DRS did, so Straight Mode is obvious from the side.
  const stations = spanStations(-RW_HALF_SPAN + 0.002, RW_HALF_SPAN - 0.002, 21, rwFlap);
  const hinge = trailingEdge(stations[Math.floor(stations.length / 2)]);
  const flaps: Flap[] = [
    { pivot: hinged(group, mats, 'rearWing:flap', wingElement(stations, RW_FLAP), hinge), open: deg(26) },
  ];

  const centre = { z: 0, ...rwMain(0) };
  const cp = new THREE.Vector3(RW_CP_X, upperSurfaceY(centre, RW_MAIN, RW_CP_X), 0);
  return { group, flaps, cp };
}
