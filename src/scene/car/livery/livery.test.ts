import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PartMaterials, type MatKey } from '../materials';
import type { PartId } from '../types';
import { applyLivery, prepareLivery } from './apply';
import { COMMON_GLSL, PART } from './glsl/common';
import { isLiveryId, LIVERIES, LIVERY_IDS, SCHEMES } from './schemes';
import { carryLivery, isPainted, paintMaterial, patchShader, restoreMaterial } from './shader';

const FAKE_VERTEX = '#include <common>\nvoid main(){\n#include <begin_vertex>\n}';
const FAKE_FRAGMENT =
  '#include <common>\nvoid main(){\nvec4 diffuseColor = vec4(1.0);\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <opaque_fragment>\n}';
const fakeShader = () => ({ vertexShader: FAKE_VERTEX, fragmentShader: FAKE_FRAGMENT, uniforms: {} as Record<string, { value: unknown }> });

/** Everything about a material that decides how it looks or compiles. */
function snapshot(m: THREE.MeshStandardMaterial) {
  return {
    color: m.color.getHex(),
    roughness: m.roughness,
    metalness: m.metalness,
    emissive: m.emissive.getHex(),
    emissiveIntensity: m.emissiveIntensity,
    vertexColors: m.vertexColors,
    side: m.side,
    transparent: m.transparent,
    opacity: m.opacity,
    depthWrite: m.depthWrite,
    envMapIntensity: m.envMapIntensity,
    onBeforeCompile: m.onBeforeCompile,
    customProgramCacheKey: m.customProgramCacheKey,
    userData: Object.keys(m.userData).sort(),
  };
}

describe('scheme table', () => {
  it('offers clay and the four 2026 teams, in the header order', () => {
    expect(LIVERY_IDS).toEqual(['clay', 'mersedez', 'redbul', 'ferarri', 'mclaran']);
    expect(LIVERIES.map((l) => l.label)).toEqual(['Clay', 'Mersedez', 'Red Bul', 'Ferarri', 'McLaran']);
    expect(LIVERIES.every((l) => l.swatch.length > 0)).toBe(true);
    expect(isLiveryId('ferarri')).toBe(true);
    expect(isLiveryId('williams')).toBe(false);
  });

  it('every scheme is analytic paint in the car frame: no textures, screen-space or world-space lookups', () => {
    for (const id of ['mersedez', 'redbul', 'ferarri', 'mclaran', 'debug'] as const) {
      const glsl = SCHEMES[id].glsl;
      expect(glsl, id).toMatch(/Paint\s+paintAt\s*\(\s*vec3\s+p\s*,\s*vec3\s+n\s*\)/);
      for (const forbidden of ['texture2D', 'texture(', 'gl_FragCoord', 'vViewPosition', 'cameraPosition', 'modelMatrix', 'vWorldPosition', 'viewMatrix']) {
        expect(glsl.includes(forbidden), `${id} uses ${forbidden}`).toBe(false);
      }
    }
  });

  it('writes no marks: nothing in a scheme names a crest, wordmark or sponsor', () => {
    for (const id of ['mersedez', 'redbul', 'ferarri', 'mclaran'] as const) {
      expect(SCHEMES[id].glsl, id).not.toMatch(/logo|crest|wordmark|sponsor|prancing|three.?pointed/i);
    }
  });

  it('shares the part ids between GLSL and TypeScript', () => {
    for (const [name, value] of Object.entries(PART)) {
      const define = { nose: 'PART_NOSE', cell: 'PART_CELL', body: 'PART_BODY', frontWing: 'PART_FWING', rearWing: 'PART_RWING', halo: 'PART_HALO', rim: 'PART_RIM', helmet: 'PART_HELMET' }[name]!;
      expect(COMMON_GLSL).toContain(`#define ${define} ${value}`);
    }
  });
});

