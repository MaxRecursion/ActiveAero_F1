/**
 * Crude stand-in for the procedural car (boxes and planes), implementing the CarModel contract
 * with anchors at the documented positions. Lets effects be built and checked before the real
 * car exists. Never import this from src/.
 */
import * as THREE from 'three';
import { PALETTE } from '../src/scene/palette';
import type { CarAnchors, CarModel, CarPart, PartId } from '../src/scene/car/types';

type Box = [x0: number, x1: number, y0: number, y1: number, width: number];

export function createMockCar(): CarModel {
  const root = new THREE.Group();
  root.name = 'mockCar';
  const clay = new THREE.MeshStandardMaterial({ color: PALETTE.clay, roughness: 0.85 });
  const carbon = new THREE.MeshStandardMaterial({ color: PALETTE.carbon, roughness: 0.55 });
  const tyre = new THREE.MeshStandardMaterial({ color: PALETTE.tyre, roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: PALETTE.metal, roughness: 0.5, metalness: 0.4 });
  const discs = { front: new THREE.MeshStandardMaterial({ color: PALETTE.disc }), rear: new THREE.MeshStandardMaterial({ color: PALETTE.disc }) };
  const geometries: THREE.BufferGeometry[] = [];
  const exteriorMeshes: THREE.Mesh[] = [];
  const parts = new Map<PartId, CarPart>();

  function part(id: PartId, label: string, group: CarPart['group'], offset: THREE.Vector3Tuple) {
    const object = new THREE.Group();
    object.name = id;
    root.add(object);
    parts.set(id, { id, label, group, object, explodeOffset: new THREE.Vector3(...offset) });
    return object;
  }
  function box(parent: THREE.Object3D, [x0, x1, y0, y1, w]: Box, mat: THREE.Material, exterior = true) {
    const geo = new THREE.BoxGeometry(x1 - x0, y1 - y0, w);
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    if (exterior) exteriorMeshes.push(mesh);
    return mesh;
  }
  function anchor(parent: THREE.Object3D, x: number, y: number, z = 0) {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  }

  const floor = part('floor', 'Floor', 'aero', [0, 0, 0]);
  box(floor, [-2.0, 1.45, 0.03, 0.06, 1.5], carbon);
  const cell = part('survivalCell', 'Survival cell', 'chassis', [0, 0.9, 0]);
  box(cell, [-0.7, 1.2, 0.1, 0.62, 0.62], clay);
  const nose = part('nose', 'Nose', 'chassis', [0.5, 0.9, 0]);
  box(nose, [1.2, 2.72, 0.2, 0.46, 0.3], clay);
  const body = part('bodywork', 'Bodywork', 'chassis', [0, 0.9, 0]);
  box(body, [-1.5, 0.55, 0.1, 0.55, 1.3], clay);
  box(body, [-1.9, -0.05, 0.1, 0.75, 0.5], clay);
  box(body, [-0.4, 0.05, 0.62, 0.95, 0.3], clay);
  const fw = part('frontWing', 'Front wing', 'aero', [0.7, 0, 0]);
  box(fw, [2.2, 2.7, 0.17, 0.2, 1.8], carbon);
  for (const z of [0.9, -0.9]) box(fw, [2.1, 2.72, 0.06, 0.34, 0.02], carbon).position.z = z;
  const rw = part('rearWing', 'Rear wing', 'aero', [-0.6, 0.4, 0]);
  box(rw, [-2.55, -2.05, 0.9, 0.95, 1.0], carbon);
  for (const z of [0.5, -0.5]) box(rw, [-2.6, -2.0, 0.5, 1.02, 0.02], carbon).position.z = z;

  // Powertrain inside the shell (seen with the X-ray), at the real car's positions.
  const pu = part('powerUnit', 'Power unit', 'powertrain', [0, 0.42, 0]);
  box(pu, [-1.42, -0.84, 0.1, 0.52, 0.36], metal, false);
  box(pu, [-1.11, -0.87, 0.09, 0.22, 0.14], carbon, false).position.z = 0.215; // MGU-K
  const battery = part('battery', 'Battery', 'powertrain', [0, 0.6, 0]);
  box(battery, [-0.74, -0.26, 0.08, 0.22, 0.36], carbon, false);
  const gearbox = part('gearbox', 'Gearbox', 'powertrain', [-0.3, 0.22, 0]);
  box(gearbox, [-2.36, -1.42, 0.2, 0.44, 0.2], carbon);

  const brakeMeshes: THREE.Mesh[] = [];
  const wheelIds: PartId[] = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];
  const wheels = wheelIds.map((id) => {
    const front = id.startsWith('wheelF');
    const left = id.endsWith('L');
    const r = front ? 0.3525 : 0.355;
    const w = front ? 0.28 : 0.375;
    const z = (left ? 1 : -1) * (0.95 - w / 2);
    const obj = part(id, id, 'wheels', [0, 0, (left ? 1 : -1) * 0.5]);
    const geo = new THREE.CylinderGeometry(r, r, w, 32).rotateX(Math.PI / 2);
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, tyre);
    mesh.position.set(front ? 1.7 : -1.7, r, z);
    mesh.castShadow = mesh.receiveShadow = true;
    obj.add(mesh);
    exteriorMeshes.push(mesh);
    const discGeo = new THREE.CylinderGeometry(front ? 0.14 : 0.125, front ? 0.14 : 0.125, 0.03, 24).rotateX(Math.PI / 2);
    geometries.push(discGeo);
    const disc = new THREE.Mesh(discGeo, front ? discs.front : discs.rear);
    disc.position.copy(mesh.position);
    disc.visible = false;
    obj.add(disc);
    brakeMeshes.push(disc);
    return mesh;
  });

  const anchors: CarAnchors = {
    frontWingCP: anchor(fw, 2.4, 0.2),
    floorCP: anchor(floor, -0.15, 0.06),
    rearWingCP: anchor(rw, -2.3, 0.95),
    cg: anchor(cell, -0.17, 0.28),
    dragOrigin: anchor(floor, -2.62, 0.45),
    floorArrowEntry: anchor(body, -0.15, 0.75),
    engine: anchor(pu, -1.13, 0.32),
    mguK: anchor(pu, -0.99, 0.155, 0.215),
    battery: anchor(battery, -0.5, 0.15),
    rearAxle: anchor(gearbox, -1.7, 0.355),
  };

  let explode = 0;
  let pitchAngle = 0;
  let pivotX = 0;
  // Rigid turn of everything but the wheels about the axle line; no clearance handling.
  function place() {
    for (const p of parts.values()) {
      p.object.position.copy(p.explodeOffset).multiplyScalar(explode);
      p.object.rotation.z = 0;
      if (p.group === 'wheels' || pitchAngle === 0) continue;
      const c = Math.cos(pitchAngle);
      const s = Math.sin(pitchAngle);
      p.object.rotation.z = pitchAngle;
      p.object.position.x += pivotX - (c * pivotX - s * 0.355);
      p.object.position.y += 0.355 - (s * pivotX + c * 0.355);
    }
  }

  return {
    root,
    parts,
    anchors,
    exteriorMeshes,
    setExplode(t) {
      explode = t;
      place();
    },
    setWheelSpin(angle) {
      // Rolling forward (+X) turns the wheel clockwise seen from +Z: negative about Z.
      for (const w of wheels) w.rotation.z = -angle;
    },
    setRideHeightDrop() {},
    setPitch(noseDropM, tailRiseM) {
      const total = noseDropM + tailRiseM;
      pitchAngle = total === 0 ? 0 : Math.asin(-total / 3.4);
      pivotX = total === 0 ? 0 : 1.7 - (3.4 * noseDropM) / total;
      place();
    },
    setBrakeTemps(frontC, rearC) {
      for (const [m, c] of [[discs.front, frontC], [discs.rear, rearC]] as const) {
        m.emissive.setRGB(1, 0.35, 0.05);
        m.emissiveIntensity = THREE.MathUtils.clamp((c - 350) / 550, 0, 1) * 2;
      }
    },
    setWheelGhost(t) {
      if (tyre.transparent !== t > 0) tyre.needsUpdate = true;
      tyre.transparent = t > 0;
      tyre.opacity = 1 - 0.75 * t;
      for (const d of brakeMeshes) d.visible = t > 0;
    },
    setActiveAero() {},
    setHighlight() {},
    setLivery() {},
    setXray(t) {
      // The shell is the only clay here: a plain opacity blend is enough for effects work.
      const k = THREE.MathUtils.clamp(t, 0, 1);
      if (clay.transparent !== k > 0) clay.needsUpdate = true;
      clay.transparent = k > 0;
      clay.opacity = 1 - 0.8 * k;
      clay.depthWrite = k < 0.5;
    },
    dispose() {
      root.removeFromParent();
      for (const g of geometries) g.dispose();
      for (const m of [clay, carbon, tyre, metal, discs.front, discs.rear]) m.dispose();
    },
  };
}
