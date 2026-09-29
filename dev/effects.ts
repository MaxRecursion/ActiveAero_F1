/**
 * Dev page: force arrows + wind tunnel on the mock car.
 * Params: ?speed=kmh (300) &explode=0..1 (0) &ceiling=1 &weight=0|1 (1) &view=… (see harness)
 */
import * as THREE from 'three';
import { createHarness, num, params } from './harness';
import { createMockCar } from './mockCar';
import { createForceArrows } from '../src/scene/effects/forces';
import { createWindTunnel } from '../src/scene/effects/tunnel';
import { aeroState } from '../src/physics/aero';
import { visualSpeed } from '../src/scene/motion';
import { fmtKN } from '../src/ui/format';

const stage = createHarness();
const speed = num('speed', 300);

const tunnel = createWindTunnel();
stage.scene.add(tunnel.studio);

// Everything in the car frame hangs off one rig, so the ceiling test flips it all together.
const rig = new THREE.Group();
const car = createMockCar();
rig.add(car.root, tunnel.road);
if (params.get('ceiling') === '1') {
  rig.rotation.x = Math.PI;
  rig.position.y = 2.2;
}
stage.scene.add(rig);
car.setExplode(THREE.MathUtils.clamp(num('explode', 0), 0, 1));

const arrows = createForceArrows({ car, metresPerNewton: 1 / 7500, formatForce: fmtKN });
stage.scene.add(arrows.root);
const state = aeroState(speed);
const surface = (id: string) => state.surfaces.find((s) => s.id === id)?.downforceN ?? 0;
arrows.setForces({
  frontWing: surface('frontWing'),
  floor: surface('floor'),
  rearWing: surface('rearWing'),
  drag: state.dragN,
  weight: state.weightN,
});
arrows.setVisible('weight', num('weight', 1) === 1);
arrows.update(1); // one long step settles the easing, so shots show final lengths
tunnel.setSpeed(speed);

let wheelAngle = 0;
stage.onFrame((dt) => {
  wheelAngle += (visualSpeed(speed) / 0.353) * dt;
  car.setWheelSpin(wheelAngle);
  tunnel.update(dt);
  arrows.update(dt);
});
