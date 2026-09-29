/**
 * Materials for the energy flow. All unlit: the beads and the gauge are signals, not objects.
 *
 * Everything sits inside the X-rayed car, so every visible piece is drawn twice: a normal pass,
 * and a SEE-THROUGH pass (depthFunc = Greater) that draws only where solid internals hide it —
 * paler, so a bead running through the engine block reads as "inside" rather than vanishing. The ghost shell writes no depth once see-through, so it never hides them.
 */
import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { PALETTE } from '../palette';

/**
 * The see-through pass is lifted toward white, per hue: hidden beads sit over grey metal and carbon,
 * where slate (itself a grey) would vanish, so slate lifts much further than the saturated green.
 */
const HIDDEN_OPACITY = 0.9;
const HIDDEN_LIFT = { slate: 0.72, green: 0.3 } as const;

/**
 * Keeps an object out of override passes (the GTAO normal/depth pre-pass), which would draw it as
 * an opaque surface and shade ambient occlusion around it.
 */
export function skipOverridePasses(mesh: THREE.Mesh): void {
  const base = mesh.onBeforeRender.bind(mesh);
  mesh.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
    base(renderer, scene, camera, geometry, material, group);
    geometry.drawRange.count = scene.overrideMaterial ? 0 : Infinity;
  };
}

function seeThrough(material: THREE.Material, hidden: boolean): void {
  material.transparent = true;
  material.depthWrite = false;
  if (hidden) material.depthFunc = THREE.GreaterDepth;
}

/**
 * Beads: instanced dashes along +Y with a per-instance `aFlow` = (hue 0 slate … 1 green, alpha).
 * Flat colour, like the airflow's dashes: a comet with a solid head (+Y, the direction of travel,
 * its tip lit toward white) and a tail that fades out, so direction reads even in a still frame.
 */
export function createBeadMaterial(hidden: boolean): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 1 },
      uAlpha: { value: hidden ? HIDDEN_OPACITY : 1 },
      uSlate: { value: new THREE.Color(PALETTE.engine) },
      uGreen: { value: new THREE.Color(PALETTE.energy) },
      uLift: { value: hidden ? new THREE.Vector2(HIDDEN_LIFT.slate, HIDDEN_LIFT.green) : new THREE.Vector2() },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aFlow;
      varying vec2 vFlow;
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vAxial;
      void main() {
        vAxial = position.y;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vNormal = normalMatrix * mat3(instanceMatrix) * normal;
        vView = -mv.xyz;
        vFlow = aFlow;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform float uAlpha;
      uniform vec3 uSlate;
      uniform vec3 uGreen;
      uniform vec2 uLift;
      varying vec2 vFlow;
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vAxial;
      void main() {
        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        float tip = smoothstep(0.3, 0.5, vAxial);
        vec3 colour = mix(mix(uSlate, uGreen, vFlow.x), vec3(1.0), mix(uLift.x, uLift.y, vFlow.x));
        colour = mix(colour, vec3(1.0), 0.35 * tip * facing);
        float tail = smoothstep(-0.5, 0.3, vAxial);
        tail *= tail;
        gl_FragColor = vec4(colour, vFlow.y * uOpacity * uAlpha * tail * mix(0.7, 1.0, facing));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  seeThrough(material, hidden);
  return material;
}

/** Faint guide lines under the beads: per-vertex colour, a hair's width. */
export function createGuideMaterial(hidden: boolean): LineMaterial {
  const material = new LineMaterial({ linewidth: 1.25, vertexColors: true, worldUnits: false });
  seeThrough(material, hidden);
  return material;
}

/** Relative opacity of the guides' see-through pass. */
export const GUIDE_HIDDEN = 0.55;

/**
 * Battery charge gauge: a camera-facing battery glyph (framed body, terminal nub, a row of cells)
 * drawn with signed distances so it stays crisp at any size. Fill = charge; the filled cells carry
 * a slow travelling sheen in the direction energy moves (right while charging, left while deploying).
 */
export function createGaugeMaterial(size: THREE.Vector2): THREE.ShaderMaterial {
  const colour = (hex: number) => new THREE.Color(hex);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSize: { value: size },
      uCharge: { value: 0 },
      uFlow: { value: 0 },
      uPhase: { value: 0 },
      uOpacity: { value: 1 },
      uFill: { value: colour(PALETTE.energy) },
      uFrame: { value: colour(PALETTE.weight) },
      uPlate: { value: colour(PALETTE.background) },
    },
    vertexShader: /* glsl */ `
      uniform vec2 uSize;
      varying vec2 vPos;
      void main() {
        vPos = position.xy * uSize;
        // Billboard: the quad is laid out in view space around the object's origin.
        vec4 centre = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        gl_Position = projectionMatrix * (centre + vec4(vPos, 0.0, 0.0));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec2 uSize;
      uniform float uCharge;
      uniform float uFlow;
      uniform float uPhase;
      uniform float uOpacity;
      uniform vec3 uFill;
      uniform vec3 uFrame;
      uniform vec3 uPlate;
      varying vec2 vPos;

      const float CELLS = 8.0;

      float box(vec2 p, vec2 half_, float r) {
        vec2 q = abs(p) - half_ + r;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }

      void main() {
        float px = length(fwidth(vPos)) * 0.7071;
        float nub = uSize.y * 0.16;
        vec2 bodyHalf = vec2(uSize.x * 0.5 - nub, uSize.y * 0.5) - px;
        vec2 bodyCentre = vec2(-nub * 0.5, 0.0);
        float radius = uSize.y * 0.22;
        float d = box(vPos - bodyCentre, bodyHalf, radius);
        float stroke = max(1.3 * px, uSize.y * 0.06);

        float plate = 1.0 - smoothstep(-px, px, d);
        float frame = plate * smoothstep(-stroke - px, -stroke + px, d);
        float nubD = box(vPos - vec2(bodyCentre.x + bodyHalf.x + nub * 0.5, 0.0), vec2(nub * 0.5, uSize.y * 0.2), nub * 0.3);
        frame = max(frame, 1.0 - smoothstep(-px, px, nubD));

        // Cells inside the frame, with a gap of clear plate between them and the stroke.
        float pad = stroke + uSize.y * 0.1;
        vec2 innerHalf = bodyHalf - pad;
        vec2 q = vPos - bodyCentre;
        float u = (q.x + innerHalf.x) / (2.0 * innerHalf.x);
        float cell = u * CELLS;
        float gap = uSize.y * 0.07 / (2.0 * innerHalf.x) * CELLS;
        float inCell = smoothstep(0.0, px * CELLS / innerHalf.x, min(fract(cell), 1.0 - fract(cell)) - gap * 0.5);
        float inside = (1.0 - smoothstep(-px, px, abs(q.y) - innerHalf.y)) * (1.0 - smoothstep(-px, px, abs(q.x) - innerHalf.x));
        float filled = 1.0 - smoothstep(-px, px, (u - uCharge) * 2.0 * innerHalf.x);
        float sheen = abs(uFlow) * 0.22 * pow(0.5 + 0.5 * sin(6.2832 * (u - uPhase)), 3.0);

        vec3 colour = uPlate;
        float alpha = plate * 0.82;
        float cellAlpha = inside * inCell * mix(0.14, 1.0, filled);
        colour = mix(colour, mix(uFill, vec3(1.0), sheen * filled), cellAlpha);
        colour = mix(colour, uFrame, frame * 0.85);
        alpha = max(alpha, max(cellAlpha, frame * 0.85));
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(colour, alpha * uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  return material;
}
