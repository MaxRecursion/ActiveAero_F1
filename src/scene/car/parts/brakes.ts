/**
 * Brake hardware: a drilled carbon-carbon rotor that turns with each wheel and a caliper that
 * does not, one pair per wheel, inside the wheel. Both cars use the same builder; it is only
 * visible while the wheels are ghosted (from outside, the rim hides it), so it costs no draw
 * calls the rest of the time.
 *
 * The two discs of an axle share one material, so the disc temperature is two uniforms.
 * Cold, carbon-carbon is matte black; hot, it glows through the colours of heated metal.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '../../palette';
import { creased, mirrorZ, roundedBox } from '../geometry/primitives';

export type Axle = 'front' | 'rear';

interface RotorSize {
  /** Outer radius of the friction ring, m. */
  radius: number;
  /** Radial width of the friction ring, m. */
  ring: number;
  thickness: number;
  /** Drilled rows: how many holes in each, from the inside out. */
  holes: readonly number[];
}

/** Front discs are 280 mm across and the rears 250 mm; the rows and hole counts are for looks only. */
export const ROTOR: Record<Axle, RotorSize> = {
  front: { radius: 0.14, ring: 0.052, thickness: 0.032, holes: [24, 28, 32] },
  rear: { radius: 0.125, ring: 0.048, thickness: 0.028, holes: [22, 26, 30] },
};

/** How far the disc sits toward the car's centre line from the wheel's middle plane, m. */
const DISC_INBOARD = 0.05;
const HOLE_RADIUS = 0.0052;
const HOLE_SIDES = 8;
const RING_SEGMENTS = 72;
/** Bell height beyond the friction ring's outer face, m. */
const BELL_HEIGHT = 0.045;
const BELL_WALL = 0.006;
const BELL_HUB_RADIUS = 0.034;
/** Where each axle's caliper sits round the disc: degrees from +X (forward), counter-clockwise seen from the right. */
const CALIPER_ANGLE_DEG: Record<Axle, number> = { front: 158, rear: 24 };

/** Colours, in linear light, and how bright they glow: one row per disc temperature. */
const GLOW: readonly { tempC: number; rgb: readonly [number, number, number]; intensity: number }[] = [
  { tempC: 350, rgb: [1, 0.05, 0], intensity: 0 },
  { tempC: 450, rgb: [1, 0.07, 0], intensity: 0.4 },
  { tempC: 600, rgb: [1, 0.22, 0.01], intensity: 1.2 },
  { tempC: 750, rgb: [1, 0.42, 0.06], intensity: 1.8 },
  { tempC: 900, rgb: [1, 0.72, 0.3], intensity: 2.4 },
];

export interface DiscGlow {
  /** Emissive colour, linear. */
  colour: THREE.Color;
  /** Emissive intensity. */
  intensity: number;
}

/**
 * How a carbon-carbon disc glows at `tempC`: dark below 350 °C, dull red at 450, orange at 600 and
 * yellow-white from 900. The brightest step stays under what NeutralToneMapping compresses hard,
 * so hot discs keep their hue instead of clipping to white. Pass `out` to reuse an object.
 */
export function discGlow(tempC: number, out: DiscGlow = { colour: new THREE.Color(), intensity: 0 }): DiscGlow {
  const first = GLOW[0];
  const last = GLOW[GLOW.length - 1];
  if (!(tempC > first.tempC)) {
    out.colour.setRGB(0, 0, 0);
    out.intensity = 0;
    return out;
  }
  if (tempC >= last.tempC) {
    out.colour.setRGB(...last.rgb);
    out.intensity = last.intensity;
    return out;
  }
  let i = 1;
  while (GLOW[i].tempC < tempC) i++;
  const a = GLOW[i - 1];
  const b = GLOW[i];
  const k = (tempC - a.tempC) / (b.tempC - a.tempC);
  out.colour.setRGB(
    a.rgb[0] + (b.rgb[0] - a.rgb[0]) * k,
    a.rgb[1] + (b.rgb[1] - a.rgb[1]) * k,
    a.rgb[2] + (b.rgb[2] - a.rgb[2]) * k,
  );
  out.intensity = a.intensity + (b.intensity - a.intensity) * k;
  return out;
}

const polygon = (cx: number, cy: number, r: number, sides: number, phase = 0): THREE.Vector2[] =>
  Array.from({ length: sides }, (_, i) => {
    const a = phase + (i / sides) * Math.PI * 2;
    return new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a));
  });

/** Position and normal only, so pieces made different ways can merge. */
function bare(g: THREE.BufferGeometry, crease: number): THREE.BufferGeometry {
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  }
  return creased(g, crease);
}

