// @ts-expect-error @types/node is not installed; vitest runs this file under node
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildCar } from './buildCar';
import { assembleCar } from './loadCar';
import { ROTOR } from './parts/brakes';
import type { CarModel, PartId } from './types';

async function real(): Promise<CarModel> {
  const file = readFileSync(new URL('../../../public/models/car.glb', import.meta.url));
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '');
  return assembleCar(gltf.scene);
}

const WHEELS: PartId[] = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];
const SPRUNG: PartId[] = ['survivalCell', 'nose', 'bodywork', 'floor', 'frontWing', 'rearWing', 'halo', 'driver', 'gearbox'];
const ROAD_CLEARANCE = 0.004;

const brakeMeshes = (car: CarModel, id: PartId): THREE.Mesh[] => {
  const found: THREE.Mesh[] = [];
  car.parts.get(id)!.object.traverse((o) => o instanceof THREE.Mesh && /:(rotor|caliper)$/.test(o.name) && found.push(o));
  return found;
};

const lowestY = (car: CarModel, ids: readonly PartId[]): number => {
  car.root.updateMatrixWorld(true);
  const p = new THREE.Vector3();
  let lowest = Infinity;
  for (const id of ids) {
    car.parts.get(id)!.object.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const position = o.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) lowest = Math.min(lowest, p.fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld).y);
    });
  }
  return lowest;
};

const transforms = (car: CarModel): string =>
  [...car.parts.values()].map((p) => `${p.id} ${p.object.position.toArray()} ${p.object.rotation.z}`).join('\n');

const cars: [string, () => CarModel | Promise<CarModel>][] = [
  ['procedural car', buildCar],
  ['real-model car', real],
];

describe.each(cars)('%s brakes', (_name, make) => {
  let car!: CarModel;
  beforeAll(async () => {
    car = await make();
  });

  it('fits a rotor and a caliper to every wheel, out of the exterior meshes', () => {
    for (const id of WHEELS) {
      const names = brakeMeshes(car, id).map((m) => m.name.split(':')[1]);
      expect(names.sort(), id).toEqual(['caliper', 'rotor']);
    }
    for (const m of car.exteriorMeshes) expect(m.name).not.toMatch(/:(rotor|caliper)$/);
  });

  it('draws nothing until the wheels are ghosted', () => {
    const all = WHEELS.flatMap((id) => brakeMeshes(car, id));
    expect(all.every((m) => !m.visible)).toBe(true);
    car.setWheelGhost(0.4);
    expect(all.every((m) => m.visible)).toBe(true);
    car.setWheelGhost(0);
    expect(all.every((m) => !m.visible)).toBe(true);
  });

  it('turns the rotor with the wheel and keeps the caliper still', () => {
    car.setWheelSpin(0);
    car.root.updateMatrixWorld(true);
    const before = WHEELS.map((id) => brakeMeshes(car, id).map((m) => m.getWorldPosition(new THREE.Vector3()).toArray()));
    car.setWheelSpin(1.3);
    car.root.updateMatrixWorld(true);
    WHEELS.forEach((id, i) => {
      for (const [k, m] of brakeMeshes(car, id).entries()) {
        const kind = m.name.split(':')[1];
        expect(m.getWorldPosition(new THREE.Vector3()).toArray(), `${id} ${kind} position`).toEqual(before[i][k]);
        if (kind === 'rotor') expect(m.parent!.rotation.z).toBeCloseTo(-1.3);
        else expect(m.parent!.rotation.z, `${id} caliper`).toBe(0);
      }
    });
    car.setWheelSpin(0);
  });

  it('sizes the rotors 280 mm front and 250 mm rear, inboard of each wheel centre', () => {
    for (const id of WHEELS) {
      const rotor = brakeMeshes(car, id).find((m) => m.name.endsWith(':rotor'))!;
      const box = rotor.geometry.boundingBox ?? rotor.geometry.computeBoundingBox() ?? rotor.geometry.boundingBox!;
      const radius = id.startsWith('wheelF') ? ROTOR.front.radius : ROTOR.rear.radius;
      expect(box.max.x, id).toBeCloseTo(radius, 3);
      car.root.updateMatrixWorld(true);
      const centre = rotor.parent!.getWorldPosition(new THREE.Vector3());
      const disc = rotor.getWorldPosition(new THREE.Vector3());
      expect(Math.abs(disc.z), id).toBeLessThan(Math.abs(centre.z));
      expect(Math.sign(disc.z)).toBe(Math.sign(centre.z));
    }
  });

  it('shares a disc material per axle and lets the axles run at different temperatures', () => {
    const material = (id: PartId) => brakeMeshes(car, id).find((m) => m.name.endsWith(':rotor'))!.material as THREE.MeshStandardMaterial;
    expect(material('wheelFL')).toBe(material('wheelFR'));
    expect(material('wheelRL')).toBe(material('wheelRR'));
    expect(material('wheelFL')).not.toBe(material('wheelRL'));
    car.setBrakeTemps(900, 600);
    expect(material('wheelFL').emissiveIntensity).toBeGreaterThan(material('wheelRL').emissiveIntensity);
    expect(material('wheelFL').emissive.g).toBeGreaterThan(material('wheelRL').emissive.g);
    car.setBrakeTemps(20, 20);
    expect(material('wheelFL').emissiveIntensity).toBe(0);
  });

  it('shows cold discs as matte black carbon, not chrome', () => {
    const m = brakeMeshes(car, 'wheelFR').find((x) => x.name.endsWith(':rotor'))!.material as THREE.MeshStandardMaterial;
    const { h, s, l } = m.color.getHSL({ h: 0, s: 0, l: 0 });
    expect(l).toBeLessThan(0.12);
    expect(s).toBeLessThan(0.3);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(m.metalness).toBeLessThan(0.3);
    expect(m.roughness).toBeGreaterThan(0.5);
  });

  it('leaves the wheels\' extent, and so the drive route, unchanged', () => {
    for (const id of WHEELS) {
      const wheel = car.parts.get(id)!.object;
      wheel.updateMatrixWorld(true);
      const withBrakes = new THREE.Box3().setFromObject(wheel);
      const meshes = brakeMeshes(car, id);
      const parents = meshes.map((m) => m.parent!);
      for (const m of meshes) m.removeFromParent();
      const without = new THREE.Box3().setFromObject(wheel);
      meshes.forEach((m, i) => parents[i].add(m));
      expect(withBrakes.equals(without), id).toBe(true);
    }
  });
});

