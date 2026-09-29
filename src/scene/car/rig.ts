/**
 * The part registry and per-frame controller shared by the procedural car (buildCar) and the
 * real-model car (loadCar). A part is one Object3D whose origin is its assembled position, so
 * explode, ride height, highlight and X-ray are cheap per-frame transforms, uniform changes and
 * material swaps. Only how the parts are made differs between the two cars.
 */
import * as THREE from 'three';
import { PartMaterials } from './materials';
import type { CarAnchors, CarModel, CarPart, PartGroup, PartId } from './types';
import { XrayShell } from './xray';

type V3 = THREE.Vector3Tuple;

interface Entry extends CarPart {
  materials: PartMaterials;
  /** Share of the ride-height drop this part follows: 1 sprung, 0.5 suspension, 0 wheels. */
  dropShare: number;
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
    const materials = new PartMaterials();
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
    const { root, parts, exteriorMeshes, entries } = this;
    const xray = new XrayShell(entries.filter((e) => shell.includes(e.id)));

    let explode = 0;
    let drop = 0;
    const place = (): void => {
      for (const e of entries) {
        e.object.position.copy(e.explodeOffset).multiplyScalar(explode);
        e.object.position.y -= drop * e.dropShare;
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
      dispose() {
        root.removeFromParent();
        root.traverse((o) => {
          if (o instanceof THREE.Mesh) o.geometry.dispose();
        });
        for (const e of entries) e.materials.dispose();
        parts.clear();
        exteriorMeshes.length = 0;
      },
    };
  }
}
