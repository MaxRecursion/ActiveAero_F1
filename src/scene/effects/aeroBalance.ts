/**
 * Aero balance marker, Station 6: where the downforce's resultant acts between the axles.
 *
 * A blue pointer rides the near rail of the rolling road (whose metre ruler gives the scale), and a
 * small dark tick on the same rail marks where the weight acts (the centre of gravity). The balance is
 * the pointer's share of the wheelbase measured from the rear axle, so one point of balance is 34 mm
 * along the car: pointer ahead of the tick, the air loads the front tyres more than the weight does.
 *
 * Fed plain numbers by the garage; imports no physics.
 */
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { AXLE_X, HALF_WIDTH } from '../car/dims';
import { PALETTE } from '../palette';
import { prefersReducedMotion } from '../stage';
import './forces.css';

/** Pointer cone: tip on the rail, point down. */
const POINTER_RADIUS = 0.045;
const POINTER_HEIGHT = 0.11;
/** Weight tick: a slimmer, shorter cone in the weight colour. */
const TICK_RADIUS = 0.022;
const TICK_HEIGHT = 0.07;
/** Top of the road's side rails (tunnel.ts) and their distance from the car's centre line, m. */
const RAIL_TOP_Y = 0.014;
const RAIL_Z = HALF_WIDTH + 0.29;
const LABEL_GAP = 0.03;
/** Easing rate for the pointer's position (1/s), the same as the force arrows' lengths. */
const EASE_RATE = 9;
const WEIGHT_OPACITY = 0.7;

const hexCss = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
const WHEELBASE = AXLE_X.front - AXLE_X.rear;
/** x of a point `share` of the wheelbase ahead of the rear axle. */
const xOf = (share: number) => AXLE_X.rear + share * WHEELBASE;

export interface AeroBalanceOptions {
  /** The pointer follows the car's root (it only moves in the ceiling test). */
  car: { root: THREE.Object3D };
  /** Share of the weight on the front axle (0–1): where the tick stands. */
  weightFrontShare: number;
  /** Tag text from a front share (0–1), e.g. "46.5 % front". */
  formatShare: (frontShare: number) => string;
}

export interface AeroBalance {
  /** Car frame; parent it to the car rig. Hidden while its opacity is 0. */
  root: THREE.Group;
  /** Share of the downforce on the front axle (0–1). The pointer eases there; the tag names the true value. */
  setShare(frontShare: number): void;
  /** 0–1 overall opacity (pointer, tick and tag). */
  setOpacity(alpha: number): void;
  update(dt: number): void;
  dispose(): void;
}

export function createAeroBalance({ car, weightFrontShare, formatShare }: AeroBalanceOptions): AeroBalance {
  const root = new THREE.Group();
  root.name = 'aeroBalance';
  root.visible = false;
  const rate = prefersReducedMotion() ? 60 : EASE_RATE;

  // Cones point up by default; turned over, with their tips at the origin.
  const pointerGeo = new THREE.ConeGeometry(POINTER_RADIUS, POINTER_HEIGHT, 24, 1).rotateX(Math.PI).translate(0, POINTER_HEIGHT / 2, 0);
  const tickGeo = new THREE.ConeGeometry(TICK_RADIUS, TICK_HEIGHT, 16, 1).rotateX(Math.PI).translate(0, TICK_HEIGHT / 2, 0);
  // Always transparent, so fading in and out never recompiles a shader.
  const pointerMat = new THREE.MeshStandardMaterial({
    color: PALETTE.downforce,
    emissive: PALETTE.downforce,
    emissiveIntensity: 0.28,
    roughness: 0.45,
    transparent: true,
  });
  const tickMat = new THREE.MeshStandardMaterial({ color: PALETTE.weight, roughness: 0.6, transparent: true });

  const pointer = new THREE.Mesh(pointerGeo, pointerMat);
  pointer.name = 'aeroBalance:pointer';
  pointer.position.set(xOf(0.5), RAIL_TOP_Y, RAIL_Z);
  const tick = new THREE.Mesh(tickGeo, tickMat);
  tick.name = 'aeroBalance:weight';
  tick.position.set(xOf(weightFrontShare), RAIL_TOP_Y, RAIL_Z);
  root.add(pointer, tick);

  const el = document.createElement('div');
  el.className = 'fx-tag';
  el.style.setProperty('--fx-c', hexCss(PALETTE.downforce));
  const key = document.createElement('i');
  key.className = 'fx-key';
  const name = document.createElement('span');
  name.className = 'fx-name';
  name.textContent = 'Aero balance';
  const value = document.createElement('span');
  value.className = 'fx-val';
  el.append(key, name, value);
  const label = new CSS2DObject(el);
  label.center.set(0.5, 1);
  label.position.y = POINTER_HEIGHT + LABEL_GAP;
  pointer.add(label);

  let share = 0.5;
  let shownX = Number.NaN;
  let text = '';
  let opacity = 0;

  function setOpacity(alpha: number) {
    const next = THREE.MathUtils.clamp(alpha, 0, 1);
    if (next === opacity) return;
    opacity = next;
    root.visible = opacity > 0.004;
    pointerMat.opacity = opacity;
    tickMat.opacity = opacity * WEIGHT_OPACITY;
    el.style.opacity = opacity < 0.999 ? String(opacity) : '';
  }

  function update(rawDt: number) {
    if (!root.visible) return;
    const dt = Math.max(0, rawDt);
    root.position.copy(car.root.position);
    root.quaternion.copy(car.root.quaternion);
    const x = xOf(share);
    // The first frame it shows, the pointer starts where it belongs rather than sliding in from mid-car.
    shownX = Number.isNaN(shownX) ? x : THREE.MathUtils.damp(shownX, x, rate, dt);
    pointer.position.x = shownX;
    const next = formatShare(share);
    if (next !== text) {
      text = next;
      value.textContent = next;
    }
  }

  return {
    root,
    setShare(frontShare) {
      if (Number.isFinite(frontShare)) share = THREE.MathUtils.clamp(frontShare, 0, 1);
    },
    setOpacity,
    update,
    dispose() {
      el.remove();
      pointer.remove(label);
      root.removeFromParent();
      pointerGeo.dispose();
      tickGeo.dispose();
      pointerMat.dispose();
      tickMat.dispose();
    },
  };
}
