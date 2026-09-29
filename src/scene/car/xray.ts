/**
 * X-ray (Station 3): the shell parts swap to their ghost materials so the power unit, battery and
 * gearbox show through. Meshes keep their geometry and only swap between two cached materials,
 * so the draw-call count never changes.
 */
import * as THREE from 'three';
import type { PartMaterials } from './materials';

/** Above this the shell stops casting shadows and stops occluding ambient occlusion. */
const SOLID_UNTIL = 0.3;

interface Swap {
  mesh: THREE.Mesh;
  solid: THREE.Material;
  ghost: THREE.Material;
}

export class XrayShell {
  private readonly swaps: Swap[] = [];
  private readonly sets: PartMaterials[] = [];
  private seeThrough = false;

  constructor(parts: readonly { object: THREE.Object3D; materials: PartMaterials }[]) {
    // Override passes (the AO g-buffer) would otherwise treat the ghost as an opaque wall and
    // darken everything seen through it; drawing nothing there is cheaper than a layer setup.
    const hideInOverridePasses: THREE.Object3D['onBeforeRender'] = (_r, scene, _c, geometry) => {
      geometry.drawRange.count = this.seeThrough && scene.overrideMaterial ? 0 : Infinity;
    };
    for (const { object, materials } of parts) {
      this.sets.push(materials);
      object.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || Array.isArray(o.material)) return;
        const solid = o.material as THREE.Material;
        this.swaps.push({ mesh: o, solid, ghost: materials.ghostOf(solid) });
        o.onBeforeRender = hideInOverridePasses;
      });
    }
  }

  set(t: number): void {
    const k = THREE.MathUtils.clamp(t, 0, 1);
    this.seeThrough = k > SOLID_UNTIL;
    for (const s of this.sets) s.setGhost(k);
    for (const { mesh, solid, ghost } of this.swaps) {
      mesh.material = k > 0 ? ghost : solid;
      mesh.castShadow = !this.seeThrough;
    }
  }
}
