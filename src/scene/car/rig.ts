/**
 * The part registry and per-frame controller shared by the procedural car (buildCar) and the
 * real-model car (loadCar). A part is one Object3D whose origin is its assembled position, so
 * explode, ride height, highlight and X-ray are cheap per-frame transforms, uniform changes and
 * material swaps. Only how the parts are made differs between the two cars.
 */
import * as THREE from 'three';
import { AXLE_X, TYRE } from './dims';
import { applyLivery, prepareLivery } from './livery/apply';
import { PartMaterials, WHEEL_LOOKS } from './materials';
import { Brakes } from './parts/brakes';
import type { CarAnchors, CarModel, CarPart, LiveryId, PartGroup, PartId } from './types';
import { GhostSwap } from './xray';

type V3 = THREE.Vector3Tuple;

interface Entry extends CarPart {
  materials: PartMaterials;
  /** Share of the ride-height drop and of the braking pitch this part follows: 1 sprung, 0.5 suspension, 0 wheels. */
  dropShare: number;
}

/** The body may come this close to the road under pitch, m: the plank scrapes, it does not go through. */
const MIN_CLEARANCE_M = 0.004;
/** The clearance check keeps a lowest point for every slice of the car this wide along X, m. */
const SLICE_M = 0.01;
/** Only points this low can touch the road under any pitch the story shows, m. */
const LOW_POINT_Y = 0.4;

interface LowPoint {
  x: number;
  y: number;
  share: number;
}

/** The lowest point of each slice along X of every part that pitches with the body. */
function lowPoints(entries: readonly Entry[]): LowPoint[] {
  const lowest = new Map<string, LowPoint>();
  const p = new THREE.Vector3();
  for (const e of entries) {
    if (e.dropShare === 0) continue;
    e.object.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const position = o.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) {
        p.fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld);
        if (p.y > LOW_POINT_Y) continue;
        const key = `${e.dropShare}:${Math.round(p.x / SLICE_M)}`;
        const known = lowest.get(key);
        if (!known || p.y < known.y) lowest.set(key, { x: p.x, y: p.y, share: e.dropShare });
      }
    });
  }
  // Grouped by share, so the solver turns each group's angle once.
  return [...lowest.values()].sort((a, b) => a.share - b.share);
}

/** What differs between cars once the parts exist. */
export interface RigOptions {
  anchors: CarAnchors;
  /** The parts that turn to a ghost under X-ray; everything else stays solid. */
  shell: readonly PartId[];
  /** Objects that turn about the axle (z): `rotation.z = -angle`. */
  spinners: readonly THREE.Object3D[];
  /** Applies Straight Mode (0 = flaps closed … 1 = open) to the moving wing elements. */
  setActiveAero(t: number): void;
  /** Objects that slide sideways by `side * amount` at full explode (the two halves of a suspension). */
  spread?: { halves: readonly (readonly [THREE.Object3D, 1 | -1])[]; amount: number };
}

export class CarAssembly {
  readonly root = new THREE.Group();
  readonly parts = new Map<PartId, CarPart>();
  readonly exteriorMeshes: THREE.Mesh[] = [];
  /** Rotors and calipers; each wheel builder fits them after `add` so they stay out of `exteriorMeshes`. */
  readonly brakes = new Brakes();
  private readonly entries: Entry[] = [];

  constructor() {
    this.root.name = 'car';
  }

  /** Register a part: `build` fills a fresh set of materials; the object is named after the part. */
  readonly add = <T extends THREE.Object3D>(
    id: PartId,
    label: string,
    group: PartGroup,
    offset: V3,
    build: (mats: PartMaterials) => T,
    { dropShare = 1, exterior = true } = {},
  ): T => {
    const materials = new PartMaterials(group === 'wheels' ? WHEEL_LOOKS : {});
    const object = build(materials);
    object.name = id;
    this.root.add(object);
    const entry: Entry = {
      id,
      label,
      group,
      object,
      explodeOffset: new THREE.Vector3(...offset),
      materials,
      dropShare,
    };
    this.entries.push(entry);
    this.parts.set(id, entry);
    if (exterior) {
      object.traverse((o) => {
        if (o instanceof THREE.Mesh) this.exteriorMeshes.push(o);
      });
    }
    return object;
  };

  /** An empty marker that moves with `parent`, at a car-frame position. */
  readonly anchor = (parent: THREE.Object3D, name: string, p: THREE.Vector3Like): THREE.Object3D => {
    const o = new THREE.Object3D();
    o.name = `anchor:${name}`;
    o.position.copy(p);
    parent.add(o);
    return o;
  };

