/**
 * Dev page: the energy flow inside the X-rayed car, on the rolling road.
 * Params: ?mode=deploy|brake|clip|engine|idle (deploy) &kw=0..350 MGU-K (350) &engine=0..400 kW
 *         (per mode: deploy 400, clip 250, engine 400, else 0) &charge=0..1 (0.6) &xray=0..1 (1)
 *         &opacity=0..1 (1) &speed=kmh (250) &cycle=1 (step through the modes every 3 s, to watch
 *         the easing) &hide=powerUnit,… &cam=px,py,pz,tx,ty,tz &view=… (see harness)
 */
import * as THREE from 'three';
import { createHarness, num, params } from './harness';
import { buildCar } from '../src/scene/car/buildCar';
import { createEnergyFlow } from '../src/scene/effects/energyFlow';
import { createWindTunnel } from '../src/scene/effects/tunnel';
import { visualSpeed } from '../src/scene/motion';
import type { EnergyFlows } from '../src/scene/effects/types';
import type { PartId } from '../src/scene/car/types';

type Mode = 'deploy' | 'brake' | 'clip' | 'engine' | 'idle';
const MODES: readonly Mode[] = ['deploy', 'clip', 'brake', 'engine', 'idle'];

const stage = createHarness();
const cam = params.get('cam')?.split(',').map(Number);
if (cam?.length === 6) void stage.controls.setLookAt(cam[0], cam[1], cam[2], cam[3], cam[4], cam[5], false);

const tunnel = createWindTunnel();
stage.scene.add(tunnel.studio);
const rig = new THREE.Group();
const car = buildCar();
rig.add(car.root, tunnel.road);
stage.scene.add(rig);
car.setXray(num('xray', 1));
for (const id of (params.get('hide')?.split(',') ?? []) as PartId[]) {
  const part = car.parts.get(id);
  if (part) part.object.visible = false;
}

const energy = createEnergyFlow({ car });
rig.add(energy.root);
energy.setOpacity(num('opacity', 1));

const kw = num('kw', 350);
const charge = num('charge', 0.6);
function flows(mode: Mode): EnergyFlows {
  const engineKw = num('engine', { deploy: 400, clip: 250, engine: 400, brake: 0, idle: 0 }[mode]);
  const mguKKw = { deploy: kw, brake: -kw, clip: -kw, engine: 0, idle: 0 }[mode];
  return { engineKw, mguKKw, harvestSource: mode === 'clip' ? 'engine' : 'brakes', charge };
}
const start = (params.get('mode') ?? 'deploy') as Mode;
energy.setFlows(flows(MODES.includes(start) ? start : 'deploy'));
energy.update(10); // settle the easing, so shots show the steady state

const speed = num('speed', 250);
tunnel.setSpeed(speed);
const cycle = params.get('cycle') === '1';
let wheelAngle = 0;
stage.onFrame((dt, elapsed) => {
  if (cycle) energy.setFlows(flows(MODES[Math.floor(elapsed / 3) % MODES.length]));
  wheelAngle += (visualSpeed(speed) / 0.355) * dt;
  car.setWheelSpin(wheelAngle);
  tunnel.update(dt);
  energy.update(dt);
});
