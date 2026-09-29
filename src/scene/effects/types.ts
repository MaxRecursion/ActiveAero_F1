/**
 * CONTRACT — scene effects for Station 1. Implemented in this folder:
 *   forces.ts   → createForceArrows
 *   airflow.ts  → createAirflow
 *   tunnel.ts   → createWindTunnel
 *
 * All three are fed plain numbers each frame by the station; they never import physics.
 */
import type * as THREE from 'three';
import type { CarModel } from '../car/types';

// ── Force arrows ─────────────────────────────────────────────────────────────────

export type ForceId = 'frontWing' | 'floor' | 'rearWing' | 'drag' | 'weight';

export interface ForceValues {
  /** Newtons. */
  frontWing: number;
  floor: number;
  rearWing: number;
  drag: number;
  weight: number;
}

export interface ForceArrowsOptions {
  car: CarModel;
  /** Metres of arrow per newton. One scale for every arrow so lengths compare honestly. */
  metresPerNewton: number;
}

export interface ForceArrows {
  /** Add to the scene (world space). Arrows follow car anchors in world space each update. */
  root: THREE.Group;
  /**
   * Set target magnitudes. Arrow lengths ease toward the targets (frame-rate independent).
   * Downforce arrows point along the car's local -Y (so they flip with the car), head touching the anchor.
   * Drag points along the car's local -X from `dragOrigin`. Weight points along world -Y from `cg`.
   */
  setForces(values: ForceValues): void;
  /** Per-arrow visibility (e.g. hide weight until the ceiling test). */
  setVisible(id: ForceId, visible: boolean): void;
  /** Call every frame after the car has moved. */
  update(dt: number): void;
  dispose(): void;
}

// ── Airflow ──────────────────────────────────────────────────────────────────────

export interface AirflowOptions {
  car: CarModel;
}

export interface Airflow {
  /** Car-frame group; parent it to the same rig as the car so it flips with the car. */
  root: THREE.Group;
  /** Free-stream speed in km/h. 0 = still air (streaks fade out). */
  setSpeed(kmh: number): void;
  /** 0–1 overall opacity (fade out while exploded). */
  setOpacity(alpha: number): void;
  /**
   * Active aero, Station 2: 0 = Corner Mode … 1 = Straight Mode. With the flaps open the wings
   * turn the air less: weaker upwash behind the front and rear wings and a lower, flatter wake.
   */
  setActiveAero(t: number): void;
  update(dt: number): void;
  dispose(): void;
}

// ── Wind tunnel / studio ─────────────────────────────────────────────────────────

export interface WindTunnel {
  /** Static studio: floor + cyclorama backdrop. World space; never flips. */
  studio: THREE.Group;
  /** Rolling road (moving belt) + scale ruler. Car frame; parent it to the car rig so it flips with the car. */
  road: THREE.Group;
  /** Belt surface speed in km/h (the belt runs backward under the car, like a real rolling road). */
  setSpeed(kmh: number): void;
  update(dt: number): void;
  dispose(): void;
}

// ── Energy flow (Station 3) ─────────────────────────────────────────────────────

export interface EnergyFlows {
  /** Engine power going to the rear wheels, kW (0 while braking). */
  engineKw: number;
  /** Motor-generator: + battery → motor → wheels (deploy); − into the battery (harvest), kW. */
  mguKKw: number;
  /** Where harvested energy comes from while mguKKw < 0: the rear wheels (braking) or the engine (super clipping). */
  harvestSource: 'brakes' | 'engine';
  /** Battery state of charge as a fraction of its 4 MJ window (0–1), for the battery's glow/fill. */
  charge: number;
}

export interface EnergyFlowOptions {
  car: CarModel;
}

export interface EnergyFlow {
  /** Car frame; parent it to the car rig. */
  root: THREE.Group;
  setFlows(flows: EnergyFlows): void;
  /** 0–1 overall visibility (fades in with the X-ray). */
  setOpacity(alpha: number): void;
  update(dt: number): void;
  dispose(): void;
}
