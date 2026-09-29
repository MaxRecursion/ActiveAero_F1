/**
 * The garage: everything physical that every station shares — the car, the wind tunnel, the
 * airflow and the force arrows — plus the slow transitions between their states (explode,
 * ceiling flip, wing flaps, airflow fade). Stations set targets; the garage animates toward them
 * and, once per frame, turns a speed and an aero state into motion and arrows.
 *
 * The car, its rolling road and its airflow share one rig (car frame). The ceiling test rotates
 * the rig half a turn about X around a pivot 1.1 m up, lifted mid-turn, so the car ends up
 * hanging from a ceiling belt at y = 2.2 without the deck ever passing through the studio floor.
 */
import * as THREE from 'three';
import type { AeroState } from '../physics/aero';
import { CAR_FRAME, REGS, SPEED_RANGE_KMH } from '../physics/constants';
import { aeroState } from '../physics/aero';
import { buildCar } from '../scene/car/buildCar';
import type { CarModel, PartId } from '../scene/car/types';
import { createAirflow } from '../scene/effects/airflow';
import { createEnergyFlow } from '../scene/effects/energyFlow';
import { createForceArrows } from '../scene/effects/forces';
import { createWindTunnel } from '../scene/effects/tunnel';
import type { Airflow, EnergyFlow, EnergyFlows, ForceArrows, ForceId, WindTunnel } from '../scene/effects/types';
import { visualSpeed } from '../scene/motion';
import { prefersReducedMotion, type Stage } from '../scene/stage';
import type { AeroMode } from '../ui/types';

/** 1 m of arrow = 7.5 kN, so the weight arrow is about a metre long. */
const METRES_PER_NEWTON = 1 / 7500;
const FLIP_PIVOT_Y = 1.1;
/** Extra lift at mid-flip so the road deck's corners clear the studio floor while turning. */
const FLIP_LIFT_M = 1.4;
const REAR_TYRE_RADIUS = 0.355;
/** Real cars squat ~1–2 cm under full downforce; shown to scale. */
const MAX_RIDE_DROP_M = 0.015;
/** How far the car pulls away from the ceiling when downforce loses to weight. */
const FALL_GAP_M = 0.45;
/** Flaps travel at the regulation's slowest allowed rate: full travel in 400 ms. */
const FLAP_TRAVEL_PER_S = 1000 / REGS.activeAeroSwitchMs.value;

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

const AERO_ARROWS: readonly ForceId[] = ['frontWing', 'floor', 'rearWing', 'drag'];

export interface Garage {
  car: CarModel;
  tunnel: WindTunnel;
  airflow: Airflow;
  forces: ForceArrows;
  energy: EnergyFlow;
  /** Current eased-in progress of the transitions (0–1). */
  readonly explodeT: number;
  readonly flipT: number;
  /** Actual flap position: 0 Corner … 1 Straight (moves at the regulated rate). */
  readonly straightT: number;
  setExploded(on: boolean): void;
  setCeiling(on: boolean): void;
  setAirflow(on: boolean): void;
  setAeroMode(mode: AeroMode): void;
  setWeightArrow(visible: boolean): void;
  /** Downforce and drag arrows (hidden where they would compete with another story). */
  setForceArrows(visible: boolean): void;
  /** Ghost the shell so the power unit, battery and gearbox show (eased). */
  setXray(on: boolean): void;
  /** Show the energy-flow particles (they fade in with the X-ray). */
  setEnergyFlow(on: boolean): void;
  setEnergy(flows: EnergyFlows): void;
  setHighlight(ids: readonly PartId[] | null): void;
  /** Once per frame, after the station has worked out the aero state for this speed. */
  update(dt: number, kmh: number, aero: AeroState): void;
  dispose(): void;
}

