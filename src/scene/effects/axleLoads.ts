/**
 * Axle-load arrows, Station 4: one vertical arrow beside each axle, its head on the road. The
 * solid arrow is the load on the axle now; the faint wire arrow around it is the load without the
 * braking transfer (weight + downforce), so where the solid one is longer, weight has been thrown
 * onto that axle, and where it is shorter, it has been taken off. One length scale for both, so
 * the two compare honestly.
 */
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { AXLE_X, HALF_WIDTH } from '../car/dims';
import { PALETTE } from '../palette';
import { prefersReducedMotion } from '../stage';
import type { AxleLoads, AxleLoadsOptions, AxleLoadValues } from './types';
import './forces.css';
import './axleLoads.css';

const SHAFT_RADIUS = 0.036;
const HEAD_LENGTH = 0.16;
const HEAD_RADIUS = 0.08;
/** The wire outline is a little wider than the solid arrow, so the solid one shows inside it. */
const OUTLINE_SCALE = 1.4;
const OUTLINE_OPACITY = 0.55;
/** Easing rate for lengths (1/s), the same as the force arrows. */
const EASE_RATE = 9;
/** Arrows stand this far outside the tyres' outer faces, and this far ahead of / behind the axle line, m. */
const SIDE_CLEARANCE = 0.3;
const AXLE_OFFSET = 0.62;
/** The arrow tip stops a hair above the road so it does not flicker against it. */
const TIP_HEIGHT = 0.012;
const LABEL_GAP = 0.07;
/** Below this many newtons of difference the tag shows no change. */
const MIN_DELTA_N = 50;
const SIDES = 8;

type Axle = 'front' | 'rear';

interface Arrow {
  group: THREE.Group;
  shaft: THREE.Mesh;
  head: THREE.Mesh;
  outlineShaft: THREE.LineSegments;
  outlineHead: THREE.LineSegments;
  label: CSS2DObject;
  value: HTMLElement;
  delta: HTMLElement;
  text: string;
  deltaText: string;
  target: number;
  targetStatic: number;
  length: number;
  staticLength: number;
}

const hexCss = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
const NAMES: Record<Axle, string> = { front: 'Front axle', rear: 'Rear axle' };

