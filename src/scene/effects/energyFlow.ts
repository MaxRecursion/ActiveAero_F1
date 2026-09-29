/**
 * Energy flow, Station 3: glowing beads stream through the X-rayed car along the energy circuit
 * (see energyFlow-routes.ts), plus faint guide lines for the whole circuit and a battery gauge.
 *
 * Reading it: slate beads = engine power, green = electrical. Beads are small comets (bright head,
 * fading tail), so the direction of flow reads even in a still frame. Speed and density both scale
 * with power; at zero power a stream thins out bead by bead rather than stopping dead.
 *   deploy   battery → MGU-K → wheels
 *   brake    wheels → MGU-K → battery (the electric stream runs backwards)
 *   clipping engine → MGU-K → battery, while the stream from engine to wheels thins
 *
 * Draw calls: beads ×2, guides ×2 (normal + see-through pass each), gauge ×1.
 * setFlows only stores targets; update() eases the streams (frame-rate independent) and moves beads.
 */
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { PALETTE } from '../palette';
import { prefersReducedMotion } from '../stage';
import {
  createBeadMaterial,
  createGaugeMaterial,
  createGuideMaterial,
  GUIDE_HIDDEN,
  skipOverridePasses,
} from './energyFlow-materials';
import { buildCircuit, sampleRoute, type Route } from './energyFlow-routes';
import type { EnergyFlow, EnergyFlowOptions, EnergyFlows } from './types';

/** Full-scale power per stream (kW): the 2026 engine and MGU-K ratings. */
const ENGINE_KW = 400;
const MGUK_KW = 350;
/** Bead spacing along a stream at full power (m), and bead speed at full power (m/s). */
const SPACING = 0.075;
const SPEED = 0.75;
/** Slowest bead speed as a fraction of full, so a faint stream still visibly moves. */
const MIN_SPEED = 0.3;
/** Bead width (m); its length stretches with speed from STRETCH[0] to STRETCH[1] widths. */
const BEAD = 0.021;
const STRETCH = [2.4, 4.4] as const;
/** Width of the density ramp: how gradually beads fade in or out as power changes. */
const DENSITY_SOFTNESS = 0.2;
/** Beads fade over this distance at each end of a route (m), so they grow out of / sink into parts. */
const END_FADE = 0.07;
/** Easing rate for power (1/s): ~0.4 s to settle. */
const RATE = 6;
const CHARGE_RATE = 4;
const GUIDE_OPACITY = 0.4;
/** Battery gauge: size (m) and height of its centre above the top of the pack (m). */
const GAUGE_SIZE = new THREE.Vector2(0.36, 0.08);
const GAUGE_LIFT = 0.2;

const SLATE = new THREE.Color(PALETTE.engine);
const GREEN = new THREE.Color(PALETTE.energy);

interface Stream {
  routes: readonly Route[];
  /** kW that counts as full speed and density. */
  fullKw: number;
  /** Signed eased power (kW) and its target; + = the routes' own direction. */
  kw: number;
  target: number;
  /** Distance travelled (m); beads sit at their base offset plus this. */
  travel: number;
  /** First instance index of each route's beads, and their count. */
  first: number[];
  count: number[];
}

interface Bead {
  base: number;
  threshold: number;
}

