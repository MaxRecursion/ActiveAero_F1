/**
 * Where the real surfaces are: downward rays onto the loaded meshes, for anchors that must sit on
 * a wing or floor top. Ray hits honour each material's side, so meshes are read from above.
 */
import * as THREE from 'three';

const ray = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);

/** Highest surface of `meshes` at (x, z), or null when the ray misses them. */
export function topSurfaceY(meshes: readonly THREE.Mesh[], x: number, z = 0): number | null {
  ray.set(new THREE.Vector3(x, 3, z), DOWN);
  return ray.intersectObjects(meshes as THREE.Mesh[], false)[0]?.point.y ?? null;
}

/**
 * The stretch of x, at z = 0, over which one wing element has a top surface: the element nearest
 * `near` whose chord is at least `minChord` (so a mainplane, not a slat or a tab in front of it).
 * Elements are found by sampling every 5 mm over ±0.6 m and starting a new one where the top
 * surface steps by more than 2 cm or there is no surface.
 */
export function chordNear(meshes: readonly THREE.Mesh[], near: number, minChord: number): [number, number] {
  const STEP = 0.005;
  const RISE = 0.02;
  const elements: [number, number][] = [];
  let lastY: number | null = null;
  for (let x = near - 0.6; x <= near + 0.6; x += STEP) {
    const y = topSurfaceY(meshes, x);
    if (y === null) {
      lastY = null;
      continue;
    }
    if (lastY !== null && Math.abs(y - lastY) <= RISE) elements[elements.length - 1][1] = x;
    else elements.push([x, x]);
    lastY = y;
  }
  const chords = elements.filter(([a, b]) => b - a >= minChord);
  if (!chords.length) throw new Error(`car: no ${minChord} m chord near x = ${near}`);
  const gap = ([a, b]: [number, number]) => (near < a ? a - near : near > b ? near - b : 0);
  return chords.reduce((best, r) => (gap(r) < gap(best) ? r : best));
}