export function createAxleLoads({ car, metresPerNewton, formatForce }: AxleLoadsOptions): AxleLoads {
  const root = new THREE.Group();
  root.name = 'axleLoads';
  root.visible = false;
  const rate = prefersReducedMotion() ? 60 : EASE_RATE;

  // Unit shapes along +Y with their base at the origin; scaled per frame. The group is turned
  // upside down, so +Y is the arrow's direction, down, and its origin the tail.
  const shaftGeo = new THREE.CylinderGeometry(1, 1, 1, SIDES, 1).translate(0, 0.5, 0);
  const headGeo = new THREE.ConeGeometry(1, 1, SIDES, 1).translate(0, 0.5, 0);
  const shaftEdges = new THREE.EdgesGeometry(shaftGeo, 20);
  const headEdges = new THREE.EdgesGeometry(headGeo, 20);
  // Always transparent, so fading in and out never recompiles a shader.
  const solid = new THREE.MeshStandardMaterial({
    color: PALETTE.weight,
    emissive: PALETTE.weight,
    emissiveIntensity: 0.1,
    roughness: 0.45,
    transparent: true,
  });
  const outline = new THREE.LineBasicMaterial({ color: PALETTE.weight, transparent: true });

  const make = (axle: Axle): Arrow => {
    const group = new THREE.Group();
    group.name = `axleLoad:${axle}`;
    group.rotation.x = Math.PI;
    const shaft = new THREE.Mesh(shaftGeo, solid);
    const head = new THREE.Mesh(headGeo, solid);
    const outlineShaft = new THREE.LineSegments(shaftEdges, outline);
    const outlineHead = new THREE.LineSegments(headEdges, outline);
    group.add(shaft, head, outlineShaft, outlineHead);
    group.position.x = AXLE_X[axle] + (axle === 'front' ? AXLE_OFFSET : -AXLE_OFFSET);
    group.position.z = HALF_WIDTH + SIDE_CLEARANCE;

    const el = document.createElement('div');
    el.className = 'fx-tag';
    el.style.setProperty('--fx-c', hexCss(PALETTE.weight));
    const key = document.createElement('i');
    key.className = 'fx-key';
    const name = document.createElement('span');
    name.className = 'fx-name';
    name.textContent = NAMES[axle];
    const value = document.createElement('span');
    value.className = 'fx-val';
    const delta = document.createElement('span');
    delta.className = 'fx-delta';
    el.append(key, name, value, delta);
    const label = new CSS2DObject(el);
    // Group-local +Y is down, so -Y is up; the tag stands on the tail (positioned each frame).
    label.center.set(0.5, 1);
    group.add(label);
    root.add(group);
    return { group, shaft, head, outlineShaft, outlineHead, label, value, delta, text: '', deltaText: '', target: 0, targetStatic: 0, length: 0, staticLength: 0 };
  };
  const arrows: Record<Axle, Arrow> = { front: make('front'), rear: make('rear') };
  let opacity = 0;

  /** Shaft and head for a total length; short arrows shrink their head so they stay arrow-shaped. */
  function layout(shaft: THREE.Object3D, head: THREE.Object3D, length: number, widen: number) {
    const k = Math.min(1, length / (2 * HEAD_LENGTH));
    const headLength = HEAD_LENGTH * k;
    const shaftLength = Math.max(length - headLength, 1e-4);
    shaft.scale.set(SHAFT_RADIUS * widen, shaftLength, SHAFT_RADIUS * widen);
    head.position.y = shaftLength;
    head.scale.set(HEAD_RADIUS * k * widen, headLength, HEAD_RADIUS * k * widen);
  }

  function setLoads(v: AxleLoadValues) {
    arrows.front.target = Math.max(0, v.frontN);
    arrows.front.targetStatic = Math.max(0, v.frontStaticN);
    arrows.rear.target = Math.max(0, v.rearN);
    arrows.rear.targetStatic = Math.max(0, v.rearStaticN);
  }

  function setOpacity(alpha: number) {
    const next = THREE.MathUtils.clamp(alpha, 0, 1);
    if (next === opacity) return;
    opacity = next;
    root.visible = opacity > 0.004;
    solid.opacity = opacity;
    outline.opacity = opacity * OUTLINE_OPACITY;
    for (const a of Object.values(arrows)) a.label.element.style.opacity = opacity < 0.999 ? String(opacity) : '';
  }

  function update(rawDt: number) {
    if (!root.visible) return;
    // Never step backwards: a negative dt makes damp() overshoot wildly.
    const dt = Math.max(0, rawDt);
    root.position.copy(car.root.position);
    root.quaternion.copy(car.root.quaternion);

    for (const a of Object.values(arrows)) {
      a.length = THREE.MathUtils.damp(a.length, a.target * metresPerNewton, rate, dt);
      a.staticLength = THREE.MathUtils.damp(a.staticLength, a.targetStatic * metresPerNewton, rate, dt);
      // The tail sits above the tip by the arrow's own length; the outline may be taller than that.
      a.group.position.y = TIP_HEIGHT + a.length;
      layout(a.shaft, a.head, a.length, 1);
      const outer = Math.max(a.staticLength, 1e-3);
      layout(a.outlineShaft, a.outlineHead, outer, OUTLINE_SCALE);
      // The outline stands on the same tip, so its tail is `length - outer` from the solid arrow's (negative: higher).
      const tailShift = a.length - outer;
      a.outlineShaft.position.y = tailShift;
      a.outlineHead.position.y += tailShift;
      // The tag sits above whichever tail is higher.
      a.label.position.y = Math.min(0, tailShift) - LABEL_GAP;

      const text = `${formatForce(a.target)} kN`;
      if (text !== a.text) {
        a.text = text;
        a.value.textContent = text;
      }
      const change = a.target - a.targetStatic;
      const deltaText = Math.abs(change) < MIN_DELTA_N ? '' : `${change > 0 ? '+' : '−'}${formatForce(Math.abs(change))}`;
      if (deltaText !== a.deltaText) {
        a.deltaText = deltaText;
        a.delta.textContent = deltaText;
        a.delta.dataset.sign = change > 0 ? '+' : '-';
      }
    }
  }

  function dispose() {
    for (const a of Object.values(arrows)) {
      a.label.element.remove();
      a.group.remove(a.label);
    }
    root.removeFromParent();
    for (const g of [shaftGeo, headGeo, shaftEdges, headEdges]) g.dispose();
    solid.dispose();
    outline.dispose();
  }

  return { root, setLoads, setOpacity, update, dispose };
}
