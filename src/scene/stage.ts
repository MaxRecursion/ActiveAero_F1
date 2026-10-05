/**
 * Stage: renderer, camera + controls, lights, post-processing, label layer and the frame loop.
 * Everything visual is added to `stage.scene`; per-frame work registers with `stage.onFrame`.
 *
 * World conventions (shared by every module):
 *   1 unit = 1 metre. +Y is up. The car points along +X and is symmetric about z = 0.
 *   The ground / rolling road top surface is y = 0.
 */
import * as THREE from 'three';
import CameraControls from 'camera-controls';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { STUDIO_BACKGROUNDS } from './palette';
import { createPerfOverlay, type PerfOverlay } from './perf/perfOverlay';
import type { Theme } from '../theme';

CameraControls.install({ THREE });

export type ShotName = 'hero' | 'side' | 'front' | 'rear' | 'top' | 'low' | 'ceiling';

export interface Shot {
  position: THREE.Vector3Tuple;
  target: THREE.Vector3Tuple;
}

/** Named camera positions. Car points +X; hero is a front three-quarter from the car's right (+Z) side. */
export const SHOTS: Record<ShotName, Shot> = {
  hero: { position: [6.46, 2.56, 7.44], target: [0.1, 0.4, 0] },
  side: { position: [0.0, 0.99, 11.04], target: [0, 0.45, 0] },
  front: { position: [10.56, 1.11, 0.0], target: [0, 0.45, 0] },
  rear: { position: [-9.12, 1.82, 2.64], target: [0, 0.5, 0] },
  top: { position: [0, 11, 0.01], target: [0, 0, 0] }, // tiny +z so the car reads left-to-right
  low: { position: [5.48, 0.28, 4.08], target: [0.2, 0.3, 0] },
  /** Used when the car hangs from the ceiling; target sits near the inverted car. */
  ceiling: { position: [6.7, 0.73, 7.68], target: [0.1, 1.75, 0] },
};

export type FrameCallback = (dt: number, elapsed: number) => void;

/** Longest step a frame may take (s): a hitch slows animation down instead of making it jump. */
const MAX_DT = 0.1;

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface StageOptions {
  /** Element the canvas and label layer are appended to. Should fill the viewport. */
  mount: HTMLElement;
  /** Force a quality tier (0 best … 2 cheapest). Default: auto. */
  quality?: 0 | 1 | 2;
  /** Start at this shot. Default 'hero'. */
  shot?: ShotName;
  /** Preserve the drawing buffer (for headless screenshots). */
  preserveDrawingBuffer?: boolean;
}

export interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: CameraControls;
  /** Label layer (CSS2DObject instances added anywhere in the scene render here). */
  labels: CSS2DRenderer;
  /** Key light — cast shadows. Exposed so modules can tune shadow bounds. */
  keyLight: THREE.DirectionalLight;
  /** Performance read-out over the canvas (P key, or `?perf` in the URL). */
  perf: PerfOverlay;
  onFrame(cb: FrameCallback): () => void;
  goTo(shot: ShotName | Shot, animate?: boolean): Promise<void>;
  /**
   * Keep the camera's optical centre inside the part of the screen not covered by UI (pixels).
   * The car stays visually centred in the free area instead of hiding behind panels.
   */
  setInsets(insets: Partial<Insets>): void;
  /** Current quality tier (0 = AO on, full DPR; 1 = no AO; 2 = DPR 1, no post). */
  readonly quality: number;
  setQuality(tier: 0 | 1 | 2): void;
  setTheme(theme: Theme): void;
  start(): void;
  dispose(): void;
}

