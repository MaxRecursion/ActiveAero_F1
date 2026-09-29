/**
 * Airflow: illustrative streamlines around the car (labelled "illustrative, not CFD" in the UI).
 *
 * Paths come from the car's own geometry (height fields rasterised once at creation, with the car
 * assembled) and simple flow rules — see airflow-paths.ts. What they teach:
 *  - air arrives uniform, parts around and over the car, and is turned UP behind each wing;
 *  - air squeezed under the floor races (blue, long fast dashes), then slows out of the diffuser.
 * Active aero: paths are traced for both wing modes and blended on the GPU (setActiveAero) — with
 * the flaps open the air leaves the rear wing flatter and the wake sits lower; the floor is unchanged.
 *
 * Drawing: every line is one fat dashed polyline, all merged into a single Line2 (plus an x-ray
 * copy of the same geometry for the lines hidden under the floor) — two draw calls in total.
 * LineMaterial's resolution needs no bookkeeping here: Line2 copies the renderer viewport (CSS px)
 * into it before every draw.
 * Colour = local speed (PALETTE.flowSlow → flowFast). The dash coordinate is time-of-flight
 * τ = ∫ ds / speed rather than length, so a single moving dashOffset makes every dash travel at
 * free-stream × local speed, and dashes stretch where the air is fast, like real streaks.
 */
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { PALETTE } from '../palette';
import { visualSpeed } from '../motion';
import { prefersReducedMotion } from '../stage';
import type { PartId } from '../car/types';
import { rasterize } from './airflow-heightfield';
import { createFlowMaterial } from './airflow-material';
import { traceStreamlines, type FlowPath, type Streamline } from './airflow-paths';
import type { Airflow, AirflowOptions } from './types';

const LINE_WIDTH_PX = 1.5;
/** Under-floor lines are drawn this much wider than the context lines around the car. */
const UNDER_WIDTH = 1.6;
/** Dash and gap, in free-stream metres of travel. */
const DASH = 0.55;
const GAP = 0.5;
const PERIOD = DASH + GAP;
/** Streaks fade in with speed: invisible in still air, fully drawn by this speed. */
const FULL_OPACITY_KMH = 120;
/** How strongly lines show through the car (x-ray) relative to their normal opacity. */
const XRAY_OPACITY = 0.8;
/** Speed factors mapped onto the colour ramp: free stream → fastest under-floor air. */
const COLOUR_SLOW = 1.02;
const COLOUR_FAST = 1.42;

const WING_PARTS: readonly PartId[] = ['frontWing', 'rearWing'];
/** Thin struts the air passes straight through; they must not lift the streamlines. */
const IGNORED_PARTS: readonly PartId[] = ['suspensionFront', 'suspensionRear'];