  /** The finished model; call once every part and anchor exists. */
  toModel({ anchors, shell, spinners, setActiveAero, spread }: RigOptions): CarModel {
    const { root, parts, exteriorMeshes, entries, brakes } = this;
    const xray = new GhostSwap(entries.filter((e) => shell.includes(e.id)));
    const wheelGhost = new GhostSwap(entries.filter((e) => e.group === 'wheels'));
    root.updateMatrixWorld(true);
    prepareLivery(entries);
    const low = lowPoints(entries);
    const wheelbase = AXLE_X.front - AXLE_X.rear;
    const pivotY = TYRE.rear.radius;

    let explode = 0;
    let drop = 0;
    // The body's pitch: a turn `angle` about the axis through (pivotX, pivotY), then a lift that keeps its lowest points off the road.
    const pitch = { noseDrop: 0, tailRise: 0, angle: 0, pivotX: 0, lift: 0 };

    const solvePitch = (): void => {
      const { noseDrop, tailRise } = pitch;
      const total = noseDrop + tailRise;
      pitch.angle = Math.abs(total) < 1e-9 ? 0 : Math.asin(THREE.MathUtils.clamp(-total / wheelbase, -0.5, 0.5));
      pitch.pivotX = pitch.angle === 0 ? 0 : AXLE_X.front - (wheelbase * noseDrop) / total;
      pitch.lift = 0;
      if (pitch.angle === 0) return;
      let turned = NaN;
      let sin = 0;
      let cos = 1;
      for (const { x, y, share } of low) {
        if (share !== turned) {
          turned = share;
          sin = Math.sin(pitch.angle * share);
          cos = Math.cos(pitch.angle * share);
        }
        const y0 = y - drop * share;
        const pitched = pivotY + (x - pitch.pivotX) * sin + (y - pivotY) * cos - drop * share;
        // A point already lower than the clearance is only stopped from going lower still.
        pitch.lift = Math.max(pitch.lift, (Math.min(MIN_CLEARANCE_M, y0) - pitched) / share);
      }
    };

    const place = (): void => {
      for (const e of entries) {
        const o = e.object;
        o.position.copy(e.explodeOffset).multiplyScalar(explode);
        o.position.y -= drop * e.dropShare;
        if (pitch.angle === 0 || e.dropShare === 0) {
          o.rotation.z = 0;
          continue;
        }
        const a = pitch.angle * e.dropShare;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const px = pitch.pivotX;
        o.rotation.z = a;
        o.position.x += px - (c * px - s * pivotY);
        o.position.y += pivotY - (s * px + c * pivotY) + pitch.lift * e.dropShare;
      }
      if (spread) for (const [half, side] of spread.halves) half.position.z = side * spread.amount * explode;
    };

    return {
      root,
      parts,
      anchors,
      exteriorMeshes,
      setExplode(t) {
        explode = THREE.MathUtils.clamp(t, 0, 1);
        place();
      },
      setWheelSpin(angle) {
        // Rolling toward +X turns the wheel clockwise seen from +Z: a negative rotation about Z.
        for (const s of spinners) s.rotation.z = -angle;
      },
      setRideHeightDrop(metres) {
        drop = metres;
        solvePitch();
        place();
      },
      setPitch(noseDropM, tailRiseM) {
        pitch.noseDrop = noseDropM;
        pitch.tailRise = tailRiseM;
        solvePitch();
        place();
      },
      setActiveAero(t) {
        setActiveAero(THREE.MathUtils.clamp(t, 0, 1));
      },
      setHighlight(ids) {
        for (const e of entries)
          e.materials.setEmphasis(ids === null ? 'none' : ids.includes(e.id) ? 'on' : 'faded');
      },
      setXray(t) {
        xray.set(t);
      },
      setBrakeTemps(frontC, rearC) {
        brakes.setTemps(frontC, rearC);
      },
      setWheelGhost(t) {
        const k = THREE.MathUtils.clamp(t, 0, 1);
        wheelGhost.set(k);
        brakes.setVisible(k > 0);
      },
      setLivery(id: LiveryId) {
        applyLivery(entries, id);
      },
      dispose() {
        root.removeFromParent();
        root.traverse((o) => {
          if (o instanceof THREE.Mesh) o.geometry.dispose();
        });
        for (const e of entries) e.materials.dispose();
        brakes.dispose();
        parts.clear();
        exteriorMeshes.length = 0;
      },
    };
  }
}
