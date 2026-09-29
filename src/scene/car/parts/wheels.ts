/**
 * Wheels: 18-inch rims with low-profile tyres. Each wheel hangs from a spinner group at the axle,
 * so rolling is one rotation about Z. The rim face carries a few raised ribs so spin is readable.
 */
import * as THREE from 'three';
import { PALETTE } from '../../palette';
import { latheZ, mirrorZ, roundedBox, type P2 } from '../geometry/primitives';
import { AXLE_X, RIM_RADIUS, TYRE, wheelZ, type TyreSize } from '../dims';
import type { PartMaterials } from '../materials';
import { PieceSet } from '../pieces';

const SEGMENTS = 72;
const TREAD = new THREE.Color(PALETTE.tyre);
const SIDEWALL = new THREE.Color(PALETTE.tyreSidewall);

/** Arc points from angle a0 to a1 (radians) around centre (r, z) in the lathe's (radius, z) plane. */
function arc(cr: number, cz: number, rad: number, a0: number, a1: number, steps: number): P2[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / steps;
    return [cr + rad * Math.cos(a), cz + rad * Math.sin(a)];
  });
}

/**
 * Tyre cross-section as a closed loop: outer (+z) sidewall up from the bead, rounded shoulder,
 * slightly crowned tread, the other shoulder and sidewall, then back along the bead seat.
 */
function tyreProfile({ radius: R, width: W }: TyreSize): P2[] {
  const bulge = 0.012; // sidewall bulge beyond the tread edge
  const hw = W / 2 - bulge; // so the bulge, not the tread, sits on the width limit
  const bead = RIM_RADIUS + 0.012;
  const sh = 0.055; // shoulder radius
  return [
    [bead, hw - 0.012],
    [bead + 0.03, hw - 0.002],
    [R - sh - 0.03, hw + bulge * 0.6],
    ...arc(R - sh, hw - sh + bulge, sh, Math.PI / 2, 0, 8),
    [R + 0.004, 0],
    ...arc(R - sh, -hw + sh - bulge, sh, 0, -Math.PI / 2, 8),
    [R - sh - 0.03, -hw - bulge * 0.6],
    [bead + 0.03, -hw + 0.002],
    [bead, -hw + 0.012],
    [bead, hw - 0.012], // close the loop along the bead seat
  ];
}

/** Tint by radius: tread in tyre black, sidewalls a shade lighter so the shape reads in shadow. */
function tintTyre(g: THREE.BufferGeometry, R: number): void {
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    c.lerpColors(SIDEWALL, TREAD, THREE.MathUtils.smoothstep(r, R - 0.06, R - 0.03));
    c.toArray(colors, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** Rim as a solid of revolution: flange lip, dished face, hub. Outer face at +z. */
function rimProfile({ width: W }: TyreSize): P2[] {
  const hw = W / 2;
  const lip = RIM_RADIUS + 0.022;
  return [
    [0, -hw + 0.03],
    [RIM_RADIUS - 0.004, -hw + 0.01],
    [lip, -hw + 0.012],
    [lip, -hw + 0.03],
    [RIM_RADIUS, -hw + 0.035],
    [RIM_RADIUS, hw - 0.035],
    [lip, hw - 0.028],
    [lip, hw - 0.012],
    [RIM_RADIUS - 0.006, hw - 0.01],
    [RIM_RADIUS - 0.03, hw - 0.028],
    [0.075, hw - 0.045],
    [0.06, hw - 0.03],
    [0, hw - 0.03],
  ];
}

export interface WheelBuild {
  group: THREE.Group;
  spinner: THREE.Group;
}

/** One wheel at its corner; `side` = +1 right (+z), -1 left. */
export function buildWheel(
  mats: PartMaterials,
  name: string,
  axle: 'front' | 'rear',
  side: 1 | -1,
): WheelBuild {
  const size = TYRE[axle];
  const group = new THREE.Group();
  group.name = name;
  const spinner = new THREE.Group();
  spinner.name = `${name}:spin`;
  spinner.position.set(AXLE_X[axle], size.radius, side * wheelZ(size));
  group.add(spinner);

  const hw = size.width / 2;
  const tyre = latheZ(tyreProfile(size), SEGMENTS);
  tintTyre(tyre, size.radius);

  const rim = latheZ(rimProfile(size), SEGMENTS);
  const pieces = new PieceSet();
  // Five ribs on the dished face: symmetric enough to look like a wheel, few enough to see turn.
  const ribs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const rib = roundedBox([0.14, 0.03, 0.02], [0.145, 0, hw - 0.036], 0.008, 2);
    rib.rotateZ((i / 5) * Math.PI * 2);
    ribs.push(rib);
  }
  const nut = new THREE.CylinderGeometry(0.035, 0.04, 0.05, 6)
    .rotateX(Math.PI / 2)
    .translate(0, 0, hw - 0.02);

  const orient = (g: THREE.BufferGeometry) => {
    if (side === 1) return g;
    const m = mirrorZ(g);
    g.dispose();
    return m;
  };
  pieces.add('tyre', orient(tyre), 50);
  pieces.add('rim', orient(rim), 40);
  for (const rib of ribs) pieces.add('rim', orient(rib), false);
  pieces.add('metal', orient(nut), 40);
  pieces.build(spinner, mats);
  return { group, spinner };
}
