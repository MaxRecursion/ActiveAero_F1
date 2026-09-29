/**
 * Helpers that turn the nodes of public/models/car.glb (see scripts/model/process.mjs) into car
 * parts. The file is already in the car frame (metres, +X forward, ground y = 0), but its nodes
 * carry a quantisation translation and scale and no rotation, so a node can be re-parented under
 * a pivot by subtracting the pivot position from the node position.
 */
import * as THREE from 'three';
import type { MatKey, PartMaterials } from '../materials';

/** Nodes are meshes, one per part; wrapping keeps each part's origin at the car origin for explode. */
export function meshesOf(node: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  node.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes.push(o);
  });
  return meshes;
}

/** Give a node's meshes the finish `key` from this part's materials. */
export function finish(node: THREE.Object3D, mats: PartMaterials, key: MatKey): void {
  for (const m of meshesOf(node)) {
    m.material = mats.get(key);
    m.castShadow = true;
    m.receiveShadow = true;
  }
}

/** A part root at the car origin holding the given nodes. */
export function wrap(name: string, ...nodes: THREE.Object3D[]): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  group.add(...nodes);
  return group;
}

/** Re-parent `node` under `pivot` without moving it: the pivot (unrotated) sits at `at`. */
function hangFrom(pivot: THREE.Object3D, node: THREE.Object3D, at: THREE.Vector3): void {
  pivot.position.copy(at);
  node.position.sub(at);
  pivot.add(node);
}

/** A wheel's tread and sidewall, and everything inside this radius (metres), which is the rim. */
const RIM_RADIUS = 0.235;

/**
 * Put a wheel on a spinner at its true centre (so it turns about its axle) and split its single
 * mesh into rim and tyre: triangles nearer the axle than the rim's edge go to the rim, by
 * re-ordering the index buffer into two draw groups.
 */
export function mountWheel(node: THREE.Mesh, centre: THREE.Vector3, mats: PartMaterials): THREE.Group {
  const geometry = node.geometry;
  const index = geometry.getIndex();
  const position = geometry.getAttribute('position');
  if (!index) throw new Error('car: wheel mesh has no index');
  node.updateMatrix();
  const p = new THREE.Vector3();
  const isRim = (a: number, b: number, c: number): boolean => {
    let x = 0;
    let y = 0;
    for (const i of [a, b, c]) {
      p.fromBufferAttribute(position, i).applyMatrix4(node.matrix);
      x += p.x / 3;
      y += p.y / 3;
    }
    return Math.hypot(x - centre.x, y - centre.y) < RIM_RADIUS;
  };
  const rim: number[] = [];
  const tyre: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const [a, b, c] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    (isRim(a, b, c) ? rim : tyre).push(a, b, c);
  }
  const Ctor = index.array.constructor as Uint16ArrayConstructor | Uint32ArrayConstructor;
  geometry.setIndex(new THREE.BufferAttribute(new Ctor([...rim, ...tyre]), 1));
  geometry.clearGroups();
  geometry.addGroup(0, rim.length, 0);
  geometry.addGroup(rim.length, tyre.length, 1);
  node.material = [mats.get('rim'), mats.get('tyrePlain')];
  node.castShadow = true;
  node.receiveShadow = true;

  const spinner = new THREE.Group();
  spinner.name = `${node.name}:spinner`;
  hangFrom(spinner, node, centre);
  return spinner;
}

/** A hinged wing element: `pivot` sits on the hinge line, `axis` is the right-handed turning axis. */
export interface Hinged {
  pivot: THREE.Object3D;
  axis: THREE.Vector3;
}

/** Hang a flap node from its hinge line, read from the node's `hinge` extras (two car-frame points). */
export function hangFlap(node: THREE.Object3D): Hinged {
  const { a, b } = node.userData.hinge as { a: THREE.Vector3Tuple; b: THREE.Vector3Tuple };
  const from = new THREE.Vector3().fromArray(a);
  const pivot = new THREE.Group();
  pivot.name = `${node.name}:hinge`;
  hangFrom(pivot, node, from);
  return { pivot, axis: new THREE.Vector3().fromArray(b).sub(from).normalize() };
}
