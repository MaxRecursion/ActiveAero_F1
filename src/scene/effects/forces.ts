/**
 * Force arrows: one 3D arrow per force, sized on a single metres-per-newton scale so their
 * lengths compare honestly, plus a small spec-sheet tag with the value in kN.
 *
 * Each arrow is drawn twice: a normal lit mesh, and a faint "x-ray" ghost that only draws where
 * something is in FRONT of it (depthFunc = GreaterDepth). The floor arrow runs through the
 * bodywork and the weight arrow through the road, so without the ghost the most important
 * force on the car would be mostly invisible.
 */
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { PALETTE } from '../palette';
import type { CarAnchors } from '../car/types';
import type { ForceArrows, ForceArrowsOptions, ForceId, ForceValues } from './types';
import './forces.css';

const SHAFT_RADIUS = 0.036;
const HEAD_LENGTH = 0.16;
const HEAD_RADIUS = 0.08;
/** Below this the arrow would be a stub; hide it rather than draw a misleading blob. */
const MIN_VISIBLE_N = 40;
/** Easing rate for lengths (1/s). ~9 settles in about half a second at any frame rate. */
const EASE_RATE = 9;
const GHOST_OPACITY = 0.28;
/** Weight's shaft is a hair thinner: it is coaxial with the floor arrow, and equal radii z-fight. */
const WEIGHT_SHAFT_RADIUS = 0.028;
/** Minimum px between two tags on screen. */
const TAG_GAP = 4;
/** Gap between the arrow tail and its tag, in metres (world). */
const LABEL_GAP = 0.07;

type Kind = 'downforce' | 'drag' | 'weight';

/**
 * Where the tag sits relative to the arrow on screen:
 *  - 'tail': beyond the tail, continuing the arrow backwards (reads like a callout).
 *  - 'side': beside the tail, perpendicular to the arrow. Used for weight, whose tail (the CG)
 *    sits right under the floor arrow, so a tail-side tag would cover the floor arrow.
 */
type Placement = 'tail' | 'side';

interface ArrowSpec {
  id: ForceId;
  kind: Kind;
  label: string;
  anchor: keyof CarAnchors;
  placement: Placement;
}

const SPECS: readonly ArrowSpec[] = [
  { id: 'frontWing', kind: 'downforce', label: 'Front wing', anchor: 'frontWingCP', placement: 'tail' },
  { id: 'floor', kind: 'downforce', label: 'Floor', anchor: 'floorCP', placement: 'tail' },
  { id: 'rearWing', kind: 'downforce', label: 'Rear wing', anchor: 'rearWingCP', placement: 'tail' },
  { id: 'drag', kind: 'drag', label: 'Drag', anchor: 'dragOrigin', placement: 'tail' },
  { id: 'weight', kind: 'weight', label: 'Weight', anchor: 'cg', placement: 'side' },
];

const hexCss = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

