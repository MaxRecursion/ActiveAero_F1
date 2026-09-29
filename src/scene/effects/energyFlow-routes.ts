/**
 * The energy circuit, in the car frame, built once from the car's anchors (assembled pose).
 *
 * Legs are short smooth curves between components; routes chain legs into the path a bead follows:
 *   engine → rear axle → each rear hub                 (slate, mechanical)
 *   battery → MGU-K → rear axle → each rear hub         (green; run backwards when braking harvests)
 *   engine → MGU-K → battery                            (super clipping: slate until the MGU-K turns it
 *                                                        into electricity, green after)
 * The drive to the wheels is two routes (left, right) that share the trunk, so beads split at the axle
 * and each driveshaft carries half of them: half the power per wheel.
 * Waypoints are offsets from the anchors, so the routes follow the car if its layout moves; they keep
 * clear of the driver (everything here is behind the cockpit) and of the exhaust primaries.
 */
import * as THREE from 'three';
import type { CarModel } from '../car/types';

/** Spacing of the polyline samples along every leg (m). */
const STEP = 0.01;
/** Distance over which a bead's colour changes where a route crosses from one hue to the other (m). */
const HUE_BLEND = 0.05;
/** The electric lanes run this much above the engine's driveshaft line, so the two streams stay apart. */
const LANE_LIFT = 0.035;

/** 0 = engine (slate) … 1 = electrical (green). */
export type Hue = 0 | 1;

interface Leg {
  points: THREE.Vector3[];
  hue: Hue;
}

/** A polyline with arc length, sampled for beads. */
export interface Route {
  length: number;
  /** xyz per sample. */
  positions: Float32Array;
  /** Cumulative distance per sample. */
  distance: Float32Array;
  /** Colour mix per sample (0 slate … 1 green), blended across hue changes. */
  hue: Float32Array;
}

export interface EnergyCircuit {
  /** Engine → axle → left / right hub. */
  engine: readonly [Route, Route];
  /** Battery → MGU-K → axle → left / right hub (deploy direction). */
  electric: readonly [Route, Route];
  /** Engine → MGU-K → battery. */
  clip: Route;
  /** Every leg once (shared trunks are not doubled), for the faint guide lines. */
  guides: readonly { points: readonly THREE.Vector3[]; hue: Hue }[];
  /** Top of the battery pack, where its charge gauge stands. */
  batteryTop: THREE.Vector3;
}

export function buildCircuit(car: CarModel): EnergyCircuit {
  car.root.updateMatrixWorld(true);
  const toCar = car.root.matrixWorld.clone().invert();
  const at = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3()).applyMatrix4(toCar);
  const E = at(car.anchors.engine);
  const K = at(car.anchors.mguK);
  const B = at(car.anchors.battery);
  const A = at(car.anchors.rearAxle);
  const hubZ = rearHubZ(car, toCar);
  const off = (p: THREE.Vector3, x: number, y: number, z: number) => p.clone().add(new THREE.Vector3(x, y, z));

  const leg = (hue: Hue, ...points: THREE.Vector3[]): Leg => ({ points: sample(points), hue });

  // Crank → clutch → gearbox, rising to the axle line.
  const trunk = leg(0, E, off(E, -0.17, -0.07, 0), off(A, 0.22, -0.115, 0), off(A, 0.08, -0.025, 0), off(A, 0.02, 0, 0));
  const shaft = (side: 1 | -1, hue: Hue, y: number, from: THREE.Vector3) =>
    leg(hue, from, off(A, 0, y, side * 0.12), off(A, 0, y, side * hubZ));
  // Battery out of its rear face, across to the front of the MGU-K drum.
  const feed = leg(1, B, off(B, -0.2, 0, 0.03), off(K, 0.19, 0, -0.075), off(K, 0.13, 0, 0), K);
  // Out of the drum's back, low along the right flank (under the exhaust), into the gearbox.
  const laneEnd = off(A, 0.01, LANE_LIFT, 0.06);
  const lane = leg(1, K, off(K, -0.13, 0, 0), off(A, 0.4, -0.19, 0.2), off(A, 0.22, -0.135, 0.17), off(A, 0.07, 0, 0.1), laneEnd);
  // Crank to MGU-K through its gear case: the engine turning the generator.
  const link = leg(0, E, off(E, 0.1, -0.08, 0.07), off(K, 0, 0.02, -0.1), K);
  const trunkEnd = trunk.points[trunk.points.length - 1];
  const shafts = ([-1, 1] as const).map((s) => shaft(s, 0, 0, trunkEnd));
  const eShafts = ([-1, 1] as const).map((s) => shaft(s, 1, LANE_LIFT, laneEnd));
  const reversed = (l: Leg): Leg => ({ points: [...l.points].reverse(), hue: l.hue });

  return {
    engine: [route(trunk, shafts[0]), route(trunk, shafts[1])],
    electric: [route(feed, lane, eShafts[0]), route(feed, lane, eShafts[1])],
    clip: route(link, reversed(feed)),
    guides: [trunk, ...shafts, feed, lane, ...eShafts, link],
    batteryTop: off(B, 0, 0.07, 0),
  };
}

