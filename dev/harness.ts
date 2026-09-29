/**
 * Dev harness: a bare stage for previewing one module in isolation.
 * Query params: ?view=hero|side|front|rear|top|low|ceiling  &quality=0|1|2  (+ any your page reads)
 * Sets window.__ready = true after a few frames so scripts/shot.mjs knows when to capture.
 */
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/ibm-plex-sans-condensed/400.css';
import '@fontsource/ibm-plex-sans-condensed/500.css';
import '@fontsource/ibm-plex-sans-condensed/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '../src/styles/tokens.css';
import * as THREE from 'three';
import { createStage, SHOTS, type ShotName, type Stage } from '../src/scene/stage';

declare global {
  interface Window {
    __ready?: boolean;
    __stage?: Stage;
  }
}

export const params = new URLSearchParams(location.search);
export const num = (key: string, fallback: number) => {
  const v = params.get(key);
  return v === null || v === '' || Number.isNaN(Number(v)) ? fallback : Number(v);
};

export function createHarness(opts: { plainFloor?: boolean } = {}): Stage {
  let mount = document.getElementById('stage');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'stage';
    document.body.appendChild(mount);
    Object.assign(mount.style, { position: 'fixed', inset: '0' });
  }
  const view = (params.get('view') ?? 'hero') as ShotName;
  const q = params.get('quality');
  const stage = createStage({
    mount,
    shot: view in SHOTS ? view : 'hero',
    quality: q === null ? 0 : (Number(q) as 0 | 1 | 2),
    preserveDrawingBuffer: true,
  });
  if (opts.plainFloor) {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xe2dfd8, roughness: 0.95 }),
    );
    floor.receiveShadow = true;
    stage.scene.add(floor);
  }
  let frames = 0;
  stage.onFrame(() => {
    if (++frames === 8) window.__ready = true;
  });
  window.__stage = stage;
  stage.start();
  return stage;
}
