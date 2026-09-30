/**
 * The real 2026 car: the body panels are the downloaded model (see public/models/CREDITS.txt),
 * split into parts and simplified by scripts/model/process.mjs, shown in our matte clay finish.
 * The power unit, battery, gearbox and driver, which the model lacks, are the procedural
 * builders fitted inside its shell. Same CarModel contract as buildCar(), which stays as the
 * fallback should this load fail.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CAR_FRAME, ESTIMATES } from '../../physics/constants';
import { AXLE_X } from './dims';
import type { MatKey } from './materials';
import { buildDriver } from './parts/cockpit';
import { BATTERY_CENTRE, buildBattery, buildGearbox, buildPowerUnit, ENGINE_CENTRE, MGUK_CENTRE } from './parts/powertrain';
import { hubZone, takeIslands } from './real/hubs';
import { FITS, fitPoint, fitted } from './real/internals';
import { finish, hangFlap, meshesOf, mountWheel, wrap, type Hinged } from './real/parts';
import { chordNear, topSurfaceY } from './real/surface';
import { CarAssembly } from './rig';
import type { CarAnchors, CarModel, PartGroup, PartId } from './types';

type V3 = THREE.Vector3Tuple;

const MODEL_URL = 'models/car.glb';

/** The parts that turn to a ghost under X-ray; everything else stays solid. */
const SHELL: readonly PartId[] = ['nose', 'bodywork', 'survivalCell', 'halo', 'driver'];

/** A wing mainplane's chord is longer than this (metres); the strakes and tabs around it are not. */
const MIN_CHORD = 0.15;

/** Straight-Mode turn of each active element (degrees): the front flaps shed incidence, the rear flap opens like DRS. */
const OPEN_DEG = { frontWing: 12, rearWing: 28 } as const;

interface Spec {
  id: PartId;
  label: string;
  group: PartGroup;
  /** Car-frame translation at explode = 1: the tub and floor stay put, the bodywork lifts highest, wings slide off. */
  offset: V3;
  finish: MatKey;
  dropShare?: number;
}

/** The parts that come from the model, in the file's node names. Wheels are mounted separately. */
const BODY: Spec[] = [
  { id: 'survivalCell', label: 'Survival cell', group: 'chassis', offset: [0, 0, 0], finish: 'shellClay' },
  { id: 'nose', label: 'Nose', group: 'chassis', offset: [0.55, 0.22, 0], finish: 'shellClay' },
  { id: 'bodywork', label: 'Bodywork', group: 'aero', offset: [0, 0.95, 0], finish: 'shellClay' },
  { id: 'floor', label: 'Floor', group: 'aero', offset: [0, 0, 0], finish: 'shellCarbon' },
  { id: 'frontWing', label: 'Front wing', group: 'aero', offset: [1.15, 0, 0], finish: 'carbon' },
  { id: 'rearWing', label: 'Rear wing', group: 'aero', offset: [-0.95, 0.55, 0], finish: 'carbon' },
  { id: 'halo', label: 'Halo', group: 'chassis', offset: [0.08, 0.46, 0], finish: 'metal' },
  { id: 'suspensionFront', label: 'Front suspension', group: 'chassis', offset: [0, 0, 0], finish: 'carbonLight', dropShare: 0.5 },
  { id: 'suspensionRear', label: 'Rear suspension', group: 'chassis', offset: [0, 0, 0], finish: 'carbonLight', dropShare: 0.5 },
];

const WHEELS: [PartId, string][] = [
  ['wheelFL', 'Front-left wheel'],
  ['wheelFR', 'Front-right wheel'],
  ['wheelRL', 'Rear-left wheel'],
  ['wheelRR', 'Rear-right wheel'],
];

/** Fetch and decode public/models/car.glb (resolved against the page, so a relative Vite base works). */
export async function loadCar(): Promise<CarModel> {
  const url = new URL(`${import.meta.env.BASE_URL}${MODEL_URL}`, document.baseURI).href;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  return assembleCar(gltf.scene);
}