export function createGarage(stage: Stage): Garage {
  const reducedMotion = prefersReducedMotion();
  const car = buildCar();
  const tunnel = createWindTunnel();
  const airflow = createAirflow({ car });
  const forces = createForceArrows({ car, metresPerNewton: METRES_PER_NEWTON });
  // Routes are traced from the assembled car, so this must come before any explode.
  const energy = createEnergyFlow({ car });

  const rig = new THREE.Group();
  rig.name = 'car-rig';
  rig.add(tunnel.road, car.root, airflow.root, energy.root);
  stage.scene.add(tunnel.studio, rig, forces.root);

  // Compile the X-ray ghost shader now rather than on the first X-ray frame.
  car.setXray(1);
  stage.renderer.compile(stage.scene, stage.camera);
  car.setXray(0);

  const maxDownforceN = aeroState(SPEED_RANGE_KMH.max).downforceN;
  const target = {
    exploded: false,
    ceiling: false,
    airflow: true,
    straight: false,
    weight: false,
    arrows: true,
    xray: false,
    energy: false,
  };
  const s = { explodeT: 0, flipT: 0, straightT: 0, fallGap: 0, flowAlpha: 0, wheelAngle: 0, xrayT: 0, energyAlpha: 0 };
  let appliedXray = 0;
  let roadShadow = true;

  function update(dt: number, kmh: number, aero: AeroState) {
    const rate = reducedMotion ? 60 : 1;
    s.explodeT = THREE.MathUtils.damp(s.explodeT, target.exploded ? 1 : 0, 3.2 * rate, dt);
    s.flipT = THREE.MathUtils.damp(s.flipT, target.ceiling ? 1 : 0, 2.6 * rate, dt);
    // Flaps move linearly at the regulated rate, like an actuator, not with an ease.
    const flapStep = FLAP_TRAVEL_PER_S * dt;
    s.straightT = target.straight ? Math.min(1, s.straightT + flapStep) : Math.max(0, s.straightT - flapStep);

    s.xrayT = THREE.MathUtils.damp(s.xrayT, target.xray ? 1 : 0, 3.2 * rate, dt);
    if (Math.abs(s.xrayT - appliedXray) > 1e-4) {
      appliedXray = s.xrayT < 1e-3 ? 0 : s.xrayT;
      car.setXray(appliedXray);
    }
    car.setExplode(easeInOut(clamp01(s.explodeT)));
    car.setActiveAero(s.straightT);
    airflow.setActiveAero(s.straightT);

    const theta = Math.PI * easeInOut(clamp01(s.flipT));
    rig.rotation.x = theta;
    rig.position.set(
      0,
      FLIP_PIVOT_Y - FLIP_PIVOT_Y * Math.cos(theta) + FLIP_LIFT_M * Math.sin(theta),
      -FLIP_PIVOT_Y * Math.sin(theta),
    );
    // Hanging 2 m up, the deck's shadow would be a dark slab on the floor; let the car's own shadow carry it.
    const wantRoadShadow = s.flipT < 0.5;
    if (wantRoadShadow !== roadShadow) {
      roadShadow = wantRoadShadow;
      tunnel.road.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = roadShadow;
      });
    }

    // Upside down and too slow: the car peels away from the ceiling belt (car-local +Y is world-down).
    const upsideDown = target.ceiling && s.flipT > 0.9;
    const falling = upsideDown && aero.downforceToWeight < 1;
    const wantGap = falling ? FALL_GAP_M * clamp01(1 - aero.downforceToWeight) + 0.08 : 0;
    s.fallGap = THREE.MathUtils.damp(s.fallGap, wantGap, 5, dt);
    // Tilt about the rear contact patch so the nose drops first and the tail never enters the belt.
    const tilt = s.fallGap * 0.25;
    const rearX = CAR_FRAME.rearAxleX;
    car.root.rotation.z = tilt;
    car.root.position.set(rearX - rearX * Math.cos(tilt), s.fallGap - rearX * Math.sin(tilt), 0);

    // Motion that follows the air.
    s.wheelAngle += (visualSpeed(kmh) / REAR_TYRE_RADIUS) * dt;
    car.setWheelSpin(s.wheelAngle);
    car.setRideHeightDrop(MAX_RIDE_DROP_M * Math.min(1, aero.downforceN / maxDownforceN));
    tunnel.setSpeed(kmh);
    tunnel.update(dt);

    const flowTarget = target.airflow ? 1 - clamp01(s.explodeT / 0.35) : 0;
    s.flowAlpha = THREE.MathUtils.damp(s.flowAlpha, flowTarget, 6, dt);
    airflow.setSpeed(kmh);
    airflow.setOpacity(s.flowAlpha);
    airflow.update(dt);

    const byId = Object.fromEntries(aero.surfaces.map((x) => [x.id, x.downforceN]));
    forces.setForces({
      frontWing: byId.frontWing ?? 0,
      floor: byId.floor ?? 0,
      rearWing: byId.rearWing ?? 0,
      drag: aero.dragN,
      weight: aero.weightN,
    });
    for (const id of AERO_ARROWS) forces.setVisible(id, target.arrows);
    forces.setVisible('weight', target.weight && s.flipT > 0.6);
    forces.update(dt);

    // Energy particles need the see-through shell, and their routes follow the assembled car.
    const energyTarget = target.energy ? s.xrayT * (1 - clamp01(s.explodeT / 0.2)) : 0;
    s.energyAlpha = THREE.MathUtils.damp(s.energyAlpha, energyTarget, 6, dt);
    energy.setOpacity(s.energyAlpha);
    energy.update(dt);
  }

  return {
    car,
    tunnel,
    airflow,
    forces,
    energy,
    get explodeT() {
      return s.explodeT;
    },
    get flipT() {
      return s.flipT;
    },
    get straightT() {
      return s.straightT;
    },
    setExploded: (on) => void (target.exploded = on),
    setCeiling: (on) => void (target.ceiling = on),
    setAirflow: (on) => void (target.airflow = on),
    setAeroMode: (mode) => void (target.straight = mode === 'straight'),
    setWeightArrow: (visible) => void (target.weight = visible),
    setForceArrows: (visible) => void (target.arrows = visible),
    setXray: (on) => void (target.xray = on),
    setEnergyFlow: (on) => void (target.energy = on),
    setEnergy: (flows) => energy.setFlows(flows),
    setHighlight: (ids) => car.setHighlight(ids),
    update,
    dispose() {
      energy.dispose();
      forces.dispose();
      airflow.dispose();
      tunnel.dispose();
      car.dispose();
      stage.scene.remove(tunnel.studio, rig, forces.root);
    },
  };
}
