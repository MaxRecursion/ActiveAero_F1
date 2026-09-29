/**
 * The procedural 2026 car: a clay wind-tunnel model assembled from parts (see ./types.ts for the
 * contract and dimensions). The part registry and per-frame controls (explode, ride height,
 * highlight, X-ray) are shared with the real-model car, see ./rig.ts.
 */
import * as THREE from 'three';
import { CAR_FRAME, ESTIMATES } from '../../physics/constants';
import { AXLE_X, FLOOR_Y, TYRE } from './dims';
import { buildBodywork, engineCoverTop } from './parts/bodywork';
import { buildNose, buildSurvivalCell } from './parts/chassis';
import { buildDriver, buildHalo } from './parts/cockpit';
import { buildFloor } from './parts/floor';
import {
  BATTERY_CENTRE,
  buildBattery,
  buildGearbox,
  buildPowerUnit,
  ENGINE_CENTRE,
  MGUK_CENTRE,
} from './parts/powertrain';
import { buildSuspension } from './parts/suspension';
import { buildWheel } from './parts/wheels';
import { buildFrontWing, buildRearWing, type Flap } from './parts/wings';
import { CarAssembly } from './rig';
import type { CarAnchors, CarModel, PartId } from './types';

/** The parts that turn to a ghost under X-ray; everything else stays solid. */
const SHELL: readonly PartId[] = ['nose', 'bodywork', 'survivalCell', 'halo', 'driver'];

/** How far the two halves of each suspension spread apart (each side, metres) at full explode. */
const SUSPENSION_SPREAD = 0.24;

export function buildCar(): CarModel {
  const car = new CarAssembly();
  const { add, anchor } = car;

  // Explode offsets: the tub and floor stay put as the reference; the bodywork lifts highest so the
  // floor's top and the power unit show; wings slide off fore and aft; wheels move out along
  // their axles. Everything stays inside x ±4.3, y ≤ 2.6, |z| ≤ 2.3.
  const cell = add('survivalCell', 'Survival cell', 'chassis', [0, 0, 0], buildSurvivalCell);
  add('nose', 'Nose', 'chassis', [0.55, 0.22, 0], buildNose);
  const bodywork = add('bodywork', 'Bodywork', 'aero', [0, 0.95, 0], buildBodywork);
  const floor = add('floor', 'Floor', 'aero', [0, 0, 0], buildFloor);

  const flaps: Flap[] = [];
  let frontCP = new THREE.Vector3();
  let rearCP = new THREE.Vector3();
  const frontWing = add('frontWing', 'Front wing', 'aero', [1.15, 0, 0], (m) => {
    const w = buildFrontWing(m);
    flaps.push(...w.flaps);
    frontCP = w.cp;
    return w.group;
  });
  const rearWing = add('rearWing', 'Rear wing', 'aero', [-0.95, 0.55, 0], (m) => {
    const w = buildRearWing(m);
    flaps.push(...w.flaps);
    rearCP = w.cp;
    return w.group;
  });

  add('halo', 'Halo', 'chassis', [0.08, 0.46, 0], buildHalo);
  add('driver', 'Driver', 'driver', [0, 0.24, 0], buildDriver);

  // The car's right is +z (the hero camera looks at the right-hand side).
  const spinners: THREE.Object3D[] = [];
  const wheels: [PartId, string, 'front' | 'rear', 1 | -1][] = [
    ['wheelFL', 'Front-left wheel', 'front', -1],
    ['wheelFR', 'Front-right wheel', 'front', 1],
    ['wheelRL', 'Rear-left wheel', 'rear', -1],
    ['wheelRR', 'Rear-right wheel', 'rear', 1],
  ];
  for (const [id, label, axle, side] of wheels) {
    add(
      id,
      label,
      'wheels',
      [0, 0, side * 0.6],
      (m) => {
        const w = buildWheel(m, id, axle, side);
        spinners.push(w.spinner);
        return w.group;
      },
      { dropShare: 0 },
    );
  }

  const halves: [THREE.Group, 1 | -1][] = [];
  for (const [id, label, axle] of [
    ['suspensionFront', 'Front suspension', 'front'],
    ['suspensionRear', 'Rear suspension', 'rear'],
  ] as const) {
    add(
      id,
      label,
      'chassis',
      [0, 0, 0],
      (m) => {
        const s = buildSuspension(m, axle);
        halves.push([s.sides[0], 1], [s.sides[1], -1]);
        return s.group;
      },
      { dropShare: 0.5 },
    );
  }

  const powerUnit = add('powerUnit', 'Power unit', 'powertrain', [0, 0.42, 0], buildPowerUnit, {
    exterior: false,
  });
  const battery = add('battery', 'Battery', 'powertrain', [0, 0.6, 0], buildBattery, { exterior: false });
  const gearbox = add('gearbox', 'Gearbox', 'powertrain', [-0.3, 0.22, 0], buildGearbox);

  const anchors: CarAnchors = {
    frontWingCP: anchor(frontWing, 'frontWingCP', frontCP),
    floorCP: anchor(floor, 'floorCP', { x: -0.15, y: FLOOR_Y.top, z: 0 }),
    rearWingCP: anchor(rearWing, 'rearWingCP', rearCP),
    cg: anchor(cell, 'cg', { x: CAR_FRAME.cgX, y: ESTIMATES.cgHeightM, z: 0 }),
    dragOrigin: anchor(floor, 'dragOrigin', { x: -2.62, y: 0.45, z: 0 }),
    floorArrowEntry: anchor(bodywork, 'floorArrowEntry', { x: -0.15, y: engineCoverTop(-0.15), z: 0 }),
    engine: anchor(powerUnit, 'engine', ENGINE_CENTRE),
    mguK: anchor(powerUnit, 'mguK', MGUK_CENTRE),
    battery: anchor(battery, 'battery', BATTERY_CENTRE),
    rearAxle: anchor(gearbox, 'rearAxle', { x: AXLE_X.rear, y: TYRE.rear.radius, z: 0 }),
  };

  return car.toModel({
    anchors,
    shell: SHELL,
    spinners,
    spread: { halves, amount: SUSPENSION_SPREAD },
    setActiveAero(k) {
      for (const f of flaps) f.pivot.rotation.z = f.open * k;
    },
  });
}
