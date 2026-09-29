/**
 * The model is one fused shell, so each wheel's hub and brake pieces came out inside the nose,
 * bodywork or floor. They are separate connected islands lying within the wheel's envelope; this
 * hands them to the wheel so they travel with it (explode, ride height) instead of hanging in
 * the air where the wheel used to be.
 */
import * as THREE from 'three';

/** A wheel's hub zone: its swept cylinder's bounding box, reaching a little way inboard. */
export function hubZone(centre: THREE.Vector3Tuple, radius: number, width: number): THREE.Box3 {
  const [x, y, z] = centre;
  const inner = z - Math.sign(z) * (width / 2 + 0.2);
  const outer = z + Math.sign(z) * (width / 2 + 0.02);
  return new THREE.Box3(
    new THREE.Vector3(x - radius - 0.05, 0, Math.min(inner, outer)),
    new THREE.Vector3(x + radius + 0.05, y + radius + 0.05, Math.max(inner, outer)),
  );
}

/**
 * Remove from `source` every connected island whose bounding box lies inside one of `zones`, and
 * return them as new meshes (one per zone that got any). Both meshes share the source's vertex
 * buffers; only the index differs.
 */
export function takeIslands(source: THREE.Mesh, zones: readonly THREE.Box3[]): (THREE.Mesh | null)[] {
  const geometry = source.geometry;
  const index = geometry.getIndex();
  if (!index) throw new Error('car: mesh has no index');
  const position = geometry.getAttribute('position');
  source.updateMatrix();

  // Union-find over shared vertices gives the islands.
  const parent = Int32Array.from({ length: position.count }, (_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  for (let i = 0; i < index.count; i += 3) {
    const root = find(index.getX(i));
    parent[find(index.getX(i + 1))] = root;
    parent[find(index.getX(i + 2))] = root;
  }
  const boxes = new Map<number, THREE.Box3>();
  const p = new THREE.Vector3();
  for (let i = 0; i < index.count; i++) {
    const v = index.getX(i);
    const box = boxes.get(find(v)) ?? boxes.set(find(v), new THREE.Box3()).get(find(v))!;
    box.expandByPoint(p.fromBufferAttribute(position, v).applyMatrix4(source.matrix));
  }
  const zoneOf = new Map<number, number>();
  for (const [root, box] of boxes) {
    const z = zones.findIndex((zone) => zone.containsBox(box));
    if (z >= 0) zoneOf.set(root, z);
  }

  const kept: number[] = [];
  const taken = zones.map(() => [] as number[]);
  for (let i = 0; i < index.count; i += 3) {
    const tri = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    (taken[zoneOf.get(find(tri[0])) ?? -1] ?? kept).push(...tri);
  }
  const Ctor = index.array.constructor as Uint16ArrayConstructor | Uint32ArrayConstructor;
  const withIndex = (tris: number[]): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(geometry.attributes)) g.setAttribute(name, attribute);
    return g.setIndex(new THREE.BufferAttribute(new Ctor(tris), 1));
  };
  geometry.setIndex(new THREE.BufferAttribute(new Ctor(kept), 1));
  return taken.map((tris) => {
    if (!tris.length) return null;
    const mesh = new THREE.Mesh(withIndex(tris));
    mesh.name = `${source.name}:hub`;
    mesh.position.copy(source.position);
    mesh.scale.copy(source.scale);
    return mesh;
  });
}
