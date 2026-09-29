/**
 * Dev: the car model in our car frame (metres, +X forward, ground y = 0), clay-shaded, with a metre
 * grid, so region boundaries can be read off screenshots and the processed parts can be checked.
 *   ?src=source (raw download, transformed here) | car (public/models/car.glb) | debug (full-res split,
 *        written by `npm run model -- --debug`)
 *   ?parts=1 colour each part · ?only=frontWing,… · ?hide=nose,… · ?aero=0..1 open the flaps about
 *   their hinge extras · ?cam=px,py,pz,tx,ty,tz · ?view=… · ?grid=0 · ?file=<under /models/source/>
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createHarness, num, params } from './harness';

const stage = createHarness({ plainFloor: true });
stage.controls.minDistance = 0.2; // close-ups of wing elements
const cam = params.get('cam')?.split(',').map(Number);
if (cam?.length === 6) void stage.controls.setLookAt(cam[0], cam[1], cam[2], cam[3], cam[4], cam[5], false);

if (params.get('grid') !== '0') {
  const grid = new THREE.GridHelper(8, 16, 0x2356f6, 0x9aa3b5);
  grid.position.y = 0.002;
  stage.scene.add(grid);
  const axes = new THREE.AxesHelper(1);
  axes.position.y = 0.004;
  stage.scene.add(axes);
}

const src = params.get('src') ?? 'source';
const url =
  src === 'car'
    ? '/models/car.glb'
    : src === 'debug'
      ? '/scripts/model/.out/car-debug.glb'
      : `/models/source/${params.get('file') ?? 'f1_2026_concept_polygon_model.glb'}`;
const list = (key: string) => new Set(params.get(key)?.split(',').filter(Boolean) ?? []);
const only = list('only');
const hide = list('hide');
const colourParts = params.get('parts') === '1';

const clay = new THREE.MeshStandardMaterial({ color: 0xd8d4cb, roughness: 0.7, side: THREE.DoubleSide });
const PART_COLOURS = [
  0xe6194b, 0x3cb44b, 0xffe119, 0x4363d8, 0xf58231, 0x911eb4, 0x46f0f0, 0xf032e6, 0xbcf60c, 0xfabebe,
  0x008080, 0xe6beff, 0x9a6324, 0x800000, 0xaaffc3, 0x808000, 0x000075, 0x808080,
];

/** Rotate a part about its hinge extras (two car-frame points), by `t` × its opening angle. */
function openFlap(node: THREE.Object3D, t: number) {
  const hinge = node.userData.hinge as { a: number[]; b: number[]; openDeg: number } | undefined;
  if (!hinge || t === 0) return;
  const a = new THREE.Vector3().fromArray(hinge.a);
  const axis = new THREE.Vector3().fromArray(hinge.b).sub(a).normalize();
  const m = new THREE.Matrix4()
    .makeTranslation(a.x, a.y, a.z)
    .multiply(new THREE.Matrix4().makeRotationAxis(axis, THREE.MathUtils.degToRad(hinge.openDeg * t)))
    .multiply(new THREE.Matrix4().makeTranslation(-a.x, -a.y, -a.z));
  node.applyMatrix4(m);
}

function showLegend(entries: [string, number][]) {
  const box = document.createElement('div');
  Object.assign(box.style, { position: 'fixed', top: '12px', left: '12px', font: '13px monospace', lineHeight: '18px' });
  for (const [name, colour] of entries) {
    const row = document.createElement('div');
    row.innerHTML = `<span style="display:inline-block;width:12px;height:12px;margin-right:6px;background:#${colour.toString(16).padStart(6, '0')}"></span>${name}`;
    box.appendChild(row);
  }
  document.body.appendChild(box);
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.load(url, (gltf) => {
  const model = gltf.scene;
  const aero = num('aero', 0);
  const parts = model.children.slice();
  parts.forEach((part, i) => {
    part.visible = (only.size === 0 || only.has(part.name)) && !hide.has(part.name);
    openFlap(part, aero);
    const material = colourParts
      ? new THREE.MeshStandardMaterial({ color: PART_COLOURS[i % PART_COLOURS.length], roughness: 0.75, side: THREE.DoubleSide })
      : clay;
    part.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.material = material;
      o.castShadow = true;
      o.receiveShadow = true;
      if (!o.geometry.getAttribute('normal')) o.geometry.computeVertexNormals();
    });
  });
  if (colourParts) showLegend(parts.map((p, i) => [p.name, PART_COLOURS[i % PART_COLOURS.length]]));
  if (src === 'source') {
    // Model: millimetres, car points −X, axle midpoint x = 1645 mm, tyre bottoms at y = −31 mm.
    const frame = new THREE.Group();
    frame.rotation.y = Math.PI;
    frame.scale.setScalar(0.001);
    frame.position.set(1.645, 0.0308, 0);
    frame.add(model);
    stage.scene.add(frame);
  } else {
    stage.scene.add(model);
  }
});