/** The rotor on its own axis (Z), friction ring centred on z = 0, bell reaching toward +z. */
function rotorGeometry(size: RotorSize): THREE.BufferGeometry {
  const { radius, ring, thickness, holes } = size;
  const inner = radius - ring;
  const shape = new THREE.Shape(polygon(0, 0, radius, RING_SEGMENTS));
  holes.forEach((count, row) => {
    const r = inner + (ring * (row + 0.5)) / holes.length;
    for (let i = 0; i < count; i++) {
      // Alternate rows are offset by half a step, so the rows stagger.
      const a = ((i + (row % 2) * 0.5) / count) * Math.PI * 2;
      shape.holes.push(new THREE.Path(polygon(r * Math.cos(a), r * Math.sin(a), HOLE_RADIUS, HOLE_SIDES)));
    }
  });
  const plate = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, steps: 1 }).translate(0, 0, -thickness / 2);

  const top = thickness / 2 + BELL_HEIGHT;
  const bell = new THREE.LatheGeometry(
    [
      [inner - BELL_WALL, -thickness / 2],
      [inner, -thickness / 2],
      [inner, top],
      [BELL_HUB_RADIUS, top],
      [BELL_HUB_RADIUS, top - BELL_WALL],
      [inner - BELL_WALL, top - BELL_WALL],
      [inner - BELL_WALL, -thickness / 2],
    ].map(([r, z]) => new THREE.Vector2(r, z)),
    48,
  ).rotateX(Math.PI / 2);

  const merged = mergeGeometries([bare(plate, 28), bare(bell, 35)], false);
  if (!merged) throw new Error('car: could not merge the rotor');
  merged.computeBoundingSphere();
  return merged;
}

/** A caliper straddling the disc's rim, at angle 0 (on +X); rotated into place by the caller. */
function caliperGeometry(size: RotorSize): THREE.BufferGeometry {
  const { radius, thickness } = size;
  const gap = 0.006;
  const jaw = 0.022;
  const across = thickness + 2 * (gap + jaw);
  const reach = 0.078;
  const mid = radius + 0.008 - reach / 2;
  const jawAt = thickness / 2 + gap + jaw / 2;
  const pieces = [
    roundedBox([reach, 0.072, jaw], [mid, 0, jawAt], 0.007),
    roundedBox([reach, 0.072, jaw], [mid, 0, -jawAt], 0.007),
    roundedBox([0.024, 0.072, across], [radius + 0.014, 0, 0], 0.007),
  ];
  const merged = mergeGeometries(
    pieces.map((p) => bare(p, 50)),
    false,
  );
  if (!merged) throw new Error('car: could not merge the caliper');
  merged.computeBoundingSphere();
  return merged;
}

function orient(g: THREE.BufferGeometry, side: 1 | -1): THREE.BufferGeometry {
  if (side === 1) return g;
  const mirrored = mirrorZ(g);
  g.dispose();
  return mirrored;
}

export class Brakes {
  private readonly discMaterial: Record<Axle, THREE.MeshStandardMaterial>;
  private readonly caliperMaterial: THREE.MeshStandardMaterial;
  private readonly meshes: THREE.Mesh[] = [];
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly glow: DiscGlow = { colour: new THREE.Color(), intensity: 0 };
  private shown = false;

  constructor() {
    const disc = () =>
      new THREE.MeshStandardMaterial({ color: PALETTE.disc, roughness: 0.62, metalness: 0.15, emissive: 0x000000 });
    this.discMaterial = { front: disc(), rear: disc() };
    this.caliperMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.caliper, roughness: 0.4, metalness: 0.55 });
  }

  /**
   * Fit one wheel's rotor and caliper. `spinner` turns with the wheel; `part` is the wheel's part
   * root (car frame, does not spin) and `centre` the wheel centre in that frame. `side` is +1 for
   * the right (+z), -1 for the left.
   */
  mount(part: THREE.Object3D, spinner: THREE.Object3D, centre: THREE.Vector3, axle: Axle, side: 1 | -1): void {
    const size = ROTOR[axle];
    const rotor = new THREE.Mesh(this.geometry(`rotor:${axle}:${side}`, () => orient(rotorGeometry(size), side)), this.discMaterial[axle]);
    rotor.name = `${part.name}:rotor`;
    rotor.position.z = -side * DISC_INBOARD;
    spinner.add(rotor);

    const angle = THREE.MathUtils.degToRad(CALIPER_ANGLE_DEG[axle]);
    const caliper = new THREE.Mesh(
      this.geometry(`caliper:${axle}:${side}`, () => orient(caliperGeometry(size), side).rotateZ(angle)),
      this.caliperMaterial,
    );
    caliper.name = `${part.name}:caliper`;
    caliper.position.set(centre.x, centre.y, centre.z - side * DISC_INBOARD);
    part.add(caliper);

    for (const m of [rotor, caliper]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.visible = this.shown;
      this.meshes.push(m);
    }
  }

  /** Front and rear disc temperatures, °C. */
  setTemps(frontC: number, rearC: number): void {
    for (const [axle, tempC] of [['front', frontC], ['rear', rearC]] as const) {
      const m = this.discMaterial[axle];
      discGlow(tempC, this.glow);
      m.emissive.copy(this.glow.colour);
      m.emissiveIntensity = this.glow.intensity;
    }
  }

  /** Hidden meshes cost nothing to draw. */
  setVisible(on: boolean): void {
    for (const m of this.meshes) m.visible = on;
    this.shown = on;
  }

  get visible(): boolean {
    return this.shown;
  }

  dispose(): void {
    for (const g of this.geometries.values()) g.dispose();
    this.geometries.clear();
    this.meshes.length = 0;
    this.caliperMaterial.dispose();
    for (const m of Object.values(this.discMaterial)) m.dispose();
  }

  private geometry(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geometries.get(key);
    if (!g) {
      g = make();
      this.geometries.set(key, g);
    }
    return g;
  }
}
