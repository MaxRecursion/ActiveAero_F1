/**
 * Halo and driver. The halo is a titanium hoop over the cockpit that deflects debris (and once a
 * whole car); its single front pillar sits on the tub centre line ahead of the driver.
 */
import * as THREE from 'three';
import { roundedBox } from '../geometry/primitives';
import type { PartMaterials } from '../materials';
import { PieceSet } from '../pieces';

/** Helmet centre: the driver sits low, so only the helmet shows above the cockpit rim. */
const HELMET = new THREE.Vector3(0.1, 0.735, 0);

export function buildHalo(mats: PartMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'halo';
  const R = 0.024;
  // Hoop: from the right rear mount, round the front of the helmet, back to the left mount.
  const side = [
    new THREE.Vector3(-0.19, 0.6, 0.205),
    new THREE.Vector3(-0.18, 0.8, 0.21),
    new THREE.Vector3(-0.08, 0.9, 0.205),
    new THREE.Vector3(0.18, 0.895, 0.185),
    new THREE.Vector3(0.39, 0.87, 0.115),
  ];
  const mirror = (p: THREE.Vector3) => new THREE.Vector3(p.x, p.y, -p.z);
  // The hoop dips slightly toward the front, where the single pillar drops to the tub.
  const hoop = new THREE.CatmullRomCurve3(
    [...side, new THREE.Vector3(0.465, 0.86, 0), ...[...side].reverse().map(mirror)],
    false,
    'centripetal',
  );
  const pillar = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.45, 0.862, 0),
    new THREE.Vector3(0.52, 0.82, 0),
    new THREE.Vector3(0.59, 0.72, 0),
    new THREE.Vector3(0.63, 0.6, 0),
  ]);
  new PieceSet()
    .add('metal', new THREE.TubeGeometry(hoop, 96, R, 14, false), 60)
    .add('metal', new THREE.TubeGeometry(pillar, 24, R * 1.15, 14, false), 60)
    .build(group, mats);
  return group;
}

export function buildDriver(mats: PartMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'driver';
  const pieces = new PieceSet();

  const shell = new THREE.SphereGeometry(1, 40, 28);
  shell.scale(0.145, 0.135, 0.122);
  shell.translate(HELMET.x, HELMET.y, HELMET.z);
  pieces.add('helmet', shell, false);

  // Visor: a band of a slightly larger sphere across the front of the helmet.
  // SphereGeometry's φ = π faces +x, so the band is centred there.
  const visor = new THREE.SphereGeometry(
    1,
    36,
    10,
    Math.PI * 0.68,
    Math.PI * 0.64,
    Math.PI * 0.4,
    Math.PI * 0.16,
  );
  visor.scale(0.1475, 0.137, 0.124);
  visor.translate(HELMET.x, HELMET.y, HELMET.z);
  pieces.add('visor', visor, false);

  // Shoulders and HANS collar, mostly hidden below the cockpit rim.
  pieces.add('clayDark', roundedBox([0.3, 0.14, 0.38], [0.0, 0.55, 0], 0.06, 3), false);
  pieces.add('clayDark', roundedBox([0.18, 0.08, 0.22], [0.02, 0.63, 0], 0.035, 3), false);

  pieces.build(group, mats);
  return group;
}
