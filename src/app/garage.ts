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
import type { CarModel, PartId } from '../scene/car/types';
import { createAirflow } from '../scene/effects/airflow';
import { createAxleLoads } from '../scene/effects/axleLoads';
import { createEnergyFlow } from '../scene/effects/energyFlow';
import { createForceArrows } from '../scene/effects/forces';
import { createWindTunnel } from '../scene/effects/tunnel';
import type { Airflow, AxleLoadValues, EnergyFlow, EnergyFlows, ForceArrows, ForceId, WindTunnel } from '../scene/effects/types';
import { visualSpeed } from '../scene/motion';
import { prefersReducedMotion, type Stage } from '../scene/stage';
import { fmtKN } from '../ui/format';
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

/** 1 m of axle-load arrow = 8 kN: a front axle carrying about 9 kN is a little over a metre tall. */
const AXLE_METRES_PER_NEWTON = 1 / 8000;
/** Easing rates (1/s) for Station 4: the pitch is quick, the discs cool slowly. */
const PITCH_EASE = 7;
const DISC_EASE = 3;
const SEE_THROUGH_EASE = 3.2;
const AXLE_LOAD_EASE = 4;

/** Station 4 shows the brake dive this many times larger than it is, so millimetres are visible. */
export const BRAKE_DIVE_EXAGGERATION = 6;

