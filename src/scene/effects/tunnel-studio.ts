/**
 * Studio floor: an "infinity cove". The floor IS the background colour, by construction, and
 * only carries what grounds the scene: the key light's shadow and a faint engineering grid,
 * both fading out radially. A lit floor never quite matches a flat background (tone mapping,
 * light changes), and any mismatch shows as a horizon line; this one cannot show one.
 *
 * How: a ShadowMaterial (it exposes the shadow mask) whose final colour is written AFTER the
 * fog stage, using the fog colour. three.js keeps the fog colour in the same space as the
 * background on every render path, so the floor matches the background exactly. Requires
 * `scene.fog` with the background colour (the stage sets it); otherwise it falls back to
 * PALETTE.background.
 */
import * as THREE from 'three';
import { PALETTE } from '../palette';

/**
 * Studio floor height. The rolling-road deck (top at y = 0) stands on it, so the deck's edge
 * and rollers read as a real piece of tunnel equipment rather than a decal.
 */
export const STUDIO_FLOOR_Y = -0.12;

const FLOOR_RADIUS = 40;
/** Shadow darkening at full strength (0–1). Soft: a studio, not a noon car park. */
const SHADOW_STRENGTH = 0.32;
/** Where shadow and grid fade to nothing (m from the centre). */
const FADE_START = 4.5;
const FADE_END = 12;
/** The grid fades sooner so it never aliases toward the horizon. */
const GRID_FADE_START = 2.5;
const GRID_FADE_END = 8;

export interface Studio {
  group: THREE.Group;
  dispose(): void;
}

const f = (n: number) => n.toFixed(3);

export function createStudio(): Studio {
  const group = new THREE.Group();
  group.name = 'studio';

  const material = new THREE.ShadowMaterial({ transparent: false });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFallback = { value: new THREE.Color(PALETTE.background) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStudioPos;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvStudioPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
varying vec3 vStudioPos;
uniform vec3 uFallback;
// Anti-aliased grid line (1 = on the line). Fades where cells shrink to a few pixels,
// which is where moiré would start.
float studioGrid(vec2 p, float spacing, float widthPx) {
  vec2 c = p / spacing;
  vec2 w = fwidth(c);
  vec2 g = abs(fract(c - 0.5) - 0.5) / max(w, 1e-5);
  float line = 1.0 - min(min(g.x, g.y) / widthPx, 1.0);
  return line * (1.0 - smoothstep(0.1, 0.3, max(w.x, w.y)));
}`,
      )
      .replace(
        '#include <premultiplied_alpha_fragment>',
        /* glsl */ `{
  float r = length(vStudioPos.xz);
  #ifdef USE_FOG
    vec3 bg = fogColor;
  #else
    vec3 bg = uFallback;
  #endif
  float shadow = (1.0 - getShadowMask()) * ${f(SHADOW_STRENGTH)}
    * (1.0 - smoothstep(${f(FADE_START)}, ${f(FADE_END)}, r));
  float gridFade = 1.0 - smoothstep(${f(GRID_FADE_START)}, ${f(GRID_FADE_END)}, r);
  float grid = max(studioGrid(vStudioPos.xz, 0.25, 1.0) * 0.05,
                   studioGrid(vStudioPos.xz, 1.0, 1.25) * 0.12) * gridFade;
  vec3 c = bg * (1.0 - shadow);
  gl_FragColor = vec4(mix(c, bg * 0.35, grid), 1.0);
}`,
      );
  };

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(FLOOR_RADIUS, 128).rotateX(-Math.PI / 2),
    material,
  );
  floor.name = 'studioFloor';
  floor.position.y = STUDIO_FLOOR_Y;
  floor.receiveShadow = true;
  group.add(floor);

  return {
    group,
    dispose() {
      group.removeFromParent();
      floor.geometry.dispose();
      material.dispose();
    },
  };
}