/** Build the car from a decoded car.glb scene (exported so tests can feed it a file from disk). */
export function assembleCar(scene: THREE.Object3D): CarModel {
  const node = (name: string): THREE.Object3D => {
    const n = scene.getObjectByName(name);
    if (!n) throw new Error(`car.glb has no node "${name}"`);
    return n;
  };
  const car = new CarAssembly();
  const { add, anchor } = car;
  const active: { hinged: Hinged; openDeg: number }[] = [];
  const mainplanes = new Map<PartId, THREE.Mesh[]>(); // a wing's fixed element, apart from its flap

  for (const spec of BODY) {
    add(spec.id, spec.label, spec.group, spec.offset, (mats) => {
      const n = node(spec.id);
      finish(n, mats, spec.finish);
      const part = wrap(spec.id, n);
      const flaps = { frontWing: 'frontWingFlaps', rearWing: 'rearWingFlap' }[spec.id as string];
      const moving = flaps ? node(flaps) : null;
      // The flap may hang under the wing node in the file; the anchors want the fixed element only.
      const flapMeshes = new Set(moving ? meshesOf(moving) : []);
      mainplanes.set(spec.id, meshesOf(n).filter((m) => !flapMeshes.has(m)));
      if (moving) {
        finish(moving, mats, spec.finish);
        const hinged = hangFlap(moving);
        active.push({ hinged, openDeg: OPEN_DEG[spec.id as keyof typeof OPEN_DEG] });
        part.add(hinged.pivot);
      }
      return part;
    }, { dropShare: spec.dropShare });
  }

  // Hubs and brake ducts are fused into the nose, bodywork and floor; give each to its wheel.
  const wheelNodes = WHEELS.map(([id]) => node(id));
  const zones = wheelNodes.map((n) => {
    const { centre, radius, width } = n.userData as { centre: V3; radius: number; width: number };
    return hubZone(centre, radius, width);
  });
  const hubs = WHEELS.map(() => [] as THREE.Mesh[]);
  for (const id of ['nose', 'bodywork', 'floor'] as const) {
    for (const source of meshesOf(car.parts.get(id)!.object)) {
      takeIslands(source, zones).forEach((hub, i) => hub && hubs[i].push(hub));
    }
  }

  const spinners: THREE.Object3D[] = [];
  let rearWheelY = 0;
  WHEELS.forEach(([id, label], i) => {
    const side = id.endsWith('L') ? -1 : 1;
    const { centre } = wheelNodes[i].userData as { centre: V3 };
    const wheel = add(id, label, 'wheels', [0, 0, side * 0.6], (mats) => {
      if (id === 'wheelRL') rearWheelY = centre[1];
      const spinner = mountWheel(wheelNodes[i] as THREE.Mesh, new THREE.Vector3(...centre), mats);
      spinners.push(spinner);
      for (const hub of hubs[i]) finish(hub, mats, 'rim');
      return wrap(id, spinner, ...hubs[i]);
    }, { dropShare: 0 });
    car.brakes.mount(wheel, spinners[i], new THREE.Vector3(...centre), id.startsWith('wheelF') ? 'front' : 'rear', side);
  });

  // The rear crash structure is bolted to the gearbox, so it rides with it.
  const powerUnit = add('powerUnit', 'Power unit', 'powertrain', [0, 0.42, 0], (m) => fitted(buildPowerUnit, FITS.powerUnit, m), { exterior: false });
  const battery = add('battery', 'Battery', 'powertrain', [0, 0.6, 0], (m) => fitted(buildBattery, FITS.battery, m), { exterior: false });
  const gearbox = add('gearbox', 'Gearbox', 'powertrain', [-0.3, 0.22, 0], (m) => {
    const g = fitted(buildGearbox, FITS.gearbox, m);
    const tail = node('rearStructure');
    finish(tail, m, 'carbonLight');
    g.add(tail);
    return g;
  });
  add('driver', 'Driver', 'driver', [0, 0.24, 0], (m) => fitted(buildDriver, FITS.driver, m));

  car.root.updateMatrixWorld(true);
  const meshes = (id: PartId) => meshesOf(car.parts.get(id)!.object);
  const cell = car.parts.get('survivalCell')!.object;
  const floor = car.parts.get('floor')!.object;
  const bodywork = car.parts.get('bodywork')!.object;

  const wingAnchor = (id: 'frontWing' | 'rearWing', cpX: number): THREE.Vector3 => {
    const fixed = mainplanes.get(id)!; // the mainplane, not the flap that moves
    const [x0, x1] = chordNear(fixed, cpX, MIN_CHORD);
    const inset = (x1 - x0) * 0.25;
    const x = THREE.MathUtils.clamp(cpX, x0 + inset, x1 - inset);
    return new THREE.Vector3(x, topSurfaceY(fixed, x)!, 0);
  };
  const surfaces = Object.fromEntries(ESTIMATES.surfaces.map((s) => [s.id, s.cpX])) as Record<string, number>;
  const floorX = surfaces.floor;
  const anchors: CarAnchors = {
    frontWingCP: anchor(car.parts.get('frontWing')!.object, 'frontWingCP', wingAnchor('frontWing', surfaces.frontWing)),
    floorCP: anchor(floor, 'floorCP', { x: floorX, y: topSurfaceY(meshes('floor'), floorX)!, z: 0 }),
    rearWingCP: anchor(car.parts.get('rearWing')!.object, 'rearWingCP', wingAnchor('rearWing', surfaces.rearWing)),
    cg: anchor(cell, 'cg', { x: CAR_FRAME.cgX, y: ESTIMATES.cgHeightM, z: 0 }),
    dragOrigin: anchor(floor, 'dragOrigin', { x: -2.62, y: 0.45, z: 0 }),
    floorArrowEntry: anchor(bodywork, 'floorArrowEntry', { x: floorX, y: topSurfaceY(meshes('bodywork'), floorX)!, z: 0 }),
    engine: anchor(powerUnit, 'engine', fitPoint(ENGINE_CENTRE, FITS.powerUnit)),
    mguK: anchor(powerUnit, 'mguK', fitPoint(MGUK_CENTRE, FITS.powerUnit)),
    battery: anchor(battery, 'battery', fitPoint(BATTERY_CENTRE, FITS.battery)),
    rearAxle: anchor(gearbox, 'rearAxle', { x: AXLE_X.rear, y: rearWheelY, z: 0 }),
  };

  return car.toModel({
    anchors,
    shell: SHELL,
    spinners,
    setActiveAero(k) {
      for (const { hinged, openDeg } of active) {
        hinged.pivot.quaternion.setFromAxisAngle(hinged.axis, THREE.MathUtils.degToRad(openDeg * k));
      }
    },
  });
}