interface Arrow {
  spec: ArrowSpec;
  anchor: THREE.Object3D;
  group: THREE.Group;
  shaft: THREE.Mesh[];
  head: THREE.Mesh[];
  label: CSS2DObject;
  value: HTMLElement;
  text: string;
  target: number;
  current: number;
  enabled: boolean;
  /** World-space tail and unit direction, cached for the label's screen-space placement. */
  tail: THREE.Vector3;
  dir: THREE.Vector3;
  /** Tag size in px, re-measured only after its text changes (0 = not measured yet). */
  width: number;
  height: number;
  /** Vertical px nudge that keeps this tag clear of the others; written to the DOM on change. */
  nudge: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const WORLD_DOWN = new THREE.Vector3(0, -1, 0);

export function createForceArrows(opts: ForceArrowsOptions): ForceArrows {
  const { car, metresPerNewton } = opts;
  const root = new THREE.Group();
  root.name = 'forceArrows';

  // Unit shapes along +Y with their base at the origin; scaled per frame.
  const shaftGeo = new THREE.CylinderGeometry(1, 1, 1, 18, 1).translate(0, 0.5, 0);
  const headGeo = new THREE.ConeGeometry(1, 1, 24, 1).translate(0, 0.5, 0);

  const colours: Record<Kind, number> = {
    downforce: PALETTE.downforce,
    drag: PALETTE.drag,
    weight: PALETTE.weight,
  };
  const solid = {} as Record<Kind, THREE.MeshStandardMaterial>;
  const ghost = {} as Record<Kind, THREE.MeshBasicMaterial>;
  for (const kind of Object.keys(colours) as Kind[]) {
    const color = colours[kind];
    // A touch of emissive keeps the colour saturated on the shadowed side, so blue still
    // reads as "downforce" against the grey clay.
    solid[kind] = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: kind === 'weight' ? 0.1 : 0.28,
      roughness: 0.45,
      metalness: 0,
    });
    ghost[kind] = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: GHOST_OPACITY,
      depthFunc: THREE.GreaterDepth,
      depthWrite: false,
    });
  }

  const arrows = SPECS.map((spec): Arrow => {
    const group = new THREE.Group();
    group.name = `force:${spec.id}`;
    group.visible = false;
    const shaft = [solid[spec.kind], ghost[spec.kind]].map((m) => new THREE.Mesh(shaftGeo, m));
    const head = [solid[spec.kind], ghost[spec.kind]].map((m) => new THREE.Mesh(headGeo, m));
    // Ghosts draw after the opaque pass so the depth they test against is complete.
    shaft[1].renderOrder = head[1].renderOrder = 10;
    group.add(...shaft, ...head);

    const el = document.createElement('div');
    el.className = `fx-tag fx-${spec.kind}`;
    el.style.setProperty('--fx-c', hexCss(colours[spec.kind]));
    const key = document.createElement('i');
    key.className = 'fx-key';
    const name = document.createElement('span');
    name.className = 'fx-name';
    name.textContent = spec.label;
    const value = document.createElement('span');
    value.className = 'fx-val';
    el.append(key, name, value);
    const label = new CSS2DObject(el);
    // Group-local +Y is the arrow direction, so -Y steps back past the tail.
    if (spec.placement === 'tail') label.position.y = -LABEL_GAP;
    group.add(label);
    root.add(group);

    const arrow: Arrow = {
      spec,
      anchor: car.anchors[spec.anchor],
      group,
      shaft,
      head,
      label,
      value,
      text: '',
      target: 0,
      current: 0,
      enabled: true,
      tail: new THREE.Vector3(),
      dir: new THREE.Vector3(0, -1, 0),
      width: 0,
      height: 0,
      nudge: 0,
    };
    // The label renderer calls this for each visible tag; the first call lays out all of them.
    label.onBeforeRender = (_r, _s, camera) => layoutLabels(camera);
    return arrow;
  });
  const byId = new Map(arrows.map((a) => [a.spec.id, a]));

  const carQuat = new THREE.Quaternion();
  const carUp = new THREE.Vector3();
  const carBack = new THREE.Vector3();
  const anchorPos = new THREE.Vector3();

  /** Shaft + head for a total length; short arrows shrink their head so they stay arrow-shaped. */
  function layout(a: Arrow, length: number) {
    const k = Math.min(1, length / (2 * HEAD_LENGTH));
    const headLen = HEAD_LENGTH * k;
    const headR = HEAD_RADIUS * k;
    const shaftLen = Math.max(length - headLen, 1e-4);
    const r = a.spec.kind === 'weight' ? WEIGHT_SHAFT_RADIUS : SHAFT_RADIUS;
    for (const m of a.shaft) m.scale.set(r, shaftLen, r);
    for (const m of a.head) {
      m.position.y = shaftLen;
      m.scale.set(headR, headLen, headR);
    }
  }

  const sTail = new THREE.Vector3();
  const sHead = new THREE.Vector3();
  /**
   * Pick the tag's pivot from the arrow's on-screen direction, so the tag always sits clear of
   * its own arrow — including after the ceiling flip, when downforce arrows point up.
   */
  function placeLabel(a: Arrow, camera: THREE.Camera) {
    sTail.copy(a.tail).project(camera);
    sHead.copy(a.tail).addScaledVector(a.dir, 0.5).project(camera);
    const aspect = (camera as THREE.PerspectiveCamera).aspect ?? 1;
    let dx = (sHead.x - sTail.x) * aspect;
    let dy = -(sHead.y - sTail.y); // CSS y grows downward
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) {
      dx = 0;
      dy = 1;
    } else {
      dx /= len;
      dy /= len;
    }
    if (a.spec.placement === 'side') {
      // Perpendicular, on whichever side is screen-right.
      let px = -dy;
      let py = dx;
      if (px < 0) {
        px = -px;
        py = -py;
      }
      a.label.center.set(0.5 - 0.5 * px, 0.5 - 0.5 * py);
    } else {
      a.label.center.set(0.5 + 0.5 * dx, 0.5 + 0.5 * dy);
    }
  }

  interface Rect {
    arrow: Arrow;
    left: number;
    top: number;
  }
  const rects: Rect[] = [];
  const pivot = new THREE.Vector3();
  let frame = 0;
  let laidOut = -1;

  /**
   * Once per frame: anchor every visible tag to its arrow, then nudge tags vertically until none
   * overlap. Arrows that share a line of sight (floor and weight from above, rear wing and drag
   * from behind) would otherwise stack their tags on top of each other.
   * SPECS order is priority: earlier tags keep their spot, later ones move.
   */
  function layoutLabels(camera: THREE.Camera) {
    if (laidOut === frame) return;
    laidOut = frame;
    const layer = arrows.find((a) => a.label.element.parentElement)?.label.element.parentElement;
    if (!layer) return;
    const W = layer.clientWidth;
    const H = layer.clientHeight;

    rects.length = 0;
    for (const a of arrows) {
      if (!a.group.visible) continue;
      placeLabel(a, camera);
      const el = a.label.element;
      if (a.width === 0 && el.isConnected) {
        a.width = el.offsetWidth;
        a.height = el.offsetHeight;
      }
      pivot.setFromMatrixPosition(a.label.matrixWorld).project(camera);
      const left = (pivot.x * 0.5 + 0.5) * W - a.label.center.x * a.width;
      let top = (-pivot.y * 0.5 + 0.5) * H - a.label.center.y * a.height;
      const base = top;
      // A few passes settle chains of three; more is never needed with five tags.
      for (let pass = 0; pass < 4; pass++) {
        const hit = rects.find(
          (r) =>
            left < r.left + r.arrow.width + TAG_GAP &&
            r.left < left + a.width + TAG_GAP &&
            top < r.top + r.arrow.height + TAG_GAP &&
            r.top < top + a.height + TAG_GAP,
        );
        if (!hit) break;
        top =
          top + a.height / 2 < hit.top + hit.arrow.height / 2
            ? hit.top - a.height - TAG_GAP
            : hit.top + hit.arrow.height + TAG_GAP;
      }
      rects.push({ arrow: a, left, top });
      const nudge = Math.round(top - base);
      if (nudge !== a.nudge) {
        a.nudge = nudge;
        el.style.translate = nudge ? `0 ${nudge}px` : '';
      }
    }
  }

  function setForces(values: ForceValues) {
    for (const a of arrows) a.target = Math.max(0, values[a.spec.id]);
  }

  function setVisible(id: ForceId, visible: boolean) {
    const a = byId.get(id);
    if (a) a.enabled = visible;
  }

  function update(rawDt: number) {
    // Never step backwards: a negative dt makes damp() overshoot wildly.
    const dt = Math.max(0, rawDt);
    frame++;
    car.root.getWorldQuaternion(carQuat);
    carUp.set(0, 1, 0).applyQuaternion(carQuat);
    carBack.set(-1, 0, 0).applyQuaternion(carQuat);

    for (const a of arrows) {
      a.current = THREE.MathUtils.damp(a.current, a.target, EASE_RATE, dt);
      const show = a.enabled && a.current >= MIN_VISIBLE_N;
      a.group.visible = show;
      if (!show) continue;

      const length = a.current * metresPerNewton;
      a.anchor.getWorldPosition(anchorPos);
      if (a.spec.kind === 'downforce') {
        // Head touches the surface: the air pushes ON the wing, so the arrow ends there.
        a.dir.copy(carUp).negate();
        a.tail.copy(anchorPos).addScaledVector(carUp, length);
      } else {
        a.dir.copy(a.spec.kind === 'drag' ? carBack : WORLD_DOWN);
        a.tail.copy(anchorPos);
      }
      a.group.position.copy(a.tail);
      a.group.quaternion.setFromUnitVectors(UP, a.dir);
      layout(a, length);

      const text = `${(a.current / 1000).toFixed(1)} kN`;
      if (text !== a.text) {
        a.text = text;
        a.value.textContent = text;
        a.width = 0; // re-measure at the next layout
      }
    }
  }

  function dispose() {
    for (const a of arrows) {
      a.label.element.remove();
      a.group.remove(a.label);
    }
    root.removeFromParent();
    shaftGeo.dispose();
    headGeo.dispose();
    for (const m of [...Object.values(solid), ...Object.values(ghost)]) m.dispose();
  }

  return { root, setForces, setVisible, update, dispose };
}