/** What Station 4 asks the garage to show each frame while braking is the story. */
export interface BrakingScene {
  /** Real dip of the body at the front axle and rise at the rear axle, m (the garage exaggerates them). */
  noseDropM: number;
  tailRiseM: number;
  /** Disc temperatures, °C: they set how hot the discs glow. */
  frontDiscC: number;
  rearDiscC: number;
  /** Axle loads now and without the braking transfer (weight + downforce), N: the load arrows. */
  frontLoadN: number;
  rearLoadN: number;
  frontStaticN: number;
  rearStaticN: number;
  /** Wheels ghosted so the discs show through (the "See-through wheels" toggle). */
  seeThrough: boolean;
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
/** `damp` that lands exactly on the target once it is within `eps`, so a finished ease is truly still. */
const settle = (current: number, target: number, rate: number, dt: number, eps: number) => {
  const v = THREE.MathUtils.damp(current, target, rate, dt);
  return Math.abs(v - target) < eps ? target : v;
};

const AERO_ARROWS: readonly ForceId[] = ['frontWing', 'floor', 'rearWing', 'drag'];

export interface Garage {
  car: CarModel;
  tunnel: WindTunnel;
  airflow: Airflow;
  forces: ForceArrows;
  energy: EnergyFlow;
  /** Commanded state: the car is (being) exploded. The airflow is hidden while it is. */
  readonly exploded: boolean;
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
  /** Station 4: brake dive, glowing discs, see-through wheels, axle-load arrows. Call every frame; null switches it all off (eased). */
  setBraking(scene: BrakingScene | null): void;
  setHighlight(ids: readonly PartId[] | null): void;
  /** Add a following car and its illustrative wake; null hides both. */
  setTow(gapM: number | null, wakeStrength?: number): void;
  /** Once per frame, after the station has worked out the aero state for this speed. */
  update(dt: number, kmh: number, aero: AeroState): void;
  dispose(): void;
}

export function createGarage(stage: Stage, car: CarModel): Garage {
  const reducedMotion = prefersReducedMotion();
  const tunnel = createWindTunnel();
  const airflow = createAirflow({ car });
  const towAirflow = createAirflow({ car });
  towAirflow.root.name = 'tow-airflow';
  towAirflow.root.visible = false;
  const forces = createForceArrows({ car, metresPerNewton: METRES_PER_NEWTON, formatForce: fmtKN });
  // Routes are traced from the assembled car, so this must come before any explode.
  const energy = createEnergyFlow({ car });
  const axleLoads = createAxleLoads({ car, metresPerNewton: AXLE_METRES_PER_NEWTON, formatForce: fmtKN });

  const rig = new THREE.Group();
  rig.name = 'car-rig';
  const towCar = car.root.clone(true);
  towCar.name = 'tow-car';
  towCar.visible = false;
  const towWake = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 1.25, 2, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x39a9aa, transparent: true, opacity: 0.17, depthWrite: false, side: THREE.DoubleSide }),
  );
  towWake.name = 'slipstream-wake';
  towWake.rotation.z = -Math.PI / 2;
  towWake.scale.set(0.55, 0, 1.7);
  towWake.visible = false;
  rig.add(tunnel.road, car.root, airflow.root, energy.root, axleLoads.root, towWake, towCar, towAirflow.root);
  stage.scene.add(tunnel.studio, rig, forces.root);

  // Compile the ghost shader, the brake hardware and the axle-load arrows now rather than on the
  // first frame that shows them (hidden objects are not compiled). Programs are keyed on the
  // target, and the stage draws to a linear float target normally and to the screen at its lowest
  // quality tier, so compile both.
  const warmTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  car.setXray(1);
  car.setWheelGhost(1);
  axleLoads.setOpacity(1);
  stage.renderer.setRenderTarget(warmTarget);
  stage.renderer.compile(stage.scene, stage.camera);
  stage.renderer.setRenderTarget(null);
  stage.renderer.compile(stage.scene, stage.camera);
  warmTarget.dispose();
  car.setXray(0);
  car.setWheelGhost(0);
  axleLoads.setOpacity(0);

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
    braking: null as BrakingScene | null,
  };
  const s = {
    explodeT: 0,
    flipT: 0,
    straightT: 0,
    fallGap: 0,
    flowAlpha: 0,
    wheelAngle: 0,
    xrayT: 0,
    energyAlpha: 0,
    // Station 4, all shown values (the dive already exaggerated, metres; discs in °C).
    noseDrop: 0,
    tailRise: 0,
    frontDiscC: 0,
    rearDiscC: 0,
    seeThroughT: 0,
    axleAlpha: 0,
  };
  const applied = { noseDrop: 0, tailRise: 0, frontDiscC: 0, rearDiscC: 0, seeThroughT: 0 };
  // Reused every frame, so the per-frame path allocates nothing.
  const axleValues: AxleLoadValues = { frontN: 0, rearN: 0, frontStaticN: 0, rearStaticN: 0 };
  let appliedXray = 0;
  let roadShadow = true;

  /** Station 4: everything eases toward the commanded scene, or toward neutral when there is none. */
  function updateBraking(dt: number, rate: number) {
    const b = target.braking;
    s.noseDrop = settle(s.noseDrop, b ? b.noseDropM * BRAKE_DIVE_EXAGGERATION : 0, PITCH_EASE * rate, dt, 2e-5);
    s.tailRise = settle(s.tailRise, b ? b.tailRiseM * BRAKE_DIVE_EXAGGERATION : 0, PITCH_EASE * rate, dt, 2e-5);
    if (s.noseDrop !== applied.noseDrop || s.tailRise !== applied.tailRise) {
      car.setPitch(s.noseDrop, s.tailRise);
      applied.noseDrop = s.noseDrop;
      applied.tailRise = s.tailRise;
    }

    s.frontDiscC = settle(s.frontDiscC, b ? b.frontDiscC : 0, DISC_EASE * rate, dt, 0.5);
    s.rearDiscC = settle(s.rearDiscC, b ? b.rearDiscC : 0, DISC_EASE * rate, dt, 0.5);
    if (s.frontDiscC !== applied.frontDiscC || s.rearDiscC !== applied.rearDiscC) {
      car.setBrakeTemps(s.frontDiscC, s.rearDiscC);
      applied.frontDiscC = s.frontDiscC;
      applied.rearDiscC = s.rearDiscC;
    }

    s.seeThroughT = settle(s.seeThroughT, b?.seeThrough ? 1 : 0, SEE_THROUGH_EASE * rate, dt, 1e-3);
    if (s.seeThroughT !== applied.seeThroughT) {
      car.setWheelGhost(s.seeThroughT);
      applied.seeThroughT = s.seeThroughT;
    }

    // Arrows keep their last loads while they fade out, so they do not shrink on the way.
    if (b) {
      axleValues.frontN = b.frontLoadN;
      axleValues.rearN = b.rearLoadN;
      axleValues.frontStaticN = b.frontStaticN;
      axleValues.rearStaticN = b.rearStaticN;
      axleLoads.setLoads(axleValues);
    }
    s.axleAlpha = settle(s.axleAlpha, b ? 1 : 0, AXLE_LOAD_EASE * rate, dt, 1e-3);
    axleLoads.setOpacity(s.axleAlpha);
    axleLoads.update(dt);
  }

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
    updateBraking(dt, rate);
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
    if (towCar.visible) {
      towAirflow.setSpeed(kmh);
      towAirflow.setActiveAero(s.straightT);
      towAirflow.update(dt);
    }

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
    get exploded() {
      return target.exploded;
    },
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
    setBraking: (scene) => void (target.braking = scene),
    setHighlight: (ids) => car.setHighlight(ids),
    setTow(gapM, wakeStrength = 0) {
      if (gapM === null) {
        towCar.visible = false;
        towWake.visible = false;
        towAirflow.root.visible = false;
        return;
      }
      const gap = Math.max(2, gapM);
      towCar.position.set(-5.3 - gap, 0, 0);
      towCar.visible = true;
      towAirflow.root.position.x = towCar.position.x;
      towAirflow.root.visible = true;
      towAirflow.setSlipstream(wakeStrength);
      towWake.position.set(-2.55 - gap / 2, 1.1, 0);
      towWake.scale.y = gap / 2;
      towWake.visible = true;
    },
    update,
    dispose() {
      axleLoads.dispose();
      energy.dispose();
      forces.dispose();
      towAirflow.dispose();
      airflow.dispose();
      tunnel.dispose();
      towWake.geometry.dispose();
      (towWake.material as THREE.Material).dispose();
      car.dispose();
      stage.scene.remove(tunnel.studio, rig, forces.root);
    },
  };
}
