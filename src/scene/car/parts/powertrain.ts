/**
 * Power unit, energy store and gearbox — hidden under the bodywork until the car is exploded or
 * X-rayed. 2026 power units drop the MGU-H; roughly half the power now comes from the MGU-K and
 * battery. Layout front to back: battery under the fuel cell, 1.6 L V6 (90° vee) with the MGU-K
 * low on its flank, turbo, gearbox casing reaching past the rear axle into the rear crash structure.
 */
import * as THREE from 'three';
import { range } from '../geometry/curves';
import { loft, ring, roundEnd, sampleSections, type Section } from '../geometry/loft';
import { roundedBox } from '../geometry/primitives';
import type { PartMaterials } from '../materials';
import { PieceSet } from '../pieces';

/** Engine block extent along x and crank height. */
const ENGINE = { front: -0.84, rear: -1.42, crankY: 0.19 } as const;
const BANK_TILT = Math.PI / 4; // each bank 45° off vertical: a 90° vee

/**
 * MGU-K: an axial motor-generator geared to the crank. Drawn on the car's right, the side the hero
 * camera sees, so Station 3 can show it; 2026 motors are ~350 kW, hence the sizeable drum.
 */
const MGUK = { x: ENGINE.front - 0.15, y: 0.155, z: 0.215, radius: 0.068, length: 0.24 } as const;

/** Anchor points (car frame): the V6 block centre and the MGU-K centre. */
export const ENGINE_CENTRE = new THREE.Vector3((ENGINE.front + ENGINE.rear) / 2, ENGINE.crankY + 0.1, 0);
export const MGUK_CENTRE = new THREE.Vector3(MGUK.x, MGUK.y, MGUK.z);

export function buildPowerUnit(mats: PartMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'powerUnit';
  const pieces = new PieceSet();
  const length = ENGINE.front - ENGINE.rear;
  const midX = (ENGINE.front + ENGINE.rear) / 2;

  // Crankcase / sump.
  pieces.add('engine', roundedBox([length, 0.2, 0.28], [midX, ENGINE.crankY - 0.02, 0], 0.035, 3), false);

  // Two cylinder banks with cam covers, tilted out from the crank. The heads are kept short of the
  // block's rear, where the engine cover pinches in, so they stay inside the bodywork.
  for (const side of [1, -1] as const) {
    const bank = roundedBox([length - 0.16, 0.17, 0.13], [0.06, 0.085, 0], 0.03, 3);
    const cam = roundedBox([length - 0.2, 0.05, 0.15], [0.06, 0.185, 0], 0.022, 3);
    // One ignition coil per cylinder: three per bank make the V6 countable at a glance.
    const coils = [-1, 0, 1].map((i) =>
      new THREE.CylinderGeometry(0.022, 0.024, 0.04, 16).translate(0.06 + i * 0.13, 0.215, 0),
    );
    for (const [g, key] of [
      [bank, 'engine'],
      [cam, 'carbonLight'],
      ...coils.map((c) => [c, 'carbon'] as const),
    ] as const) {
      g.rotateX(side * BANK_TILT); // +θ about x leans the bank toward +z
      g.translate(midX, ENGINE.crankY + 0.06, 0);
      pieces.add(key, g, false);
    }
  }

  // Intake plenum in the vee, fed from the airbox above the driver's head.
  pieces.add(
    'carbonLight',
    roundedBox([length - 0.12, 0.12, 0.12], [midX + 0.03, ENGINE.crankY + 0.2, 0], 0.05, 3),
    false,
  );

  // Turbo at the back of the engine: compressor and turbine housings on a common shaft.
  const turboX = ENGINE.rear - 0.07;
  const turboY = ENGINE.crankY + 0.2;
  const housing = (r: number, x: number) =>
    new THREE.TorusGeometry(r, r * 0.55, 12, 28).rotateY(Math.PI / 2).translate(x, turboY, 0);
  pieces.add('metal', housing(0.075, turboX + 0.03), 50);
  pieces.add('metal', housing(0.065, turboX - 0.08), 50);
  pieces.add(
    'metal',
    new THREE.CylinderGeometry(0.05, 0.05, 0.2, 20).rotateZ(Math.PI / 2).translate(turboX - 0.025, turboY, 0),
    50,
  );

  // Exhaust: three primaries per bank into the turbine, then the single tailpipe under the rear wing.
  for (const side of [1, -1] as const) {
    for (let i = 0; i < 3; i++) {
      const x = ENGINE.front - 0.1 - i * 0.17;
      const port = new THREE.Vector3(x, ENGINE.crankY + 0.08, side * 0.17);
      const mid = new THREE.Vector3(x - 0.08, ENGINE.crankY + 0.05, side * 0.21); // clears the MGU-K
      const curve = new THREE.CatmullRomCurve3([
        port,
        mid,
        new THREE.Vector3(turboX - 0.08, turboY - 0.03, side * 0.05),
      ]);
      pieces.add('metal', new THREE.TubeGeometry(curve, 16, 0.018, 8, false), 60);
    }
  }
  const tail = new THREE.CatmullRomCurve3([
    new THREE.Vector3(turboX - 0.1, turboY, 0),
    new THREE.Vector3(-1.75, 0.4, 0),
    new THREE.Vector3(-2.14, 0.435, 0),
  ]);
  pieces.add('metal', new THREE.TubeGeometry(tail, 24, 0.04, 16, false), 60);

  // MGU-K: dark drum with bright end bells, and the gear case that couples it to the crank.
  const alongX = (g: THREE.BufferGeometry, x: number) =>
    g.rotateZ(Math.PI / 2).translate(x, MGUK.y, MGUK.z);
  const { radius: r, length: len } = MGUK;
  pieces.add('carbonLight', alongX(new THREE.CylinderGeometry(r, r, len - 0.04, 32), MGUK.x), 50);
  for (const end of [1, -1]) {
    const bell = new THREE.CylinderGeometry(r * 0.8, r * 1.06, 0.03, 32);
    if (end < 0) bell.rotateX(Math.PI); // taper outward at both ends
    pieces.add('metal', alongX(bell.translate(0, (len / 2 - 0.02) * end, 0), MGUK.x), 50);
  }
  pieces.add('metal', alongX(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 16), MGUK.x - len / 2 - 0.01), 50);
  pieces.add(
    'engine',
    roundedBox([0.07, 0.12, MGUK.z - 0.1], [MGUK.x + len / 2 - 0.02, MGUK.y + 0.01, (MGUK.z + 0.1) / 2], 0.02, 2),
    false,
  );

  pieces.build(group, mats);
  return group;
}