export function createAirflow(opts: AirflowOptions): Airflow {
  const { car } = opts;
  const root = new THREE.Group();
  root.name = 'airflow';

  const roots = (ids: readonly PartId[]) => ids.flatMap((id) => car.parts.get(id)?.object ?? []);
  const within = (parts: THREE.Object3D[]) => (mesh: THREE.Object3D) => {
    for (let o: THREE.Object3D | null = mesh; o; o = o.parent) if (parts.includes(o)) return true;
    return false;
  };
  const isWing = within(roots(WING_PARTS));
  const isIgnored = within(roots(IGNORED_PARTS));
  const wingMeshes = car.exteriorMeshes.filter(isWing);
  // The wings are rasterised with the flaps closed and open; the car is left in Corner Mode.
  car.setActiveAero(1);
  const wingsOpen = rasterize(wingMeshes, car.root);
  car.setActiveAero(0);
  const lines = traceStreamlines({
    body: rasterize(
      car.exteriorMeshes.filter((m) => !isWing(m) && !isIgnored(m)),
      car.root,
    ),
    wings: rasterize(wingMeshes, car.root),
    wingsOpen,
  });

  const geometry = buildGeometry(lines);
  const material = createFlowMaterial({
    linewidth: LINE_WIDTH_PX,
    dashSize: DASH,
    gapSize: GAP,
    xray: false,
  });
  const xrayMaterial = createFlowMaterial({
    linewidth: LINE_WIDTH_PX,
    dashSize: DASH,
    gapSize: GAP,
    xray: true,
  });
  const materials: LineMaterial[] = [material, xrayMaterial];

  // Line2 (not LineSegments2) so the GTAO pass skips it when it draws the scene's normals.
  const flow = new Line2(geometry, material);
  const xray = new Line2(geometry, xrayMaterial);
  flow.name = 'airflow-lines';
  xray.name = 'airflow-xray';
  flow.renderOrder = 3;
  xray.renderOrder = 2;
  root.add(xray, flow);

  const reducedMotion = prefersReducedMotion();
  let kmh = 0;
  let alpha = 1;
  let offset = 0;

  return {
    root,
    setSpeed(value) {
      kmh = Math.max(0, value);
    },
    setOpacity(value) {
      alpha = THREE.MathUtils.clamp(value, 0, 1);
    },
    setActiveAero(t) {
      const k = THREE.MathUtils.clamp(t, 0, 1);
      for (const m of materials) m.uniforms.activeAero.value = k;
    },
    update(dt) {
      const opacity = THREE.MathUtils.smoothstep(kmh, 0, FULL_OPACITY_KMH) * alpha;
      root.visible = opacity > 0.002;
      if (!root.visible) return;
      // Dashes travel toward -X; wrapping by the dash period keeps the offset small and exact.
      if (!reducedMotion) offset = (offset - visualSpeed(kmh) * dt) % PERIOD;
      for (const m of materials) m.dashOffset = offset;
      material.opacity = opacity;
      xrayMaterial.opacity = opacity * XRAY_OPACITY;
    },
    dispose() {
      root.removeFromParent();
      geometry.dispose();
      for (const m of materials) m.dispose();
    },
  };
}

/** Per-point dash coordinate (time-of-flight) and colour of one path. */
interface PathShading {
  tau: Float32Array;
  colours: Float32Array;
}

const SLOW = new THREE.Color(PALETTE.flowSlow);
const FAST = new THREE.Color(PALETTE.flowFast);
const STILL = new THREE.Color(PALETTE.background);

/** τ starts at `phase` and grows by ds / speed; colour follows local speed. */
function shade(path: FlowPath, phase: number): PathShading {
  const { points, speed } = path;
  const count = speed.length;
  const tau = new Float32Array(count);
  const colours = new Float32Array(count * 3);
  const c = new THREE.Color();
  let t = phase;
  for (let i = 0; i < count; i++) {
    const s = speed[i];
    if (i > 0) {
      const ds = Math.hypot(
        points[i * 3] - points[i * 3 - 3],
        points[i * 3 + 1] - points[i * 3 - 2],
        points[i * 3 + 2] - points[i * 3 - 1],
      );
      t += ds / ((s + speed[i - 1]) / 2);
    }
    tau[i] = t;
    // Faster than free stream → toward blue; slower (stagnation) → paler, toward still air.
    if (s >= 1) c.lerpColors(SLOW, FAST, THREE.MathUtils.smoothstep(s, COLOUR_SLOW, COLOUR_FAST));
    else c.lerpColors(SLOW, STILL, THREE.MathUtils.clamp((1 - s) * 1.4, 0, 0.6));
    c.toArray(colours, i * 3);
  }
  return { tau, colours };
}

/**
 * All lines in one polyline. Consecutive lines are joined by a bridge segment whose fade is 0,
 * which the shader discards. Per-segment attributes: time-of-flight distance, (opacity, x-ray,
 * width scale), and the Straight Mode position, time-of-flight and colour.
 */