/** |z| of the rear wheel centres, read from the wheels themselves (the anchors stop at the axle). */
function rearHubZ(car: CarModel, toCar: THREE.Matrix4): number {
  const box = new THREE.Box3();
  const zs = (['wheelRL', 'wheelRR'] as const).flatMap((id) => {
    const wheel = car.parts.get(id)?.object;
    return wheel ? [Math.abs(box.setFromObject(wheel).getCenter(new THREE.Vector3()).applyMatrix4(toCar).z)] : [];
  });
  return zs.length ? Math.max(...zs) : 0.76;
}

function sample(points: THREE.Vector3[]): THREE.Vector3[] {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  return curve.getSpacedPoints(Math.max(2, Math.ceil(curve.getLength() / STEP)));
}

function route(...legs: Leg[]): Route {
  const pts: THREE.Vector3[] = [];
  const hues: number[] = [];
  for (const l of legs) {
    // Consecutive legs share their joining point.
    const start = pts.length && pts[pts.length - 1].distanceTo(l.points[0]) < 1e-6 ? 1 : 0;
    for (let i = start; i < l.points.length; i++) {
      pts.push(l.points[i]);
      hues.push(l.hue);
    }
  }
  const n = pts.length;
  const positions = new Float32Array(n * 3);
  const distance = new Float32Array(n);
  pts.forEach((p, i) => {
    p.toArray(positions, i * 3);
    if (i > 0) distance[i] = distance[i - 1] + p.distanceTo(pts[i - 1]);
  });
  // Soften hue steps into a short gradient, so a bead changes colour as it passes the converter.
  const hue = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = 0; j < n; j++) {
      if (Math.abs(distance[j] - distance[i]) > HUE_BLEND) continue;
      sum += hues[j];
      count++;
    }
    hue[i] = sum / count;
  }
  return { length: distance[n - 1], positions, distance, hue };
}

/** Position, unit tangent and hue at distance `s` along a route (clamped to its ends). */
export function sampleRoute(r: Route, s: number, position: THREE.Vector3, tangent: THREE.Vector3): number {
  const d = r.distance;
  const last = d.length - 1;
  const x = THREE.MathUtils.clamp(s, 0, r.length);
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (d[mid] <= x) lo = mid;
    else hi = mid;
  }
  const span = d[hi] - d[lo];
  const t = span > 0 ? (x - d[lo]) / span : 0;
  const p = r.positions;
  position.set(
    p[lo * 3] + (p[hi * 3] - p[lo * 3]) * t,
    p[lo * 3 + 1] + (p[hi * 3 + 1] - p[lo * 3 + 1]) * t,
    p[lo * 3 + 2] + (p[hi * 3 + 2] - p[lo * 3 + 2]) * t,
  );
  tangent
    .set(p[hi * 3] - p[lo * 3], p[hi * 3 + 1] - p[lo * 3 + 1], p[hi * 3 + 2] - p[lo * 3 + 2])
    .normalize();
  return r.hue[lo] + (r.hue[hi] - r.hue[lo]) * t;
}