const isCoarsePointer = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;
export const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function createStage(opts: StageOptions): Stage {
  const { mount } = opts;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D view of the car. The panels around it describe what it shows.');
  mount.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'label-layer';
  Object.assign(labels.domElement.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
  });
  mount.appendChild(labels.domElement);

  const perf = createPerfOverlay(renderer, mount);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(STUDIO_BACKGROUNDS.light);
  scene.fog = new THREE.Fog(STUDIO_BACKGROUNDS.light, 22, 48);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  scene.environmentIntensity = 0.45;
  room.dispose();
  pmrem.dispose();

  const hemi = new THREE.HemisphereLight(0xffffff, 0xc9c2b4, 0.5);
  scene.add(hemi);

  // Key light almost overhead and slightly behind the car, so its shadow pools under the car
  // and spills toward the default camera (grounds the model like a studio softbox).
  const keyLight = new THREE.DirectionalLight(0xfffaf2, 2.1);
  keyLight.position.set(1.5, 10, -3);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.radius = 4;
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.02;
  const sc = keyLight.shadow.camera;
  sc.left = -4.5;
  sc.right = 4.5;
  sc.top = 4.5;
  sc.bottom = -4.5;
  sc.near = 1;
  sc.far = 20;
  scene.add(keyLight, keyLight.target);

  const fill = new THREE.DirectionalLight(0xe6ecff, 0.55);
  fill.position.set(6, 3, 7);
  const rim = new THREE.DirectionalLight(0xffffff, 0.7);
  rim.position.set(-7, 4, -2);
  scene.add(fill, rim);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 120);
  const baseFov = camera.fov;

  const controls = new CameraControls(camera, renderer.domElement);
  controls.minDistance = 3.2;
  controls.maxDistance = 18;
  controls.maxPolarAngle = Math.PI * 0.495; // stay above the floor
  controls.smoothTime = 0.35;
  controls.draggingSmoothTime = 0.12;
  controls.dollyToCursor = true;

  const startShot = SHOTS[opts.shot ?? 'hero'];
  controls.setLookAt(...startShot.position, ...startShot.target, false);

  // ── post-processing ───────────────────────────────────────────────────────────
  const rt = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, rt);
  const renderPass = new RenderPass(scene, camera);
  const gtao = new GTAOPass(scene, camera, 1, 1);
  gtao.blendIntensity = 0.85;
  gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.6, thickness: 1.2, scale: 1, samples: 12 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  const output = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(gtao);
  composer.addPass(output);

  let quality: 0 | 1 | 2 = opts.quality ?? (isCoarsePointer() ? 1 : 0);
  const insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

  function pixelRatioFor(tier: number): number {
    const dpr = window.devicePixelRatio || 1;
    if (tier === 2) return 1;
    return Math.min(dpr, tier === 0 ? 2 : 1.5);
  }

  function applyViewOffset(w: number, h: number) {
    // Move the optical centre to the middle of the free area; widen the virtual view so
    // the canvas shows the same vertical scale as without insets.
    const cx = (insets.left + (w - insets.right)) / 2;
    const cy = (insets.top + (h - insets.bottom)) / 2;
    const fullW = 2 * Math.max(cx, w - cx);
    const fullH = 2 * Math.max(cy, h - cy);
    const offX = fullW / 2 - cx;
    const offY = fullH / 2 - cy;
    if (fullW === w && fullH === h) {
      camera.clearViewOffset();
      camera.fov = baseFov;
    } else {
      const halfTan = Math.tan(THREE.MathUtils.degToRad(baseFov / 2)) * (fullH / h);
      camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfTan));
      camera.setViewOffset(fullW, fullH, offX, offY, w, h);
    }
    // The projection is built for the full virtual view; the offset then crops the canvas out of it.
    camera.aspect = fullW / fullH;
    camera.updateProjectionMatrix();
  }

  function resize() {
    const w = mount.clientWidth || window.innerWidth;
    const h = mount.clientHeight || window.innerHeight;
    renderer.setPixelRatio(pixelRatioFor(quality));
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
    composer.setPixelRatio(pixelRatioFor(quality));
    composer.setSize(w, h);
    labels.setSize(w, h);
    applyViewOffset(w, h);
  }

  function setQuality(tier: 0 | 1 | 2) {
    quality = tier;
    gtao.enabled = tier === 0;
    resize();
  }

  function setTheme(theme: Theme) {
    const background = STUDIO_BACKGROUNDS[theme];
    scene.background = new THREE.Color(background);
    scene.fog?.color.setHex(background);
    scene.traverse((object) => {
      const materials = object instanceof THREE.Mesh
        ? Array.isArray(object.material) ? object.material : [object.material]
        : [];
      for (const material of materials) {
        const plate = (material as THREE.ShaderMaterial).uniforms?.uPlate?.value;
        if (plate instanceof THREE.Color) plate.setHex(background);
      }
    });
  }

  const ro = new ResizeObserver(resize);
  ro.observe(mount);
  setQuality(quality);

  // ── adaptive quality: step down when frames are consistently slow ─────────────
  let emaMs = 16.7;
  let slowFor = 0;
  let fastFor = 0;
  const startTier = quality;
  function adapt(dt: number) {
    emaMs = emaMs * 0.92 + dt * 1000 * 0.08;
    if (emaMs > 22) {
      slowFor += dt;
      fastFor = 0;
    } else if (emaMs < 12) {
      fastFor += dt;
      slowFor = 0;
    } else {
      slowFor = fastFor = 0;
    }
    if (slowFor > 1.5 && quality < 2) {
      setQuality((quality + 1) as 1 | 2);
      slowFor = 0;
      emaMs = 16.7;
    } else if (fastFor > 6 && quality > startTier) {
      setQuality((quality - 1) as 0 | 1);
      fastFor = 0;
    }
  }

  // ── frame loop ─────────────────────────────────────────────────────────────────
  const callbacks = new Set<FrameCallback>();
  const timer = new THREE.Timer();
  timer.connect(document);
  let warmup = 0;

  function frame() {
    perf.begin();
    // One clock (performance.now) for every delta: rAF timestamps can lag the Timer's own start
    // time, and a negative first delta would run every animation backwards.
    timer.update();
    const dt = THREE.MathUtils.clamp(timer.getDelta(), 0, MAX_DT);
    const elapsed = timer.getElapsed();
    controls.update(dt);
    for (const cb of callbacks) cb(dt, elapsed);
    if (quality === 2) renderer.render(scene, camera);
    else composer.render(dt);
    labels.render(scene, camera);
    perf.end();
    warmup += dt;
    if (warmup > 2 && !opts.quality) adapt(dt);
  }

  return {
    scene,
    camera,
    renderer,
    controls,
    labels,
    keyLight,
    perf,
    get quality() {
      return quality;
    },
    setQuality,
    setTheme,
    onFrame(cb) {
      callbacks.add(cb);
      return () => callbacks.delete(cb);
    },
    async goTo(shot, animate = !prefersReducedMotion()) {
      const s = typeof shot === 'string' ? SHOTS[shot] : shot;
      await controls.setLookAt(...s.position, ...s.target, animate);
    },
    setInsets(next) {
      Object.assign(insets, next);
      perf.setInsets(insets);
      resize();
    },
    start() {
      renderer.setAnimationLoop(frame);
    },
    dispose() {
      renderer.setAnimationLoop(null);
      perf.dispose();
      ro.disconnect();
      timer.dispose();
      controls.dispose();
      composer.dispose();
      rt.dispose();
      renderer.dispose();
    },
  };
}