function buildGeometry(lines: readonly Streamline[]): LineGeometry {
  const total = lines.reduce((n, l) => n + l.alpha.length, 0);
  const positions = new Float32Array(total * 3);
  const colours = new Float32Array(total * 3);
  const tau = new Float32Array(total);
  /** Straight Mode, per point: (x, y, z, τ) and colour. */
  const open = new Float32Array(total * 4);
  const openColours = new Float32Array(total * 3);
  const fade = new Float32Array(total * 3);
  /** Index of the first point of each bridge segment (the last point of a line). */
  const bridges = new Set<number>();

  let p = 0;
  lines.forEach((line, n) => {
    const count = line.alpha.length;
    // Golden-ratio phase per line, so dashes on neighbouring lines never march in step.
    const phase = ((n * 0.618034) % 1) * PERIOD;
    const corner = shade(line.corner, phase);
    const straight = shade(line.open, phase);
    const width = line.kind === 'under' ? UNDER_WIDTH : 1;
    positions.set(line.corner.points, p * 3);
    colours.set(corner.colours, p * 3);
    tau.set(corner.tau, p);
    openColours.set(straight.colours, p * 3);
    for (let i = 0; i < count; i++, p++) {
      open.set(line.open.points.subarray(i * 3, i * 3 + 3), p * 4);
      open[p * 4 + 3] = straight.tau[i];
      const s = line.corner.speed[i];
      const a = line.alpha[i] * (0.8 + 0.2 * THREE.MathUtils.smoothstep(s, COLOUR_SLOW, COLOUR_FAST));
      fade.set([a, line.xray[i], width], p * 3);
    }
    bridges.add(p - 1);
  });

  const geometry = new LineGeometry();
  geometry.setPositions(positions);
  geometry.setColors(colours);

  // Per-segment pairs (start, end), laid out like LineSegments2.computeLineDistances does.
  const segments = total - 1;
  const distances = new Float32Array(segments * 2);
  const fades = new Float32Array(segments * 6);
  const opens = new Float32Array(segments * 14);
  for (let k = 0; k < segments; k++) {
    const bridge = bridges.has(k);
    distances[k * 2] = tau[k];
    distances[k * 2 + 1] = bridge ? tau[k] : tau[k + 1];
    opens.set(open.subarray(k * 4, k * 4 + 8), k * 14);
    opens.set(openColours.subarray(k * 3, k * 3 + 6), k * 14 + 8);
    if (bridge) continue; // fades stay 0: the shader drops the segment
    fades.set(fade.subarray(k * 3, k * 3 + 6), k * 6);
  }
  const distanceBuffer = new THREE.InstancedInterleavedBuffer(distances, 2, 1);
  geometry.setAttribute('instanceDistanceStart', new THREE.InterleavedBufferAttribute(distanceBuffer, 1, 0));
  geometry.setAttribute('instanceDistanceEnd', new THREE.InterleavedBufferAttribute(distanceBuffer, 1, 1));
  const fadeBuffer = new THREE.InstancedInterleavedBuffer(fades, 6, 1);
  geometry.setAttribute('instanceFadeStart', new THREE.InterleavedBufferAttribute(fadeBuffer, 3, 0));
  geometry.setAttribute('instanceFadeEnd', new THREE.InterleavedBufferAttribute(fadeBuffer, 3, 3));
  const openBuffer = new THREE.InstancedInterleavedBuffer(opens, 14, 1);
  geometry.setAttribute('instanceOpenStart', new THREE.InterleavedBufferAttribute(openBuffer, 4, 0));
  geometry.setAttribute('instanceOpenEnd', new THREE.InterleavedBufferAttribute(openBuffer, 4, 4));
  geometry.setAttribute('instanceOpenColorStart', new THREE.InterleavedBufferAttribute(openBuffer, 3, 8));
  geometry.setAttribute('instanceOpenColorEnd', new THREE.InterleavedBufferAttribute(openBuffer, 3, 11));

  // Frustum culling must see both modes' paths, not just the Corner Mode ones.
  const v = new THREE.Vector3();
  for (let i = 0; i < total; i++) {
    v.fromArray(open, i * 4);
    geometry.boundingBox?.expandByPoint(v);
    geometry.boundingSphere?.expandByPoint(v);
  }
  return geometry;
}
