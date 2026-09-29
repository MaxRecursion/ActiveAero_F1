/**
 * The procedural 2026 car: a clay wind-tunnel model assembled from parts (see ./types.ts for the
 * contract and dimensions). Each part is one Object3D whose origin is its assembled position, so
 * explode, ride height, highlight and X-ray are cheap per-frame transforms, uniform changes and
 * material swaps.
 */
import * as THREE from 'three';
import { CAR_FRAME, ESTIMATES } from '../../physics/constants';
import { AXLE_X, FLOOR_Y, TYRE } from './dims';
import { PartMaterials } from './materials';
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
import type { CarAnchors, CarModel, CarPart, PartGroup, PartId } from './types';
import { XrayShell } from './xray';

type V3 = THREE.Vector3Tuple;

/** The parts that turn to a ghost under X-ray; everything else stays solid. */
const SHELL: readonly PartId[] = ['nose', 'bodywork', 'survivalCell', 'halo', 'driver'];

/** How far the two halves of each suspension spread apart (each side, metres) at full explode. */
const SUSPENSION_SPREAD = 0.24;

interface Entry extends CarPart {
  materials: PartMaterials;
  /** Share of the ride-height drop this part follows: 1 sprung, 0.5 suspension, 0 wheels. */
  dropShare: number;
}

export function buildCar(): CarModel {
  const root = new THREE.Group();
  root.name = 'car';
  const parts = new Map<PartId, CarPart>();
  const entries: Entry[] = [];
  const exteriorMeshes: THREE.Mesh[] = [];

  function add<T extends THREE.Object3D>(
    id: PartId,
    label: string,
    group: PartGroup,
    offset: V3,
    build: (mats: PartMaterials) => T,
    { dropShare = 1, exterior = true } = {},
  ): T {
    const materials = new PartMaterials();
    const object = build(materials);
    object.name = id;
    root.add(object);
    const entry: Entry = {
      id,
      label,
      group,
      object,
      explodeOffset: new THREE.Vector3(...offset),
      materials,
      dropShare,
    };
    entries.push(entry);
    parts.set(id, entry);
    if (exterior) {
      object.traverse((o) => {
        if (o instanceof THREE.Mesh) exteriorMeshes.push(o);
      });
    }
    return object;
  }

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

  const suspensionSides: [half: THREE.Group, side: 1 | -1][] = [];
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
        suspensionSides.push([s.sides[0], 1], [s.sides[1], -1]);
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

  const anchor = (parent: THREE.Object3D, name: string, p: THREE.Vector3Like): THREE.Object3D => {
    const o = new THREE.Object3D();
    o.name = `anchor:${name}`;
    o.position.copy(p);
    parent.add(o);
    return o;
  };
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

  const xray = new XrayShell(entries.filter((e) => SHELL.includes(e.id)));

  let explode = 0;
  let drop = 0;
  function place(): void {
    for (const e of entries) {
      e.object.position.copy(e.explodeOffset).multiplyScalar(explode);
      e.object.position.y -= drop * e.dropShare;
    }
    for (const [half, side] of suspensionSides) half.position.z = side * SUSPENSION_SPREAD * explode;
  }

  return {
    root,
    parts,
    anchors,
    exteriorMeshes,
    setExplode(t) {
      explode = THREE.MathUtils.clamp(t, 0, 1);
      place();
    },
    setWheelSpin(angle) {
      // Rolling toward +X turns the wheel clockwise seen from +Z: a negative rotation about Z.
      for (const s of spinners) s.rotation.z = -angle;
    },
    setRideHeightDrop(metres) {
      drop = metres;
      place();
    },
    setActiveAero(t) {
      const k = THREE.MathUtils.clamp(t, 0, 1);
      for (const f of flaps) f.pivot.rotation.z = f.open * k;
    },
    setHighlight(ids) {
      for (const e of entries)
        e.materials.setEmphasis(ids === null ? 'none' : ids.includes(e.id) ? 'on' : 'faded');
    },
    setXray(t) {
      xray.set(t);
    },
    dispose() {
      root.removeFromParent();
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      for (const e of entries) e.materials.dispose();
      parts.clear();
      exteriorMeshes.length = 0;
    },
  };
}
