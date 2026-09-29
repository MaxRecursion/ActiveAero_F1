/**
 * Small geometry builders shared by the parts: flat plates (endplates, fences, fins), faired
 * struts (suspension, rods), solids of revolution (wheels) and mirroring to the car's left side.
 */
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export type P2 = readonly [number, number];

/**
 * A closed outline through the points. With `radius`, every corner is filleted (a quadratic curve
 * through the corner), so plates read as moulded carbon rather than cut sheet.
 */
export function shape(points: readonly P2[], radius = 0): THREE.Shape {
  if (radius <= 0) return new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const n = points.length;
  const pt = (i: number) => new THREE.Vector2(...points[(i + n) % n]);
  /** Point on the edge from corner i toward corner j, at most `radius` (and half the edge) away. */
  const toward = (i: number, j: number) => {
    const a = pt(i);
    const d = pt(j).sub(a);
    return a.add(d.setLength(Math.min(radius, d.length() / 2)));
  };
  const s = new THREE.Shape();
  const start = toward(0, 1);
  s.moveTo(start.x, start.y);
  for (let i = 1; i <= n; i++) {
    const inPt = toward(i, i - 1);
    const outPt = toward(i, i + 1);
    const c = pt(i);
    s.lineTo(inPt.x, inPt.y);
    s.quadraticCurveTo(c.x, c.y, outPt.x, outPt.y);
  }
  return s;
}

/**
 * A vertical plate: an outline in the car's XY plane (side view), `thickness` wide about `zCentre`.
 * A small bevel rounds the edges so plates catch a highlight instead of looking paper-cut.
 */
export function plateXY(outline: THREE.Shape, zCentre: number, thickness: number): THREE.BufferGeometry {
  const bevel = Math.min(0.004, thickness * 0.3);
  const g = new THREE.ExtrudeGeometry(outline, {
    depth: thickness - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 8,
  });
  g.translate(0, 0, zCentre - thickness / 2 + bevel);
  return g;
}

const X = new THREE.Vector3(1, 0, 0);

/**
 * A strut from a to b. `aspect` > 1 makes an aerodynamic (elliptic) section whose long axis lies
 * as close to the airflow (+X) as the strut direction allows — as real wishbones are faired.
 */
export function strut(
  a: THREE.Vector3Like,
  b: THREE.Vector3Like,
  radius: number,
  aspect = 1,
  radial = 10,
): THREE.BufferGeometry {
  const pa = new THREE.Vector3().copy(a);
  const pb = new THREE.Vector3().copy(b);
  const dir = pb.clone().sub(pa);
  const len = dir.length();
  dir.divideScalar(len);
  const g = new THREE.CylinderGeometry(radius, radius, len, radial, 1, false);
  g.scale(aspect, 1, 1);
  const flow = X.clone().addScaledVector(dir, -X.dot(dir));
  if (flow.lengthSq() < 1e-6) flow.set(0, 0, 1).addScaledVector(dir, -dir.z);
  flow.normalize();
  const side = new THREE.Vector3().crossVectors(flow, dir);
  const m = new THREE.Matrix4().makeBasis(flow, dir, side).setPosition(pa.add(pb).multiplyScalar(0.5));
  g.applyMatrix4(m);
  return g;
}

/** Rounded box centred at `c`. Keeps its own (already smooth) normals. */
export function roundedBox(
  size: THREE.Vector3Tuple,
  c: THREE.Vector3Tuple,
  radius: number,
  segments = 3,
): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(size[0], size[1], size[2], segments, radius);
  g.deleteAttribute('uv');
  g.translate(c[0], c[1], c[2]);
  return g;
}

/** Mirror across z = 0 (car's left side) with the winding reversed so faces still point outward. */
export function mirrorZ(g: THREE.BufferGeometry): THREE.BufferGeometry {
  // A plain copy: clone() re-runs subclass constructors (LoftGeometry) without their arguments.
  const m = new THREE.BufferGeometry().copy(g);
  m.scale(1, 1, -1);
  const index = m.getIndex();
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const t = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, t);
    }
  } else {
    swapVertexOrder(m);
  }
  return m;
}

/**
 * Smooth normals with hard creases above `angleDeg`. three's helper hashes positions to 1 cm,
 * which would blend unrelated detail on a 1:1 car, so it runs on a copy scaled to millimetres.
 */
export function creased(g: THREE.BufferGeometry, angleDeg: number): THREE.BufferGeometry {
  g.scale(1000, 1000, 1000);
  const out = toCreasedNormals(g, THREE.MathUtils.degToRad(angleDeg));
  out.scale(1e-3, 1e-3, 1e-3);
  if (out !== g) g.dispose();
  return out;
}

/**
 * A solid of revolution about the Z axis (wheels, hubs). `profile` is (radius, z) and should be a
 * closed loop; it is revolved and then turned outward-facing whatever direction it was drawn in.
 */
export function latheZ(profile: readonly P2[], segments: number): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    profile.map(([r, z]) => new THREE.Vector2(r, z)),
    segments,
  );
  g.deleteAttribute('uv');
  g.rotateX(Math.PI / 2); // lathe axis Y → Z: profile (r, z) lands at radius r, height z
  orientOutward(g);
  return g;
}

/** Flip the winding of a closed mesh whose signed volume is negative (faces pointing inward). */
function orientOutward(g: THREE.BufferGeometry): void {
  const pos = g.getAttribute('position');
  const index = g.getIndex();
  const n = index ? index.count : pos.count;
  const vi = (i: number) => (index ? index.getX(i) : i);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let volume = 0;
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(pos, vi(i));
    b.fromBufferAttribute(pos, vi(i + 1));
    c.fromBufferAttribute(pos, vi(i + 2));
    volume += a.dot(b.cross(c));
  }
  if (volume >= 0) return;
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const t = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, t);
    }
    index.needsUpdate = true;
  } else {
    swapVertexOrder(g);
  }
  g.deleteAttribute('normal');
}

function swapVertexOrder(g: THREE.BufferGeometry): void {
  for (const attr of Object.values(g.attributes)) {
    for (let i = 0; i < attr.count; i += 3) {
      for (let k = 0; k < attr.itemSize; k++) {
        const t = attr.getComponent(i + 1, k);
        attr.setComponent(i + 1, k, attr.getComponent(i + 2, k));
        attr.setComponent(i + 2, k, t);
      }
    }
  }
}
