/**
 * Power unit, battery, gearbox and driver for the real-model car. The procedural builders make
 * them for a procedural shell; here each is fitted into the real skin's free volume (measured in
 * scripts/model/process.mjs and checked by loadCar.test.ts): scaled about the origin, then moved.
 */
import * as THREE from 'three';
import type { PartMaterials } from '../materials';

/** A scale about the car origin followed by a translation (car frame, metres). */
export interface Fit {
  scale: THREE.Vector3Tuple;
  move: THREE.Vector3Tuple;
}

export const FITS: Record<'powerUnit' | 'battery' | 'gearbox' | 'driver', Fit> = {
  powerUnit: { scale: [0.77, 1, 0.72], move: [-0.013, 0, 0] },
  battery: { scale: [1, 1, 1], move: [0.12, 0, 0] },
  gearbox: { scale: [0.45, 1, 1], move: [-0.781, 0, 0] },
  driver: { scale: [1, 1, 0.9], move: [0.22, 0.03, 0] },
};

/** A procedural part fitted into the real shell; its wrapper keeps the car origin for explode. */
export function fitted(build: (m: PartMaterials) => THREE.Group, fit: Fit, mats: PartMaterials): THREE.Group {
  const inner = build(mats);
  inner.scale.set(...fit.scale);
  inner.position.set(...fit.move);
  const wrapper = new THREE.Group();
  wrapper.add(inner);
  return wrapper;
}

/** Where a point of the procedural part lands once fitted. */
export const fitPoint = (p: THREE.Vector3, fit: Fit): THREE.Vector3 =>
  p.clone().multiply(new THREE.Vector3(...fit.scale)).add(new THREE.Vector3(...fit.move));
