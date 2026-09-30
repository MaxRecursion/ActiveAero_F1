/**
 * Ghosting: a set of parts swaps to their ghost materials so what is behind them shows through.
 * Station 3 ghosts the shell (power unit, battery and gearbox inside); Station 4 ghosts the wheels
 * (the discs and calipers inside). Meshes keep their geometry and only swap between cached
 * materials (a mesh with a material array swaps each entry), so the draw-call count never changes.
 * Meshes whose materials the set does not own (the brake hardware, arrows) stay as they are.
 */
import * as THREE from 'three';
import type { PartMaterials } from './materials';

/** Above this the ghost stops casting shadows and stops occluding ambient occlusion. */
const SOLID_UNTIL = 0.3;

type Mat = THREE.Material | THREE.Material[];

interface Swap {
  mesh: THREE.Mesh;
  solid: Mat;
  ghost: Mat;
}

export class GhostSwap {
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
        if (!(o instanceof THREE.Mesh)) return;
        const solid = o.material as Mat;
        const list = Array.isArray(solid) ? solid : [solid];
        if (!list.every((m) => materials.owns(m))) return;
        const ghost = Array.isArray(solid) ? solid.map((m) => materials.ghostOf(m)) : materials.ghostOf(solid);
        this.swaps.push({ mesh: o, solid, ghost });
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
