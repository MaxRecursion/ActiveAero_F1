/**
 * Collects a part's sub-pieces and merges them into one mesh per material, so the whole car stays
 * within a few dozen draw calls. Every piece is normalised to the same attribute layout
 * (non-indexed position + normal, plus colour for vertex-tinted finishes) so they can merge.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { creased, mirrorZ } from './geometry/primitives';
import { isVertexColoured, type MatKey, type PartMaterials } from './materials';

/** Crease angle (degrees) for smooth bodies: curved panels blend, real edges stay crisp. */
export const SMOOTH = 42;

export class PieceSet {
  private readonly byKey = new Map<MatKey, THREE.BufferGeometry[]>();

  /**
   * Add a piece. `crease` = degrees for re-computed normals, or false to keep the geometry's own
   * normals (primitives that are already correctly smooth, e.g. rounded boxes and spheres).
   */
  add(key: MatKey, geometry: THREE.BufferGeometry, crease: number | false = SMOOTH): this {
    let g = geometry;
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
    }
    if (crease === false) {
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      if (g.index) {
        const flat = g.toNonIndexed();
        g.dispose();
        g = flat;
      }
    } else {
      g = creased(g, crease);
    }
    const wantsColour = isVertexColoured(key);
    if (wantsColour && !g.getAttribute('color')) {
      g.setAttribute(
        'color',
        new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3),
      );
    } else if (!wantsColour && g.getAttribute('color')) {
      g.deleteAttribute('color');
    }
    const list = this.byKey.get(key) ?? [];
    list.push(g);
    this.byKey.set(key, list);
    return this;
  }

  /** Add a right-side (+z) piece and its mirror image on the left. */
  addPair(key: MatKey, geometry: THREE.BufferGeometry, crease: number | false = SMOOTH): this {
    this.add(key, mirrorZ(geometry), crease);
    return this.add(key, geometry, crease);
  }

  /** Merge into meshes (one per material) and parent them to `parent`. */
  build(parent: THREE.Object3D, materials: PartMaterials): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const [key, list] of this.byKey) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) throw new Error(`car: could not merge ${key} pieces`);
      if (merged !== list[0]) for (const g of list) g.dispose();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, materials.get(key));
      mesh.name = `${parent.name}:${key}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.byKey.clear();
    return meshes;
  }
}