export function createEnergyFlow(opts: EnergyFlowOptions): EnergyFlow {
  const circuit = buildCircuit(opts.car);
  const root = new THREE.Group();
  root.name = 'energyFlow';

  const stream = (routes: readonly Route[], fullKw: number): Stream => ({
    routes,
    fullKw,
    kw: 0,
    target: 0,
    travel: 0,
    first: [],
    count: [],
  });
  const engine = stream(circuit.engine, ENGINE_KW);
  const electric = stream(circuit.electric, MGUK_KW);
  const clip = stream([circuit.clip], MGUK_KW);
  const streams = [engine, electric, clip];

  // ── beads ────────────────────────────────────────────────────────────────────
  const beads: Bead[] = [];
  for (const s of streams) {
    // Routes sharing a trunk (left / right wheel) each carry every other bead, offset by half a gap.
    const gap = SPACING * s.routes.length;
    s.routes.forEach((r, k) => {
      const n = Math.max(1, Math.round(r.length / gap));
      s.first.push(beads.length);
      s.count.push(n);
      for (let i = 0; i < n; i++) {
        beads.push({
          base: ((i + k / s.routes.length) * r.length) / n,
          // Golden-ratio thresholds: at any density the visible beads stay evenly spread.
          threshold: (i * 0.618034 + k * 0.5) % 1,
        });
      }
    });
  }

  // A unit dash along +Y (y in ±0.5); the shader fades its tail.
  const beadGeometry = new THREE.CapsuleGeometry(0.5, 1, 4, 10).scale(1, 0.5, 1);
  const flow = new THREE.InstancedBufferAttribute(new Float32Array(beads.length * 2), 2);
  flow.setUsage(THREE.DynamicDrawUsage);
  beadGeometry.setAttribute('aFlow', flow);
  const beadMaterial = createBeadMaterial(false);
  const beadHidden = createBeadMaterial(true);
  const beadMesh = new THREE.InstancedMesh(beadGeometry, beadMaterial, beads.length);
  const beadMeshHidden = new THREE.InstancedMesh(beadGeometry, beadHidden, beads.length);
  beadMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  beadMeshHidden.instanceMatrix = beadMesh.instanceMatrix; // one upload feeds both passes
  for (const m of [beadMesh, beadMeshHidden]) {
    m.frustumCulled = false; // instances move; the car-sized circuit is always near the view anyway
    skipOverridePasses(m);
  }
  beadMeshHidden.renderOrder = 22;
  beadMesh.renderOrder = 23;

  // ── guides ───────────────────────────────────────────────────────────────────
  const segments: number[] = [];
  const colours: number[] = [];
  const guide = (points: readonly THREE.Vector3[], colour: THREE.Color) => {
    for (let i = 1; i < points.length; i++) {
      segments.push(...points[i - 1].toArray(), ...points[i].toArray());
      colours.push(...colour.toArray(), ...colour.toArray());
    }
  };
  for (const g of circuit.guides) guide(g.points, g.hue ? GREEN : SLATE);
  const gaugeAt = circuit.batteryTop.clone().setY(circuit.batteryTop.y + GAUGE_LIFT);
  guide([circuit.batteryTop, gaugeAt], GREEN); // leader from the pack up to its gauge
  const guideGeometry = new LineSegmentsGeometry().setPositions(segments).setColors(colours);
  const guideMaterial = createGuideMaterial(false);
  const guideHidden = createGuideMaterial(true);
  const guides = new LineSegments2(guideGeometry, guideMaterial);
  const guidesHidden = new LineSegments2(guideGeometry, guideHidden);
  for (const g of [guides, guidesHidden]) skipOverridePasses(g);
  guidesHidden.renderOrder = 20;
  guides.renderOrder = 21;

  // ── battery gauge ──────────────────────────────────────────────────────────────
  const gaugeGeometry = new THREE.PlaneGeometry(1, 1);
  const gaugeMaterial = createGaugeMaterial(GAUGE_SIZE);
  const gauge = new THREE.Mesh(gaugeGeometry, gaugeMaterial);
  gauge.position.copy(gaugeAt);
  gauge.frustumCulled = false; // billboarded in the shader; its geometry bounds mean nothing
  gauge.renderOrder = 30;
  skipOverridePasses(gauge);

  root.add(guidesHidden, guides, beadMeshHidden, beadMesh, gauge);

  const reducedMotion = prefersReducedMotion();
  let alpha = 1;
  let charge = 0;
  let chargeTarget = 0;
  let sheen = 0;

  const position = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const Y = new THREE.Vector3(0, 1, 0);
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

  function placeBeads(s: Stream) {
    const f = Math.min(1, Math.abs(s.kw) / s.fullKw);
    const dir = Math.sign(s.kw) || 1;
    const length = BEAD * (STRETCH[0] + (STRETCH[1] - STRETCH[0]) * f);
    const width = BEAD * (0.8 + 0.2 * f);
    s.routes.forEach((r, k) => {
      for (let i = 0; i < s.count[k]; i++) {
        const j = s.first[k] + i;
        const b = beads[j];
        const d = THREE.MathUtils.euclideanModulo(b.base + s.travel, r.length);
        const density = THREE.MathUtils.clamp(
          (f * (1 + DENSITY_SOFTNESS) - b.threshold) / DENSITY_SOFTNESS,
          0,
          1,
        );
        const ends = THREE.MathUtils.smoothstep(d, 0, END_FADE) * THREE.MathUtils.smoothstep(r.length - d, 0, END_FADE);
        const a = density * ends;
        if (a < 0.004) {
          beadMesh.setMatrixAt(j, ZERO);
          flow.setY(j, 0);
          continue;
        }
        const hue = sampleRoute(r, d, position, tangent);
        tangent.multiplyScalar(dir); // point the comet's head where it is going
        quaternion.setFromUnitVectors(Y, tangent);
        // Beads shrink as they fade, as well as thinning out: they never pop.
        const grow = 0.55 + 0.45 * a;
        scale.set(width * grow, length * grow, width * grow);
        beadMesh.setMatrixAt(j, matrix.compose(position, quaternion, scale));
        flow.setXY(j, hue, a);
      }
    });
  }

  return {
    root,
    setFlows(flows: EnergyFlows) {
      const k = flows.mguKKw;
      const fromEngine = k < 0 && flows.harvestSource === 'engine';
      engine.target = Math.max(0, flows.engineKw);
      electric.target = fromEngine ? 0 : k;
      clip.target = fromEngine ? -k : 0;
      chargeTarget = THREE.MathUtils.clamp(flows.charge, 0, 1);
    },
    setOpacity(value) {
      alpha = THREE.MathUtils.clamp(value, 0, 1);
    },
    update(dt) {
      root.visible = alpha > 0.002;
      for (const s of streams) {
        s.kw = THREE.MathUtils.damp(s.kw, s.target, RATE, dt);
        const f = Math.min(1, Math.abs(s.kw) / s.fullKw);
        if (!reducedMotion) s.travel += Math.sign(s.kw) * SPEED * (MIN_SPEED + (1 - MIN_SPEED) * f) * dt;
      }
      charge = THREE.MathUtils.damp(charge, chargeTarget, CHARGE_RATE, dt);
      // Energy into the battery (+) or out of it (−), as a fraction of the MGU-K's rating.
      const intoBattery = THREE.MathUtils.clamp((clip.kw - electric.kw) / MGUK_KW, -1, 1);
      if (!reducedMotion) sheen += intoBattery * 0.5 * dt;
      if (!root.visible) return;

      for (const s of streams) placeBeads(s);
      beadMesh.instanceMatrix.needsUpdate = true;
      flow.needsUpdate = true;
      beadMaterial.uniforms.uOpacity.value = alpha;
      beadHidden.uniforms.uOpacity.value = alpha;
      guideMaterial.opacity = GUIDE_OPACITY * alpha;
      guideHidden.opacity = GUIDE_OPACITY * GUIDE_HIDDEN * alpha;
      const g = gaugeMaterial.uniforms;
      g.uOpacity.value = alpha;
      g.uCharge.value = charge;
      g.uFlow.value = intoBattery;
      g.uPhase.value = sheen;
    },
    dispose() {
      root.removeFromParent();
      beadGeometry.dispose();
      guideGeometry.dispose();
      gaugeGeometry.dispose();
      for (const m of [beadMaterial, beadHidden, guideMaterial, guideHidden, gaugeMaterial]) m.dispose();
    },
  };
}

