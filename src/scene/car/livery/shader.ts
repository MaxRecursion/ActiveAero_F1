/**
 * Puts a scheme's paint on an existing material, and takes it off again.
 *
 * Nothing about the material itself changes while it is painted: colour, roughness, metalness,
 * maps, vertex colours and emissive stay exactly as the clay finish has them. The paint is a
 * shader hook that overrides the albedo and the roughness / metalness factors per fragment from
 * the rest-pose position on the vertices. Removing the hook puts back the two properties it
 * replaced, so clay is the same program and the same state it was before any paint was applied.
 * Ghost (X-ray) materials take the same hook beside their own, so the shell ghosts as before.
 */
import * as THREE from 'three';
import { COMMON_GLSL, type PaintPart } from './glsl/common';

export interface PaintJob {
  /** Scheme id: part of the program cache key, so schemes never share a compiled program. */
  scheme: string;
  /** GLSL defining `Paint paintAt(vec3 p, vec3 n)`. */
  glsl: string;
  part: PaintPart;
}

interface Saved {
  onBeforeCompile: THREE.Material['onBeforeCompile'];
  customProgramCacheKey: THREE.Material['customProgramCacheKey'];
}

const SAVED = 'liverySaved';
const JOB = 'liveryJob';

const VERTEX_ATTRIBUTES = 'attribute vec3 paintPos;\nattribute vec3 paintNrm;\n';

// While a part is emphasised (setHighlight) the material's emissive is non-zero: the paint steps aside to
// the plain clay colour, so the highlight reads exactly as it does on the clay car.
const COLOUR_BLOCK = `
float paintRough = roughness;
float paintMetal = metalness;
{
  Paint painted = paintAt(vPaintPos, normalize(vPaintNrm));
  float emphasis = clamp(length(emissive) * 4.0, 0.0, 1.0);
  diffuseColor.rgb = mix(painted.albedo, diffuseColor.rgb, emphasis);
  paintRough = mix(painted.rough, roughness, emphasis);
  paintMetal = mix(painted.metal, metalness, emphasis);
}`;

/** The rewritten shader sources for one painted material. Exported so tests can check the splice. */
export function patchShader(
  shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, { value: unknown }> },
  job: PaintJob,
): void {
  shader.uniforms.uPaintPart = { value: job.part };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERTEX_ATTRIBUTES}varying vec3 vPaintPos;\nvarying vec3 vPaintNrm;`)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaintPos = paintPos;\nvPaintNrm = paintNrm;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${COMMON_GLSL}\n${job.glsl}`)
    .replace('#include <color_fragment>', `#include <color_fragment>${COLOUR_BLOCK}`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = paintRough;')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = paintMetal;');
}

/** Paint `material` with `job`, remembering how to undo it. Safe to call again with another scheme. */
export function paintMaterial(material: THREE.Material, job: PaintJob): void {
  const known = material.userData[SAVED] as Saved | undefined;
  const saved: Saved = known ?? {
    onBeforeCompile: material.onBeforeCompile,
    customProgramCacheKey: material.customProgramCacheKey,
  };
  material.userData[SAVED] = saved;
  material.userData[JOB] = job;
  material.onBeforeCompile = (shader, renderer) => {
    saved.onBeforeCompile.call(material, shader, renderer);
    patchShader(shader, job);
  };
  material.customProgramCacheKey = () => `${saved.customProgramCacheKey.call(material)}|livery:${job.scheme}`;
  material.needsUpdate = true;
}

/** Take the paint off. A material that was never painted is left alone. */
export function restoreMaterial(material: THREE.Material): void {
  const saved = material.userData[SAVED] as Saved | undefined;
  if (!saved) return;
  material.onBeforeCompile = saved.onBeforeCompile;
  material.customProgramCacheKey = saved.customProgramCacheKey;
  delete material.userData[SAVED];
  delete material.userData[JOB];
  material.needsUpdate = true;
}

export const isPainted = (material: THREE.Material): boolean => material.userData[SAVED] !== undefined;

/**
 * A ghost built after its solid was painted starts from the same scheme. No-op while the solid is
 * clay; a ghost created first is painted later with the rest of its set.
 */
export function carryLivery(from: THREE.Material, to: THREE.Material): void {
  const job = from.userData[JOB] as PaintJob | undefined;
  if (job) paintMaterial(to, job);
}
