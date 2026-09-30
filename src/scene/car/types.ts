/**
 * CONTRACT — the procedural car. Implemented by src/scene/car/buildCar.ts.
 *
 * Car frame (metres): +X forward, +Y up, symmetric about z = 0, ground at y = 0.
 *   Front axle x = +1.70, rear axle x = -1.70 (wheelbase 3.40, FIA C2.3.3).
 *   Overall width 1.90 (outer tyre faces at |z| = 0.95, FIA C2.3.1).
 *   Front tyre Ø 0.705 × 0.280 wide; rear tyre Ø 0.710 × 0.375 wide (18-inch rims).
 *   Wheel centres sit at y = tyre radius. Plank (bottom of floor) sits at y ≈ 0.03.
 *   Nose tip ≈ x +2.75; rear wing trailing edge ≈ x -2.55; roll hoop top ≈ y 0.95.
 *   Aero centres of pressure (see ESTIMATES.surfaces): front wing x +2.40, floor x -0.15, rear wing x -2.30.
 *   Centre of gravity x = CAR_FRAME.cgX (-0.17), y = ESTIMATES.cgHeightM (0.28).
 */
import type * as THREE from 'three';

export type PartId =
  | 'survivalCell' // monocoque tub incl. cockpit opening
  | 'nose'
  | 'bodywork' // sidepods + engine cover + airbox
  | 'floor' // floor, Venturi tunnel inlets, diffuser, plank
  | 'frontWing' // mainplane, flaps, endplates (flaps are active in 2026)
  | 'rearWing' // mainplane, flap, endplates (flap is active in 2026)
  | 'halo'
  | 'driver' // helmet + shoulders visible in the cockpit
  | 'wheelFL'
  | 'wheelFR'
  | 'wheelRL'
  | 'wheelRR'
  | 'suspensionFront'
  | 'suspensionRear'
  | 'powerUnit' // V6 ICE + MGU-K (hidden inside bodywork until exploded)
  | 'battery' // energy store, under the fuel cell
  | 'gearbox';

export type PartGroup = 'aero' | 'chassis' | 'wheels' | 'powertrain' | 'driver';

export interface CarPart {
  id: PartId;
  /** Human label, e.g. "Front wing". */
  label: string;
  group: PartGroup;
  /** The part's root. Its local origin is its assembled position; explode moves it by explodeOffset. */
  object: THREE.Object3D;
  /** Car-frame translation applied at explode = 1 (metres). */
  explodeOffset: THREE.Vector3;
}

/**
 * Named points that move with their part (they are children of the part objects), so arrows and
 * labels follow the explode animation. Read world positions with `getWorldPosition`.
 */
export interface CarAnchors {
  /** On the top surface of the front wing mainplane, at the front-wing centre of pressure, z = 0. */
  frontWingCP: THREE.Object3D;
  /** On the TOP surface of the floor (under the chassis) at the floor centre of pressure, z = 0. */
  floorCP: THREE.Object3D;
  /** On the top surface of the rear wing at its centre of pressure, z = 0. */
  rearWingCP: THREE.Object3D;
  /** Centre of gravity (child of survivalCell). */
  cg: THREE.Object3D;
  /** Just behind the car at mid height (x ≈ -2.6, y ≈ 0.45, z = 0) — origin for the drag arrow. */
  dragOrigin: THREE.Object3D;
  /** Top of the bodywork above the floor centre of pressure (x -0.15), where the floor arrow would enter the car. */
  floorArrowEntry: THREE.Object3D;
  /** Centre of the V6 engine block (child of powerUnit). */
  engine: THREE.Object3D;
  /** Centre of the electric motor-generator, MGU-K (child of powerUnit). */
  mguK: THREE.Object3D;
  /** Centre of the battery / energy store (child of battery). */
  battery: THREE.Object3D;
  /** Rear axle centre line at z = 0, wheel-centre height (child of gearbox): where drive reaches the wheels. */
  rearAxle: THREE.Object3D;
}

export interface CarModel {
  /** Car root in car frame. Parent it to whatever rig moves the car (e.g. the ceiling flip). */
  root: THREE.Group;
  parts: Map<PartId, CarPart>;
  anchors: CarAnchors;
  /** Every mesh that makes up the visible exterior (for raycasting airflow / picking). */
  exteriorMeshes: THREE.Mesh[];
  /** 0 = assembled … 1 = fully exploded. Caller passes an already-eased value. */
  setExplode(t: number): void;
  /** Absolute wheel rotation about each axle (radians). Positive = rolling forward. */
  setWheelSpin(angleRad: number): void;
  /** Lowers the sprung mass (everything except wheels and the lower suspension ends) by `metres`. */
  setRideHeightDrop(metres: number): void;
  /** Active aero, Station 2: 0 = Corner Mode (flaps closed), 1 = Straight Mode (flaps open). */
  setActiveAero(t: number): void;
  /** Tint parts for emphasis; others fade slightly. Pass null to clear. */
  setHighlight(ids: readonly PartId[] | null): void;
  /**
   * X-ray, Station 3: 0 = solid … 1 = the shell (nose, bodywork, survival cell, halo, driver) becomes a faint
   * ghost so the power unit, battery and gearbox inside are clearly visible. Wings, floor, wheels stay solid.
   */
  setXray(t: number): void;
  /**
   * Braking pitch, Station 4: the sprung body turns rigidly about the axle line so its underside
   * dips `noseDropM` at the front axle and rises `tailRiseM` at the rear axle (metres, both 0 = no
   * pitch, exactly). Wheels stay on the road and the suspension follows halfway. It adds to
   * explode and ride-height drop, and the body is lifted if pitching would put any of it within
   * 4 mm of the road. Anchors follow their parts.
   */
  setPitch(noseDropM: number, tailRiseM: number): void;
  /**
   * Brake disc temperatures in degrees Celsius, front pair and rear pair. Cold discs are black
   * carbon-carbon; from about 350 they glow dull red, orange, then yellow-white at 900 and over.
   * The discs sit inside the wheels, so this only shows once `setWheelGhost` is above 0.
   */
  setBrakeTemps(frontC: number, rearC: number): void;
  /**
   * See-through wheels, Station 4: 0 = solid … 1 = tyres a faint dark ring and rims almost clear, so
   * the discs and calipers inside show. The brake hardware is only drawn while this is above 0.
   */
  setWheelGhost(t: number): void;
  dispose(): void;
}

export type BuildCar = () => CarModel;