/** Energy store: four cell modules in a row, tapered to sit in the bottom of the tub. */
const BATTERY = { front: -0.26, rear: -0.74, modules: 4, gap: 0.014 } as const;
const MODULE: Omit<Section, 'x'> = { yBot: 0.082, yTop: 0.212, wBot: 0.15, wTop: 0.19, n: 4 };

export const BATTERY_CENTRE = new THREE.Vector3((BATTERY.front + BATTERY.rear) / 2, 0.15, 0);

export function buildBattery(mats: PartMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'battery';
  const pieces = new PieceSet();
  const pitch = (BATTERY.front - BATTERY.rear) / BATTERY.modules;
  for (let i = 0; i < BATTERY.modules; i++) {
    const x0 = BATTERY.front - i * pitch - BATTERY.gap / 2;
    const body = [x0, x0 - pitch + BATTERY.gap].map((x) => ({ ...MODULE, x }));
    const rings = [...roundEnd(body[0], 1, 0.012, 2).reverse(), ...body, ...roundEnd(body[1], -1, 0.012, 2)];
    pieces.add('carbonLight', loft(rings.map((s) => ring(s, 32))));
  }
  // Cooling plate across the top: a satin face that shows the pack from above without glaring.
  const length = BATTERY.front - BATTERY.rear - 0.03;
  pieces.add(
    'rim',
    roundedBox([length, 0.014, 0.33], [BATTERY_CENTRE.x, MODULE.yTop + 0.004, 0], 0.006, 2),
    false,
  );
  pieces.build(group, mats);
  return group;
}

/** Gearbox casing tapering to the rear crash structure, with the rain light at its tip. */
const CASING: Section[] = [
  { x: -1.42, yBot: 0.14, yTop: 0.42, wBot: 0.13, wTop: 0.12, n: 3.4 },
  { x: -1.7, yBot: 0.2, yTop: 0.44, wBot: 0.11, wTop: 0.1, n: 3.2 },
  { x: -2.0, yBot: 0.28, yTop: 0.44, wBot: 0.08, wTop: 0.075, n: 3 },
  { x: -2.2, yBot: 0.32, yTop: 0.43, wBot: 0.06, wTop: 0.055, n: 2.8 },
  { x: -2.36, yBot: 0.345, yTop: 0.42, wBot: 0.042, wTop: 0.04, n: 2.6 },
];

export function buildGearbox(mats: PartMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'gearbox';
  const body = sampleSections(CASING, range(-1.42, -2.36, 18));
  const rings = [...body, ...roundEnd(body[body.length - 1], -1, 0.02, 3)].map((s) => ring(s, 32));
  new PieceSet()
    .add('carbon', loft(rings))
    .add('clayDark', roundedBox([0.03, 0.05, 0.07], [-2.385, 0.382, 0], 0.012, 2), false)
    .build(group, mats);
  return group;
}
