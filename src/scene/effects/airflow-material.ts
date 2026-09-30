/**
 * LineMaterial with four small additions for flowing air:
 *  - a per-segment fade (`instanceFade*`, vec3 = opacity, x-ray weight, width scale), so all
 *    streamlines share ONE geometry and one draw call — the bridge segments between lines get
 *    opacity 0 — and the under-floor lines (the lesson) can be drawn bolder than the context;
 *  - a faint continuous "rail" under bright "comet" dashes: the rail shows the streamline's shape
 *    in a still frame, and each dash brightens from tail to head so its direction of travel reads;
 *  - an X-RAY variant that draws only where the line is hidden (depthFunc = Greater), in a lifted
 *    tint so it reads over the dark carbon floor. The under-floor lines are the lesson, and from
 *    any camera above the road the floor hides them;
 *  - ACTIVE AERO: every segment also carries its Straight Mode position, time-of-flight and colour
 *    (`instanceOpen*`), and the `activeAero` uniform (0 = Corner … 1 = Straight Mode) blends to
 *    them in the vertex shader — so the flaps' 400 ms transition costs one uniform per frame.
 *
 * Per-line dash SPEED needs no shader change: the dash coordinate is time-of-flight, not length
 * (see airflow.ts), so one uniform dashOffset moves every dash at its own local speed.
 */
import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { PALETTE } from '../palette';

export interface FlowMaterialOptions {
  linewidth: number;
  dashSize: number;
  gapSize: number;
  /** Draw only where occluded, weighted by each line's x-ray value. */
  xray: boolean;
}

/** Opacity of the rail between dashes, and of a dash's tail (its head is 1). */
const RAIL = 0.4;
const COMET_TAIL = 0.4;
/** How far x-rayed lines are lifted toward white: saturated blue alone sinks into carbon. */
const XRAY_LIFT = 0.35;

function patch(source: string, find: string, replace: string): string {
  if (!source.includes(find)) throw new Error(`airflow material: shader chunk not found: ${find}`);
  return source.replace(find, replace);
}

export function createFlowMaterial(opts: FlowMaterialOptions): LineMaterial {
  const material = new LineMaterial({
    linewidth: opts.linewidth,
    vertexColors: true,
    dashed: true,
    dashSize: opts.dashSize,
    gapSize: opts.gapSize,
    transparent: true,
    depthWrite: false,
    worldUnits: false,
  });
  if (opts.xray) {
    material.defines.FLOW_XRAY = '';
    material.depthFunc = THREE.GreaterDepth;
  }

  material.vertexShader = patch(
    patch(
      material.vertexShader,
      'attribute vec3 instanceColorEnd;',
      `attribute vec3 instanceColorEnd;
      attribute vec3 instanceFadeStart;
      attribute vec3 instanceFadeEnd;
      attribute vec4 instanceOpenStart; // xyz, time-of-flight
      attribute vec4 instanceOpenEnd;
      attribute vec3 instanceOpenColorStart;
      attribute vec3 instanceOpenColorEnd;
      uniform float activeAero;
      uniform float flowSlowdown;
      uniform vec3 stillFlowColor;
      varying float vFade;`,
    ),
    'void main() {',
    `void main() {
      vec3 fade = ( position.y < 0.5 ) ? instanceFadeStart : instanceFadeEnd;
      #ifdef FLOW_XRAY
        vFade = fade.x * fade.y;
      #else
        vFade = fade.x;
      #endif`,
  );
  material.vertexShader = [
    ['offset *= linewidth;', 'offset *= linewidth * fade.z;'],
    [
      'vColor.xyz = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;',
      `vColor.xyz = ( position.y < 0.5 )
        ? mix( instanceColorStart, instanceOpenColorStart, activeAero )
        : mix( instanceColorEnd, instanceOpenColorEnd, activeAero );
        vColor.xyz = mix( vColor.xyz, stillFlowColor, flowSlowdown );`,
    ],
    [
      'vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );',
      'vec4 start = modelViewMatrix * vec4( mix( instanceStart, instanceOpenStart.xyz, activeAero ), 1.0 );',
    ],
    [
      'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );',
      'vec4 end = modelViewMatrix * vec4( mix( instanceEnd, instanceOpenEnd.xyz, activeAero ), 1.0 );',
    ],
    [
      'float lineDistanceStart = dashScale * instanceDistanceStart;',
      'float lineDistanceStart = dashScale * mix( instanceDistanceStart, instanceOpenStart.w, activeAero );',
    ],
    [
      'float lineDistanceEnd = dashScale * instanceDistanceEnd;',
      'float lineDistanceEnd = dashScale * mix( instanceDistanceEnd, instanceOpenEnd.w, activeAero );',
    ],
  ].reduce((src, [find, replace]) => patch(src, find, replace), material.vertexShader);
  material.uniforms.activeAero = { value: 0 };
  material.uniforms.flowSlowdown = { value: 0 };
  material.uniforms.stillFlowColor = { value: new THREE.Color(PALETTE.background) };

  material.fragmentShader = patch(
    patch(material.fragmentShader, 'uniform float opacity;', 'uniform float opacity;\nvarying float vFade;'),
    'if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX',
    `if ( vFade < 0.004 ) discard;
      float dashPhase = mod( vLineDistance + dashOffset, dashSize + gapSize );
      float comet = mix( ${COMET_TAIL.toFixed(2)}, 1.0, smoothstep( 0.0, dashSize, dashPhase ) );
      alpha *= vFade * ( dashPhase > dashSize ? ${RAIL.toFixed(2)} : comet );`,
  );
  if (opts.xray) {
    material.fragmentShader = patch(
      material.fragmentShader,
      '#include <color_fragment>',
      `#include <color_fragment>
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 1.0 ), ${XRAY_LIFT.toFixed(2)} );`,
    );
  }
  return material;
}
