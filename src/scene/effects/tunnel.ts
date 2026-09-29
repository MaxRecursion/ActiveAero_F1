/**
 * Wind tunnel: a calm studio (world space) and a rolling road (car frame).
 *
 * The rolling road is how real tunnels make the ground move relative to the car: a steel belt
 * runs backward under the tyres at air speed, so the floor sees the right flow. Here its
 * markings move at visualSpeed(kmh), the same slowed-down time-scale as the wheels and the
 * airflow, so all three agree. At speed the markings streak (a small in-shader motion blur)
 * instead of strobing.
 */
import * as THREE from 'three';
import { PALETTE } from '../palette';
import { visualSpeed } from '../motion';
import { createStudio, STUDIO_FLOOR_Y } from './tunnel-studio';
import { BELT_TILE_M, RULER_FONTS, createBeltTexture, createRulerTexture } from './tunnel-textures';
import type { WindTunnel } from './types';

export { STUDIO_FLOOR_Y };

const BELT_LENGTH = 7.5;
const BELT_WIDTH = 2.3;
/** Deck height: belt top at y = 0 down to the studio floor. Rollers fill it. */
const DECK_DEPTH = -STUDIO_FLOOR_Y;
const ROLLER_R = DECK_DEPTH / 2;
const RAIL_WIDTH = 0.16;
const RAIL_TOP = 0.014;
const RAIL_LENGTH = 7.68;
/** Exposure time of the imaginary camera, for the streak length (s). */
const SHUTTER_S = 1 / 24;

/**
 * Average several texture samples along the direction of travel (u). The blur length uniform
 * is in texture tiles, shared by the belt and the rollers (both map 1 tile = 1 m of surface).
 */
function addMotionBlur(material: THREE.MeshStandardMaterial, blur: { value: number }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBlur = blur;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uBlur;')
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#ifdef USE_MAP
  vec4 sampledDiffuseColor = vec4(0.0);
  for (int i = 0; i < 9; i++) {
    float t = (float(i) / 8.0 - 0.5) * uBlur;
    sampledDiffuseColor += texture2D(map, vMapUv + vec2(t, 0.0));
  }
  diffuseColor *= sampledDiffuseColor / 9.0;
#endif`,
      );
  };
}

export function createWindTunnel(): WindTunnel {
  const studio = createStudio();

  const road = new THREE.Group();
  road.name = 'rollingRoad';

  const blur = { value: 0 };
  let speedKmh = 0;

  // ── belt ─────────────────────────────────────────────────────────────────────
  const beltTex = createBeltTexture(BELT_WIDTH);
  beltTex.repeat.set(BELT_LENGTH / BELT_TILE_M, 1);
  const beltMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: beltTex, roughness: 0.82 });
  addMotionBlur(beltMat, blur);
  const beltTop = new THREE.Mesh(
    new THREE.PlaneGeometry(BELT_LENGTH, BELT_WIDTH).rotateX(-Math.PI / 2),
    beltMat,
  );
  beltTop.receiveShadow = true;

  // The belt's body sits just under the top plane so their faces never coincide.
  const bodyMat = new THREE.MeshStandardMaterial({ color: PALETTE.belt, roughness: 0.8 });
  const beltBody = new THREE.Mesh(new THREE.BoxGeometry(BELT_LENGTH, DECK_DEPTH - 0.004, BELT_WIDTH - 0.01), bodyMat);
  beltBody.position.y = -DECK_DEPTH / 2 - 0.002;
  beltBody.castShadow = beltBody.receiveShadow = true;

  // ── rollers: the belt wraps them, so they carry the same markings and spin with it ──
  const rollerTex = beltTex.clone();
  rollerTex.repeat.set((2 * Math.PI * ROLLER_R) / BELT_TILE_M, 1);
  const rollerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: rollerTex, roughness: 0.7 });
  addMotionBlur(rollerMat, blur);
  const rollerGeo = new THREE.CylinderGeometry(ROLLER_R, ROLLER_R, BELT_WIDTH - 0.01, 40).rotateX(Math.PI / 2);
  const rollers = [1, -1].map((side) => {
    const m = new THREE.Mesh(rollerGeo, rollerMat);
    m.position.set((side * BELT_LENGTH) / 2, -ROLLER_R, 0);
    m.castShadow = m.receiveShadow = true;
    return m;
  });

  // ── side rails (frame) + ruler ────────────────────────────────────────────────
  const railMat = new THREE.MeshStandardMaterial({ color: PALETTE.carbon, roughness: 0.6 });
  const railHeight = DECK_DEPTH + RAIL_TOP;
  const railGeo = new THREE.BoxGeometry(RAIL_LENGTH, railHeight, RAIL_WIDTH);
  const railZ = BELT_WIDTH / 2 + RAIL_WIDTH / 2 + 0.01;
  const rails = [1, -1].map((side) => {
    const m = new THREE.Mesh(railGeo, railMat);
    m.position.set(0, (RAIL_TOP - DECK_DEPTH) / 2, side * railZ);
    m.castShadow = m.receiveShadow = true;
    return m;
  });

  const ruler = createRulerTexture(RAIL_LENGTH, railHeight);
  const rulerMat = new THREE.MeshStandardMaterial({
    map: ruler.texture,
    roughness: 0.9,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  // Printed on the outer face of the +Z rail: the side the default cameras look at.
  const rulerMesh = new THREE.Mesh(new THREE.PlaneGeometry(RAIL_LENGTH, railHeight), rulerMat);
  rulerMesh.position.set(0, (RAIL_TOP - DECK_DEPTH) / 2, railZ + RAIL_WIDTH / 2);
  rulerMesh.receiveShadow = true;

  road.add(beltTop, beltBody, ...rollers, ...rails, rulerMesh);

  let disposed = false;
  Promise.all(RULER_FONTS.map((f) => document.fonts.load(f)))
    .then(() => !disposed && ruler.redraw())
    .catch(() => {}); // keep the fallback face

  return {
    studio: studio.group,
    road,
    setSpeed(kmh: number) {
      speedKmh = Math.max(0, kmh);
      blur.value = (visualSpeed(speedKmh) * SHUTTER_S) / BELT_TILE_M;
    },
    update(rawDt: number) {
      const dt = Math.max(0, rawDt); // the belt never runs backwards on a bad first frame
      const v = visualSpeed(speedKmh);
      // Offset growing along u moves the markings toward -X: the belt runs backward under the car.
      beltTex.offset.x = (beltTex.offset.x + (v * dt) / BELT_TILE_M) % 1;
      // Positive spin about +Z moves a roller's top toward -X, matching the belt.
      for (const r of rollers) r.rotation.z = (r.rotation.z + (v / ROLLER_R) * dt) % (2 * Math.PI);
    },
    dispose() {
      disposed = true;
      studio.dispose();
      road.removeFromParent();
      for (const geo of [beltTop.geometry, beltBody.geometry, rollerGeo, railGeo, rulerMesh.geometry]) geo.dispose();
      for (const mat of [beltMat, bodyMat, rollerMat, railMat, rulerMat]) mat.dispose();
      for (const tex of [beltTex, rollerTex, ruler.texture]) tex.dispose();
    },
  };
}