describe('paint hook', () => {
  const job = { scheme: 'ferarri', glsl: 'Paint paintAt(vec3 p, vec3 n){return Paint(vec3(1.0),0.3,0.0);}', part: PART.body } as const;

  it('leaves colour, roughness, metalness and every other property alone while painted', () => {
    const m = new THREE.MeshStandardMaterial({ color: 0xd8d4cb, roughness: 0.74, side: THREE.DoubleSide });
    const before = snapshot(m);
    paintMaterial(m, job);
    const painted = snapshot(m);
    expect(isPainted(m)).toBe(true);
    expect({ ...painted, onBeforeCompile: 0, customProgramCacheKey: 0, userData: 0 }).toEqual({ ...before, onBeforeCompile: 0, customProgramCacheKey: 0, userData: 0 });
    expect(painted.onBeforeCompile).not.toBe(before.onBeforeCompile);
  });

  it('restores the clay finish exactly, including hooks and bookkeeping', () => {
    const m = new THREE.MeshStandardMaterial({ color: 0xd8d4cb, roughness: 0.74, side: THREE.DoubleSide });
    const before = snapshot(m);
    paintMaterial(m, job);
    paintMaterial(m, { ...job, scheme: 'mclaran' });
    restoreMaterial(m);
    expect(snapshot(m)).toEqual(before);
    expect(isPainted(m)).toBe(false);
    restoreMaterial(m); // second call is harmless
    expect(snapshot(m)).toEqual(before);
  });

  it('wraps a ghost material\'s own hook and gives each scheme its own program', () => {
    const calls: string[] = [];
    const ghost = new THREE.MeshStandardMaterial();
    ghost.userData.ghost = { value: 0 };
    ghost.onBeforeCompile = () => void calls.push('ghost');
    ghost.customProgramCacheKey = () => 'car-ghost';
    paintMaterial(ghost, job);
    const keyFerarri = ghost.customProgramCacheKey();
    ghost.onBeforeCompile(fakeShader() as never, null as never);
    expect(calls).toEqual(['ghost']);
    paintMaterial(ghost, { ...job, scheme: 'mclaran' });
    expect(keyFerarri).toContain('car-ghost');
    expect(ghost.customProgramCacheKey()).not.toBe(keyFerarri);
    restoreMaterial(ghost);
    expect(ghost.customProgramCacheKey()).toBe('car-ghost');
  });

  it('splices the paint into every stage exactly once', () => {
    const shader = fakeShader();
    patchShader(shader, job);
    expect(shader.uniforms.uPaintPart.value).toBe(PART.body);
    expect(shader.vertexShader).toContain('vPaintPos = paintPos;');
    expect(shader.fragmentShader.match(/Paint paintAt\(vec3 p/g)).toHaveLength(1); // the scheme's definition, once
    expect(shader.fragmentShader).toContain('paintAt(vPaintPos, normalize(vPaintNrm))');
    expect(shader.fragmentShader).toContain('mix(painted.albedo, diffuseColor.rgb, emphasis)');
    expect(shader.fragmentShader).toContain('roughnessFactor = paintRough;');
    expect(shader.fragmentShader).toContain('metalnessFactor = paintMetal;');
    expect(shader.fragmentShader.indexOf('struct Paint')).toBeLessThan(shader.fragmentShader.indexOf('Paint paintAt(vec3 p'));
  });

  it('a ghost created after the solid was painted starts from the same scheme', () => {
    const solid = new THREE.MeshStandardMaterial();
    const ghost = new THREE.MeshStandardMaterial();
    carryLivery(solid, ghost);
    expect(isPainted(ghost)).toBe(false);
    paintMaterial(solid, job);
    carryLivery(solid, ghost);
    expect(isPainted(ghost)).toBe(true);
  });
});

describe('applying a livery to a car', () => {
  const PAINTED_KEYS: Partial<Record<PartId, MatKey>> = {
    nose: 'shellClay',
    survivalCell: 'shellClay',
    bodywork: 'shellClay',
    frontWing: 'carbon',
    rearWing: 'carbon',
    halo: 'metal',
    wheelFL: 'rim',
    driver: 'helmet',
  };
  const UNTOUCHED: [PartId, MatKey][] = [
    ['floor', 'shellCarbon'],
    ['suspensionFront', 'carbonLight'],
    ['wheelFL', 'tyrePlain'],
    ['powerUnit', 'engine'],
  ];

  function carWith(...ids: PartId[]) {
    const entries = ids.map((id) => {
      const materials = new PartMaterials();
      const key = PAINTED_KEYS[id] ?? UNTOUCHED.find(([u]) => u === id)![1];
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), materials.get(key));
      mesh.position.set(0.5, 0.4, 0.2);
      const object = new THREE.Group();
      object.add(mesh);
      object.name = id;
      return { id, object, materials, mesh };
    });
    const root = new THREE.Group();
    for (const e of entries) root.add(e.object);
    root.updateMatrixWorld(true);
    return entries;
  }

  it('paints the shell, wings, halo, rims and helmet and nothing else', () => {
    const entries = carWith('nose', 'survivalCell', 'bodywork', 'frontWing', 'rearWing', 'halo', 'wheelFL', 'driver', 'floor', 'suspensionFront', 'powerUnit');
    applyLivery(entries, 'mersedez');
    for (const e of entries) {
      const painted = e.id in PAINTED_KEYS;
      for (const m of e.materials.materialsFor(PAINTED_KEYS[e.id] ?? 'engine')) expect(isPainted(m), e.id).toBe(painted);
    }
    // a wheel's tyre shares the wheel part but is never painted
    const wheel = carWith('wheelFL')[0];
    applyLivery([wheel], 'ferarri');
    expect(isPainted(wheel.materials.get('rim'))).toBe(true);
    expect(wheel.materials.materialsFor('tyrePlain')).toEqual([]);
  });

  it('switching schemes and returning to clay restores every material to its exact starting state', () => {
    const entries = carWith('nose', 'bodywork', 'frontWing', 'halo', 'wheelFL', 'driver');
    const before = new Map<THREE.Material, ReturnType<typeof snapshot>>();
    for (const e of entries) e.materials.materialsFor(PAINTED_KEYS[e.id]!).forEach((m) => before.set(m, snapshot(m)));
    for (const id of ['mersedez', 'redbul', 'ferarri', 'mclaran', 'mersedez'] as const) applyLivery(entries, id);
    applyLivery(entries, 'clay');
    for (const [m, snap] of before) expect(snapshot(m as THREE.MeshStandardMaterial)).toEqual(snap);
  });

  it('bakes each vertex\'s assembled-car position once, so later movement cannot move the paint', () => {
    const [nose] = carWith('nose');
    const position = nose.mesh.geometry.getAttribute('position');
    const expected = new THREE.Vector3().fromBufferAttribute(position, 3).applyMatrix4(nose.mesh.matrixWorld);
    prepareLivery([nose]);
    const baked = nose.mesh.geometry.getAttribute('paintPos');
    expect(baked).toBeDefined();
    nose.object.position.set(0, 1.2, 0); // explode lifts the part
    nose.object.rotation.z = 0.2; // pitch
    nose.object.updateMatrixWorld(true);
    const afterMove = new THREE.Vector3().fromBufferAttribute(nose.mesh.geometry.getAttribute('paintPos'), 3);
    expect(afterMove.distanceTo(expected)).toBeLessThan(1e-6);
    const normal = new THREE.Vector3().fromBufferAttribute(nose.mesh.geometry.getAttribute('paintNrm'), 3);
    expect(normal.length()).toBeCloseTo(1, 5);
  });

  it('leaves the floor, suspension, tyres and power unit without paint attributes', () => {
    const entries = carWith('floor', 'suspensionFront', 'powerUnit');
    prepareLivery(entries);
    for (const e of entries) expect(e.mesh.geometry.getAttribute('paintPos'), e.id).toBeUndefined();
  });
});
