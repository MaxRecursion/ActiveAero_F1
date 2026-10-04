/**
 * Turns the clay shell into a team scheme and back.
 *
 * Which panels take paint: the nose, survival cell, bodywork, both wings and the halo get the
 * pattern; the rims and the helmet get the scheme's tint. The floor, suspension, tyres, brakes
 * and power unit are never touched.
 *
 * The pattern is looked up from each vertex's position in the assembled car (`paintPos`, with its
 * normal as `paintNrm`), written once while the car is still assembled. After that the position
 * is just vertex data: explode, ride-height pitch, the opening flaps, the spinning wheels and the
 * ceiling flip all move the vertices and the paint goes with them.
 */
import * as THREE from 'three';
import type { MatKey, PartMaterials } from '../materials';
import type { LiveryId, PartId } from '../types';
import { PART, type PaintPart } from './glsl/common';
import { type SchemeId, SCHEMES } from './schemes';
import { paintMaterial, restoreMaterial } from './shader';

interface Entry {
  id: PartId;
  object: THREE.Object3D;
  materials: PartMaterials;
}

interface Painted {
  key: MatKey;
  part: PaintPart;
}

const BODY: Partial<Record<PartId, Painted>> = {
  nose: { key: 'shellClay', part: PART.nose },
  survivalCell: { key: 'shellClay', part: PART.cell },
  bodywork: { key: 'shellClay', part: PART.body },
  frontWing: { key: 'carbon', part: PART.frontWing },
  rearWing: { key: 'carbon', part: PART.rearWing },
  halo: { key: 'metal', part: PART.halo },
  wheelFL: { key: 'rim', part: PART.rim },
  wheelFR: { key: 'rim', part: PART.rim },
  wheelRL: { key: 'rim', part: PART.rim },
  wheelRR: { key: 'rim', part: PART.rim },
  driver: { key: 'helmet', part: PART.helmet },
};

const meshMaterials = (mesh: THREE.Mesh): THREE.Material[] => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]);

/**
 * Write each paintable vertex's assembled-car position and normal into the geometry. Call once,
 * from the finished rig, before anything moves. The clay finish does not read these attributes,
 * so they change nothing until a scheme is chosen.
 */
export function prepareLivery(entries: readonly Entry[]): void {
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (const entry of entries) {
    const painted = BODY[entry.id];
    if (!painted) continue;
    const ours = new Set<THREE.Material>(entry.materials.materialsFor(painted.key));
    entry.object.updateWorldMatrix(true, true);
    entry.object.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !meshMaterials(o).some((m) => ours.has(m))) return;
      const geometry = o.geometry as THREE.BufferGeometry;
      if (geometry.getAttribute('paintPos')) return;
      const position = geometry.getAttribute('position');
      const normal = geometry.getAttribute('normal');
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
      const pos = new Float32Array(position.count * 3);
      const nrm = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) {
        p.fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld);
        pos[i * 3] = p.x;
        pos[i * 3 + 1] = p.y;
        pos[i * 3 + 2] = p.z;
        if (normal) n.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
        if (!normal || n.lengthSq() < 1e-8) n.set(0, 1, 0);
        nrm[i * 3] = n.x;
        nrm[i * 3 + 1] = n.y;
        nrm[i * 3 + 2] = n.z;
      }
      geometry.setAttribute('paintPos', new THREE.BufferAttribute(pos, 3));
      geometry.setAttribute('paintNrm', new THREE.BufferAttribute(nrm, 3));
    });
  }
}

/** Clay, or one of the team schemes. Safe to call again with a different id. */
export function applyLivery(entries: readonly Entry[], id: LiveryId | 'debug'): void {
  const scheme = id === 'clay' ? undefined : SCHEMES[id as SchemeId];
  for (const entry of entries) {
    const painted = BODY[entry.id];
    if (!painted) continue;
    for (const material of entry.materials.materialsFor(painted.key)) {
      if (scheme) paintMaterial(material, { scheme: id, glsl: scheme.glsl, part: painted.part });
      else restoreMaterial(material);
    }
  }
}
