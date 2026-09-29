/**
 * Finishes for the clay wind-tunnel model. Each part gets its own material instances so that
 * highlighting can tint one part without touching the rest; three.js shares the compiled shader
 * programs between them, so the cost is only a few uniforms.
 */
import * as THREE from 'three';
import { PALETTE } from '../palette';

export type MatKey =
  'clay' | 'clayDark' | 'carbon' | 'carbonLight' | 'tyre' | 'rim' | 'metal' | 'engine' | 'helmet' | 'visor';

interface Spec extends THREE.MeshStandardMaterialParameters {
  /** Geometry carries per-vertex tints multiplied onto `color` (dark cockpit, intakes, sidewalls). */
  vertexColors?: boolean;
}

const SPECS: Record<MatKey, Spec> = {
  clay: { color: PALETTE.clay, roughness: 0.74, vertexColors: true },
  clayDark: { color: PALETTE.clayDark, roughness: 0.78 },
  carbon: { color: PALETTE.carbon, roughness: 0.5, metalness: 0.08 },
  carbonLight: { color: PALETTE.carbonLight, roughness: 0.58, metalness: 0.05 },
  tyre: { color: 0xffffff, roughness: 0.9, vertexColors: true },
  rim: { color: PALETTE.rim, roughness: 0.4, metalness: 0.55 },
  metal: { color: PALETTE.metal, roughness: 0.3, metalness: 0.75 },
  engine: { color: PALETTE.metal, roughness: 0.48, metalness: 0.45 },
  helmet: { color: PALETTE.helmet, roughness: 0.3 },
  visor: { color: PALETTE.visor, roughness: 0.08, metalness: 0.5 },
};

export const isVertexColoured = (key: MatKey): boolean => SPECS[key].vertexColors === true;

/** Tint for dark areas of clay geometry (cockpit well, intake mouths): carbon over clay, per channel. */
export const CLAY_SHADOW_TINT = (() => {
  const clay = new THREE.Color(PALETTE.clay);
  const dark = new THREE.Color(PALETTE.carbon);
  return new THREE.Color(dark.r / clay.r, dark.g / clay.g, dark.b / clay.b);
})();

export type Emphasis = 'none' | 'on' | 'faded';

/**
 * X-ray: face opacity of a fully ghosted shell and the smoked-clay tone it turns to. The studio is
 * bright enough that tone mapping flattens a lighter veil, so the ghost darkens a little instead.
 */
const GHOST_ALPHA = 0.22;
const GHOST_TONE = new THREE.Color(0x55524c);

/**
 * A see-through twin of a finish: smoked glass whose grazing faces thicken into a darker outline,
 * so the silhouette still reads while the power unit behind stays crisp. `ghost` (0–1) blends it
 * in from the plain finish; every ghost shares one program.
 */
function createGhost(spec: Spec): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ ...spec, transparent: true });
  const amount = { value: 0 };
  m.userData.ghost = amount;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.ghost = amount;
    shader.uniforms.ghostTone = { value: GHOST_TONE };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float ghost;\nuniform vec3 ghostTone;')
      .replace(
        '#include <opaque_fragment>',
        `float ghostEdge = 1.0 - abs(dot(normalize(vViewPosition), normal));
        outgoingLight = mix(outgoingLight, ghostTone, ghost * (0.88 + 0.12 * ghostEdge));
        diffuseColor.a = mix(diffuseColor.a, 1.0, ghost * ghostEdge * 0.8);
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'car-ghost';
  return m;
}

const EMPHASIS_ON = new THREE.Color(PALETTE.downforce);
const EMPHASIS_FADED = new THREE.Color(PALETTE.background);

export class PartMaterials {
  private readonly byKey = new Map<MatKey, THREE.MeshStandardMaterial>();
  private readonly ghosts = new Map<THREE.Material, THREE.MeshStandardMaterial>();

  get(key: MatKey): THREE.MeshStandardMaterial {
    let m = this.byKey.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial(SPECS[key]);
      this.byKey.set(key, m);
    }
    return m;
  }

  /** The X-ray twin of one of this set's materials (created on first use). */
  ghostOf(solid: THREE.Material): THREE.MeshStandardMaterial {
    let g = this.ghosts.get(solid);
    if (!g) {
      const key = [...this.byKey].find(([, m]) => m === solid)?.[0];
      if (!key) throw new Error('car: ghostOf() needs a material from this set');
      g = createGhost(SPECS[key]);
      this.ghosts.set(solid, g);
    }
    return g;
  }

  /**
   * Fade the ghosts: 0 = opaque (identical to the solid finish) … 1 = faint smoked shell.
   * While mostly opaque they still write depth, so the shell cannot show its own far side.
   */
  setGhost(t: number): void {
    for (const g of this.ghosts.values()) {
      g.opacity = THREE.MathUtils.lerp(1, GHOST_ALPHA, t);
      g.depthWrite = t < 0.5;
      (g.userData.ghost as { value: number }).value = t;
    }
  }

  /** 'on' glows faintly in the downforce blue; 'faded' washes toward the studio background. */
  setEmphasis(mode: Emphasis): void {
    for (const m of [...this.byKey.values(), ...this.ghosts.values()]) {
      if (mode === 'none') m.emissive.setRGB(0, 0, 0);
      else m.emissive.copy(mode === 'on' ? EMPHASIS_ON : EMPHASIS_FADED);
      m.emissiveIntensity = mode === 'on' ? 0.32 : mode === 'faded' ? 0.28 : 1;
    }
  }

  dispose(): void {
    for (const m of [...this.byKey.values(), ...this.ghosts.values()]) m.dispose();
    this.byKey.clear();
    this.ghosts.clear();
  }
}
