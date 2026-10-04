/**
 * Dev page: the car (the real model by default, ?procedural=1 for the procedural one) on a plain floor.
 * Params: ?explode=0..1 &aero=0..1 &xray=0..1 &spin=radians &drop=metres &highlight=frontWing,floor
 *         &anchors=1 (coloured spheres at every anchor) &hide=bodywork,… &view=… (see harness)
 *         &cam=px,py,pz,tx,ty,tz (a custom camera for close-ups)
 *         &tunnel=1 (the wind-tunnel studio and rolling road instead of a plain floor)
 */
import * as THREE from 'three';
import { createHarness, num, params } from './harness';
import { buildCar } from '../src/scene/car/buildCar';
import { loadCar } from '../src/scene/car/loadCar';
import { createWindTunnel } from '../src/scene/effects/tunnel';
import { PALETTE } from '../src/scene/palette';
import type { CarAnchors, LiveryId, PartId } from '../src/scene/car/types';

const inTunnel = params.get('tunnel') === '1';
// Load before the harness starts so its ready flag means the car is on screen.
const t0 = performance.now();
const car = params.get('procedural') === '1' ? buildCar() : await loadCar();
const loadMs = Math.round(performance.now() - t0);
const stage = createHarness({ plainFloor: !inTunnel });
stage.scene.add(car.root);
if (inTunnel) {
  const tunnel = createWindTunnel();
  stage.scene.add(tunnel.studio, tunnel.road);
}

const cam = params.get('cam')?.split(',').map(Number);
if (cam?.length === 6) void stage.controls.setLookAt(cam[0], cam[1], cam[2], cam[3], cam[4], cam[5], false);

const ids = (key: string) => (params.get(key)?.split(',').filter(Boolean) ?? []) as PartId[];

car.setExplode(num('explode', 0));
car.setActiveAero(num('aero', 0));
car.setXray(num('xray', 0));
car.setLivery((params.get('livery') ?? 'clay') as LiveryId);
car.setWheelSpin(num('spin', 0));
car.setRideHeightDrop(num('drop', 0));
const highlight = ids('highlight');
car.setHighlight(highlight.length ? highlight : null);
for (const id of ids('hide')) {
  const part = car.parts.get(id);
  if (part) part.object.visible = false;
}

if (params.get('anchors') === '1') {
  const colours: Record<keyof CarAnchors, number> = {
    frontWingCP: 0x2356f6,
    floorCP: 0x2356f6,
    rearWingCP: 0x2356f6,
    cg: 0x2a2c31,
    dragOrigin: 0xf2551d,
    floorArrowEntry: 0x19a974,
    engine: PALETTE.engine,
    mguK: PALETTE.energy,
    battery: PALETTE.energy,
    rearAxle: PALETTE.engine,
  };
  const geometry = new THREE.SphereGeometry(0.035, 16, 12);
  for (const [name, colour] of Object.entries(colours) as [keyof CarAnchors, number][]) {
    const dot = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: colour, depthTest: false }));
    dot.renderOrder = 10;
    car.anchors[name].add(dot);
  }
}

// Budget report: triangles and meshes (one draw call each in the main pass).
let triangles = 0;
let meshes = 0;
car.root.traverse((o) => {
  if (!(o instanceof THREE.Mesh)) return;
  meshes++;
  const g = o.geometry as THREE.BufferGeometry;
  triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
});
car.root.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(car.root);
const fmt = (v: THREE.Vector3) =>
  v
    .toArray()
    .map((n) => n.toFixed(2))
    .join(', ');
console.info(
  `[car] loaded in ${loadMs} ms: ${Math.round(triangles)} triangles, ${meshes} meshes (draw calls), ` +
    `${car.exteriorMeshes.length} exterior; bounds min (${fmt(box.min)}) max (${fmt(box.max)})`,
);
const anchorWorld = Object.entries(car.anchors).map(([name, o]) => `${name} (${fmt(o.getWorldPosition(new THREE.Vector3()))})`);
console.info(`[car] anchors: ${anchorWorld.join('; ')}`);