describe.each(cars)('%s pitch', (_name, make) => {
  let car!: CarModel;
  let neutral = '';
  let neutralLowest = 0;
  beforeAll(async () => {
    car = await make();
    car.root.updateMatrixWorld(true);
    neutral = transforms(car);
    neutralLowest = lowestY(car, SPRUNG);
  });
  const wheelMatrices = () => WHEELS.map((id) => car.parts.get(id)!.object.matrix.toArray().join());

  it('is exactly neutral at (0, 0), also after pitching and coming back', () => {
    car.setPitch(0, 0);
    expect(transforms(car)).toBe(neutral);
    car.setPitch(0.06, 0.072);
    expect(transforms(car)).not.toBe(neutral);
    car.setPitch(0, 0);
    expect(transforms(car)).toBe(neutral);
  });

  it('never moves the wheels', () => {
    const before = wheelMatrices();
    car.setPitch(0.06, 0.072);
    expect(wheelMatrices()).toEqual(before);
    car.setPitch(0, 0);
  });

  it('turns the body rigidly so its axle line dips at the nose and rises at the tail', () => {
    const n = 0.003;
    const t = 0.004;
    car.setPitch(n, t);
    car.root.updateMatrixWorld(true);
    const cell = car.parts.get('survivalCell')!.object;
    const front = new THREE.Vector3(1.7, 0.355, 0).applyMatrix4(cell.matrixWorld);
    const rear = new THREE.Vector3(-1.7, 0.355, 0).applyMatrix4(cell.matrixWorld);
    // Small dives need no lift, so the body dips by exactly what was asked.
    expect(front.y).toBeCloseTo(0.355 - n, 6);
    expect(rear.y).toBeCloseTo(0.355 + t, 6);
    car.setPitch(0, 0);
  });

  it('moves the suspension half as far as the body, and the anchors with their parts', () => {
    car.setPitch(0.06, 0.072);
    car.root.updateMatrixWorld(true);
    const rotation = (id: PartId) => car.parts.get(id)!.object.rotation.z;
    expect(rotation('suspensionFront')).toBeCloseTo(rotation('survivalCell') / 2, 9);
    expect(rotation('survivalCell')).toBeLessThan(0);
    const cg = car.anchors.cg.getWorldPosition(new THREE.Vector3());
    expect(cg.y).toBeGreaterThan(0.28);
    car.setPitch(0, 0);
    expect(car.anchors.cg.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(0.28, 6);
  });

  it('keeps every part of the body off the road at the full exaggerated dive', () => {
    car.setPitch(0.06, 0.072);
    expect(lowestY(car, SPRUNG)).toBeGreaterThanOrEqual(Math.min(ROAD_CLEARANCE, neutralLowest) - 1e-6);
    car.setRideHeightDrop(0.015);
    expect(lowestY(car, SPRUNG)).toBeGreaterThanOrEqual(Math.min(ROAD_CLEARANCE, neutralLowest - 0.015) - 1e-6);
    car.setRideHeightDrop(0);
    car.setPitch(0, 0);
  });

  it('adds to explode and to ride-height drop, and each still undoes itself', () => {
    const nose = car.parts.get('nose')!;
    car.setPitch(0.06, 0.072);
    const pitched = nose.object.position.clone();
    car.setExplode(1);
    const moved = nose.object.position.clone().sub(pitched);
    expect(moved.distanceTo(nose.explodeOffset)).toBeLessThan(1e-9);
    car.setExplode(0);
    expect(nose.object.position.distanceTo(pitched)).toBeLessThan(1e-9);
    car.setRideHeightDrop(0.01);
    expect(lowestY(car, SPRUNG)).toBeGreaterThanOrEqual(Math.min(ROAD_CLEARANCE, neutralLowest - 0.01) - 1e-6);
    car.setPitch(0, 0);
    car.setRideHeightDrop(0);
    expect(transforms(car)).toBe(neutral);
  });
});

describe.each(cars)('%s wheel ghost', (_name, make) => {
  let car!: CarModel;
  beforeAll(async () => {
    car = await make();
  });

  it('ghosts tyres and rims into faint transparent finishes and restores the solid ones', () => {
    const materialsOf = () => {
      const list: THREE.Material[] = [];
      for (const id of WHEELS) {
        car.parts.get(id)!.object.traverse((o) => {
          if (!(o instanceof THREE.Mesh) || /:(rotor|caliper)$/.test(o.name)) return;
          list.push(...(Array.isArray(o.material) ? o.material : [o.material]));
        });
      }
      return list;
    };
    const solid = materialsOf();
    expect(solid.every((m) => !m.transparent)).toBe(true);
    car.setWheelGhost(1);
    const ghost = materialsOf();
    expect(ghost.every((m) => m.transparent && m.opacity < 0.5), 'faint').toBe(true);
    expect(Math.max(...ghost.map((m) => m.opacity)), 'a tyre stays a ring').toBeGreaterThan(0.3);
    car.setWheelGhost(0);
    expect(materialsOf()).toEqual(solid);
  });

  it('stops the ghost casting a shadow, and hides it from override passes', () => {
    const tyres: THREE.Mesh[] = [];
    car.parts.get('wheelFR')!.object.traverse((o) => o instanceof THREE.Mesh && !/:(rotor|caliper)$/.test(o.name) && tyres.push(o));
    car.setWheelGhost(1);
    expect(tyres.every((m) => !m.castShadow)).toBe(true);
    const geometry = tyres[0].geometry;
    const override = { overrideMaterial: new THREE.MeshBasicMaterial() } as unknown as THREE.Scene;
    tyres[0].onBeforeRender({} as THREE.WebGLRenderer, override, {} as THREE.Camera, geometry, tyres[0].material as THREE.Material, null as unknown as THREE.Group);
    expect(geometry.drawRange.count).toBe(0);
    car.setWheelGhost(0);
    expect(tyres.every((m) => m.castShadow)).toBe(true);
  });
});
