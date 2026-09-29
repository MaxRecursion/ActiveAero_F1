/**
 * Dev page: illustrative airflow streamlines around the procedural car.
 * Params: ?speed=kmh (250) &opacity=0..1 (1) &ceiling=1 (flip the rig onto the ceiling)
 *         &aero=0..1 (0 = Corner Mode … 1 = Straight Mode; flaps and flow together)
 *         &hide=airflow-lines|airflow-xray (inspect one of the two passes alone)
 *         &cam=px,py,pz,tx,ty,tz (a custom camera for close-ups) &view=… (see harness)
 */
import * as THREE from 'three';
import { createHarness, num, params } from './harness';
import { buildCar } from '../src/scene/car/buildCar';
import { createAirflow } from '../src/scene/effects/airflow';
import { visualSpeed } from '../src/scene/motion';

const stage = createHarness({ plainFloor: true });
const speed = num('speed', 250);

const cam = params.get('cam')?.split(',').map(Number);
if (cam?.length === 6) void stage.controls.setLookAt(cam[0], cam[1], cam[2], cam[3], cam[4], cam[5], false);

const car = buildCar();
const t0 = performance.now();
const airflow = createAirflow({ car });
console.info(`[airflow] built in ${(performance.now() - t0).toFixed(1)} ms`);

// Car and airflow share one rig, as in the station, so the ceiling flip carries both.
const rig = new THREE.Group();
rig.add(car.root, airflow.root);
if (params.get('ceiling') === '1') {
  rig.rotation.x = Math.PI;
  rig.position.y = 2.2;
}
stage.scene.add(rig);

const hidden = airflow.root.getObjectByName(params.get('hide') ?? '');
if (hidden) hidden.visible = false;

airflow.setSpeed(speed);
airflow.setOpacity(num('opacity', 1));
const aero = num('aero', 0);
car.setActiveAero(aero);
airflow.setActiveAero(aero);

let wheelAngle = 0;
stage.onFrame((dt) => {
  wheelAngle += (visualSpeed(speed) / 0.355) * dt;
  car.setWheelSpin(wheelAngle);
  airflow.update(dt);
});
