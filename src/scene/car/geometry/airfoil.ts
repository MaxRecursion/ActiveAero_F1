/**
 * Wing elements. A race-car wing is an aeroplane wing turned upside down: the cambered, faster
 * (suction) side faces the ground, so the section pulls the car down instead of lifting it.
 * Each element is lofted across the span, so chord, height and angle can vary to the tips.
 */
import * as THREE from 'three';
import { loft } from './loft';

export interface WingStation {
  z: number;
  /** Leading edge position (car frame). */
  x: number;
  y: number;
  chord: number;
  /** Incidence in radians; positive raises the trailing edge (more downforce). */
  angle: number;
}

export interface AirfoilSpec {
  /** Max thickness / chord. */
  thickness: number;
  /** Max camber / chord (bulging toward the ground). */
  camber: number;
}

const CAMBER_POS = 0.4;

/** NACA 4-digit thickness with a closed trailing edge. */
function halfThickness(u: number, t: number): number {
  return 5 * t * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
}

function camberLine(u: number, m: number): number {
  const p = CAMBER_POS;
  return u < p ? (m / (p * p)) * (2 * p * u - u * u) : (m / (1 - p) ** 2) * (1 - 2 * p + 2 * p * u - u * u);
}

/**
 * Ring of points around one section: leading edge, pressure side to the sharp trailing edge,
 * suction side back. Cosine spacing packs points at the round nose and the sharp tail.
 */
function airfoilRing(st: WingStation, spec: AirfoilSpec, perSide = 16): THREE.Vector3[] {
  const along = new THREE.Vector2(-Math.cos(st.angle), Math.sin(st.angle)); // LE → TE
  const up = new THREE.Vector2(Math.sin(st.angle), Math.cos(st.angle));
  const at = (u: number, v: number) =>
    new THREE.Vector3(
      st.x + st.chord * (u * along.x + v * up.x),
      st.y + st.chord * (u * along.y + v * up.y),
      st.z,
    );
  const us = Array.from({ length: perSide + 1 }, (_, i) => (1 - Math.cos((Math.PI * i) / perSide)) / 2);
  const pts: THREE.Vector3[] = [];
  // Inverted section: camber goes negative (toward the ground).
  for (const u of us) pts.push(at(u, -camberLine(u, spec.camber) + halfThickness(u, spec.thickness)));
  for (let i = perSide - 1; i > 0; i--) {
    const u = us[i];
    pts.push(at(u, -camberLine(u, spec.camber) - halfThickness(u, spec.thickness)));
  }
  return pts;
}

/** Stations across a span, symmetric about z = 0; `at(t)` gets t = |z| / half-span (0 centre … 1 tip). */
export function spanStations(
  zFrom: number,
  zTo: number,
  count: number,
  at: (t: number, z: number) => Omit<WingStation, 'z'>,
  halfSpan = Math.max(Math.abs(zFrom), Math.abs(zTo)),
): WingStation[] {
  return Array.from({ length: count }, (_, i) => {
    const z = zFrom + ((zTo - zFrom) * i) / (count - 1);
    return { z, ...at(Math.abs(z) / halfSpan, z) };
  });
}

/** One closed wing element lofted through the stations (caps at both tips). */
export function wingElement(stations: WingStation[], spec: AirfoilSpec, perSide = 16): THREE.BufferGeometry {
  return loft(stations.map((s) => airfoilRing(s, spec, perSide)));
}

/** Height of a section's upper surface at car-frame `x` (for placing anchors on a wing). */
export function upperSurfaceY(st: WingStation, spec: AirfoilSpec, x: number): number {
  let best = { dx: Infinity, y: st.y };
  for (let i = 0; i <= 400; i++) {
    const u = i / 400;
    const v = -camberLine(u, spec.camber) + halfThickness(u, spec.thickness);
    const px = st.x + st.chord * (-u * Math.cos(st.angle) + v * Math.sin(st.angle));
    const py = st.y + st.chord * (u * Math.sin(st.angle) + v * Math.cos(st.angle));
    const dx = Math.abs(px - x);
    if (dx < best.dx) best = { dx, y: py };
  }
  return best.y;
}
