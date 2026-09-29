// @ts-expect-error @types/node is not installed; vitest runs this file under node
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { describe, expect, it } from 'vitest';
import { assembleCar } from './loadCar';
import type { CarModel, PartId } from './types';

async function load(): Promise<CarModel> {
  const file = readFileSync(new URL('../../../public/models/car.glb', import.meta.url));
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '');
  return assembleCar(gltf.scene);
}

const car = await load();
describe('real-model car', () => {
  it('has every part of the contract', () => {
    for (const id of ['survivalCell', 'nose', 'bodywork', 'floor', 'frontWing', 'rearWing', 'halo', 'driver', 'wheelFL', 'wheelFR', 'wheelRL', 'wheelRR', 'suspensionFront', 'suspensionRear', 'powerUnit', 'battery', 'gearbox'] as PartId[]) {
      expect(car.parts.has(id), id).toBe(true);
    }
  });

  it('keeps the power unit, battery and gearbox inside the skin', () => {
    car.root.updateMatrixWorld(true);
    const skin: THREE.Mesh[] = [];
    for (const id of ['nose', 'bodywork', 'survivalCell', 'floor'] as PartId[]) {
      car.parts.get(id)!.object.traverse((o) => o instanceof THREE.Mesh && skin.push(o));
    }
    const ray = new THREE.Raycaster();
    const v = new THREE.Vector3();
    // Behind x = -1.45 the tail is open (the gearbox and crash structure reach out of the bodywork).
    const TAIL_X = -1.45;
    // A point inside the closed shell has skin beyond it to the left, the right and above.
    const enclosed = (p: THREE.Vector3): boolean =>
      [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)].every((d) => {
        ray.set(p, d);
        return ray.intersectObjects(skin, false).length > 0;
      });
    for (const id of ['powerUnit', 'battery', 'gearbox'] as PartId[]) {
      const outside: string[] = [];
      car.parts.get(id)!.object.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const position = o.geometry.getAttribute('position');
        for (let i = 0; i < position.count; i += 100) {
          v.fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld);
          if (v.x > TAIL_X && !enclosed(v)) outside.push(v.toArray().map((n) => n.toFixed(2)).join(','));
        }
      });
      expect(outside.length, `${id} pokes through the skin at ${outside.slice(0, 6).join(' | ')}`).toBe(0);
    }
  }, 30_000);

  it('puts each aero anchor on its real surface', () => {
    car.root.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    const { frontWingCP, floorCP, rearWingCP } = car.anchors;
    expect(frontWingCP.getWorldPosition(p).x).toBeGreaterThan(2.6);
    expect(p.y).toBeCloseTo(0.134, 1);
    expect(floorCP.getWorldPosition(p).y).toBeCloseTo(0.031, 2); // the floor is a single sheet under the tub
    expect(rearWingCP.getWorldPosition(p).x).toBeLessThan(-1.88);
    expect(p.y).toBeCloseTo(0.802, 1);
  });

  it('stays inside the explode envelope', () => {
    car.setExplode(1);
    const box = new THREE.Box3().setFromObject(car.root, true);
    expect(box.min.x).toBeGreaterThanOrEqual(-4.3);
    expect(box.max.x).toBeLessThanOrEqual(4.3);
    expect(box.max.y).toBeLessThanOrEqual(2.6);
    expect(Math.max(box.max.z, -box.min.z)).toBeLessThanOrEqual(2.3);
    car.setExplode(0);
  });
});
