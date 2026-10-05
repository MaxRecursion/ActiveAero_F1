import type { LiveryId } from '../scene/car/types';
import type { Theme } from '../theme';

/**
 * CONTRACT — the DOM interface, shared by every station. Implemented by src/ui/createUI.ts (+ src/ui/*).
 *
 * One shell (header with station tabs, toolbar, caption, dock with the speed control and toggles,
 * "How it works" dialog) hosts one station panel at a time (readouts + chart for that station).
 * The UI owns no physics state: the active station pushes a view every frame and the UI reports
 * user intent through `UIHandlers`.
 */
import type { AeroSurfaceId } from '../physics/constants';
import type { LapPhase } from '../physics/lap';
import type { Insets } from '../scene/stage';

export type StationId = 'downforce' | 'activeAero' | 'energy' | 'braking' | 'tow' | 'aeroMap';

export interface StationMeta {
  id: StationId;
  /** Two-digit label, e.g. "01". */
  number: string;
  /** Short title for the tab, e.g. "Downforce". */
  title: string;
  /** One-line instruction under the header, e.g. "Drag the speed. Watch the air push down." */
  prompt: string;
}

export type ToggleId = 'airflow' | 'exploded' | 'ceiling' | 'xray' | 'clipping' | 'brakes';
export type AeroMode = 'corner' | 'straight';

/** A caption is a list of styled runs, rendered as spans (never innerHTML). */
export type Tone = 'down' | 'drag' | 'weight' | 'energy' | 'engine' | 'heat' | 'strong' | 'muted';
export interface CaptionRun {
  text: string;
  tone?: Tone;
}

export interface SpeedPreset {
  kmh: number;
  label: string;
}

/** Everything the shell needs to present one station. */
export interface StationUIConfig {
  meta: StationMeta;
  presets: SpeedPreset[];
  /** Toggles shown for this station, in order (may be empty). */
  toggles: ToggleId[];
  /** "Test conditions" strip text for this station. */
  conditions: string;
  /**
   * Main control: the speed slider (default), the lap timeline (Station 3), or the speed slider as
   * "brake from" speed plus a Brake button and a zone scrubber (Station 4).
   */
  control?: 'speed' | 'lap' | 'brake';
}

// ── Station 01 · Downforce ─────────────────────────────────────────────────────

export interface Station1View {
  speedKmh: number;
  downforceN: number;
  dragN: number;
  dragPowerW: number;
  weightN: number;
  downforceToWeight: number;
  downforceEquivalentKg: number;
  ceilingSpeedKmh: number;
  surfaces: ReadonlyArray<{ id: AeroSurfaceId; label: string; downforceN: number }>;
  /** One-sentence "why" for the current state. */
  caption: CaptionRun[];
  /** Ceiling test status: off, car sticks (downforce > weight), or car falls. */
  ceiling: 'off' | 'sticks' | 'falls';
}

// ── Station 02 · Active aero ───────────────────────────────────────────────────

export interface Station2View {
  speedKmh: number;
  /** Commanded mode (what the switch shows). */
  mode: AeroMode;
  /** Flap position 0 = Corner … 1 = Straight; animates over ≤400 ms after a mode change. */
  straightT: number;
  downforceN: number;
  /** Downforce at this speed in Corner Mode (for "−25%" style deltas). */
  cornerDownforceN: number;
  dragN: number;
  /** Drag at this speed in Corner Mode. */
  cornerDragN: number;
  surfaces: ReadonlyArray<{ id: AeroSurfaceId; label: string; downforceN: number }>;
  /** Power spent against drag alone at this speed, W. */
  dragPowerW: number;
  /** Power needed to hold this speed (drag + rolling resistance), current flap position, W. */
  requiredPowerW: number;
  /** Power reaching the tyres at this speed: η · (ICE + regulated motor limit), W. */
  availablePowerW: number;
  /** Regulated electric motor limit at this speed (FIA C5.2.8), kW. */
  mguKLimitKw: number;
  /** Combustion engine output (estimate), kW. */
  iceKw: number;
  topSpeedCornerKmh: number;
  topSpeedStraightKmh: number;
  caption: CaptionRun[];
}

// ── Station 03 · Energy ────────────────────────────────────────────────────────

/** Static description of one simulated lap. The same object is re-sent every frame until the lap changes. */
export interface LapTrace {
  lengthM: number;
  lapTimeS: number;
  /** Circuit outline for the map, metres (~one point per 10 m, closed loop; y grows to the left). */
  map: ReadonlyArray<{ x: number; y: number }>;
  /** Timeline trace, ~one point per 10 m of lap distance. */
  trace: ReadonlyArray<{ s: number; t: number; kmh: number; socMJ: number; mguKKw: number; phase: LapPhase }>;
  corners: ReadonlyArray<{ label: string; s: number; x: number; y: number }>;
  harvestedMJ: number;
  brakeHarvestMJ: number;
  clipHarvestMJ: number;
  deployedMJ: number;
  topSpeedKmh: number;
  /** Regulated recovery limit per lap (8.5 MJ) and battery window (4 MJ). */
  harvestCapMJ: number;
  windowMJ: number;
  /** Lap time of the same car without super clipping (for the comparison). */
  noClipLapTimeS: number;
  /** Whether this lap uses super clipping. */
  clipping: boolean;
}

export interface Station3View {
  lap: LapTrace;
  /** Playhead time, s (0 … lapTimeS). */
  tS: number;
  /** Playhead distance, m. */
  sM: number;
  kmh: number;
  phase: LapPhase;
  /** + deploying to the wheels, − harvesting into the battery, kW. */
  mguKKw: number;
  engineKw: number;
  socMJ: number;
  /** Cumulative this lap, MJ. */
  harvestedMJ: number;
  deployedMJ: number;
  playing: boolean;
  /** Playback rate: 0.5, 1 or 2. */
  rate: number;
  caption: CaptionRun[];
}

// ── Station 04 · Braking ───────────────────────────────────────────────────────

/** ready: cruising at the entry speed, pedal up. braking: a zone is playing (or paused). done: reached the apex speed. */
export type BrakeState = 'ready' | 'braking' | 'done';

export interface BrakePoint {
  /** Time since the pedal went down, s. */
  t: number;
  kmh: number;
  decelG: number;
  /** Power the brakes take out of the car, kW (harvest + heat). */
  brakeKw: number;
  /** Power the motor-generator puts back into the battery, kW (≤ 350). */
  harvestKw: number;
  /** Power that turns into heat in the discs, kW. */
  heatKw: number;
  /** Disc temperatures, °C (one disc per axle side; the two sides match). */
  frontDiscC: number;
  rearDiscC: number;
}

/** Static description of one brake zone. The same object is re-sent every frame until the entry speed changes. */
export interface BrakeTrace {
  fromKmh: number;
  toKmh: number;
  timeS: number;
  distanceM: number;
  /** Thinned to about one point per 25 ms; the last point is the end of the zone. */
  points: ReadonlyArray<BrakePoint>;
  peakDecelG: number;
  /** Where the car's kinetic energy goes over the whole zone, MJ. dragMJ + harvestMJ + heatMJ = kineticMJ. */
  kineticMJ: number;
  dragMJ: number;
  harvestMJ: number;
  heatMJ: number;
  peakFrontDiscC: number;
  peakRearDiscC: number;
  /** The carbon-carbon working window, °C (350–550). */
  discWindowC: { min: number; max: number };
}

export interface Station4View {
  zone: BrakeTrace;
  state: BrakeState;
  /** Playhead time into the zone, s (0 … zone.timeS). */
  tS: number;
  /** Distance braked so far, m. */
  sM: number;
  kmh: number;
  decelG: number;
  brakeKw: number;
  harvestKw: number;
  heatKw: number;
  /** Axle loads now, N: weight + downforce + the weight braking has thrown forward. */
  frontLoadN: number;
  rearLoadN: number;
  /** The same axles' loads without the transfer (weight + downforce at this speed), N. */
  frontStaticN: number;
  rearStaticN: number;
  /** Load moved from the rear axle to the front, N. */
  transferN: number;
  /** Ideal front brake bias now = front share of the total load, percent. */
  frontBiasPct: number;
  /** Real nose dip at the front axle in mm (before the exaggeration used in the 3D view). */
  noseDropMm: number;
  /** How many times the 3D view exaggerates the dive, e.g. 6. */
  diveExaggeration: number;
  frontDiscC: number;
  rearDiscC: number;
  /** Cumulative since the pedal went down, MJ. */
  harvestedMJ: number;
  heatMJ: number;
  playing: boolean;
  /** Playback rate: 0.25, 0.5 or 1 (1 = real time). */
  rate: number;
  caption: CaptionRun[];
}

export interface Station5View {
  speedKmh: number;
  gapM: number;
  wakeStrength: number;
  dragReduction: number;
  downforceLoss: number;
  leadingDragN: number;
  followingDragN: number;
  leadingDownforceN: number;
  followingDownforceN: number;
  powerSavedW: number;
  caption: CaptionRun[];
}

// ── Station 06 · Aero map ──────────────────────────────────────────────────────

/** Ride heights in mm: the reference plane (floor underside, FIA Z = 0) above the ground at each axle line. */
export interface RideHeights {
  frontMm: number;
  rearMm: number;
}

/**
 * The floor's state on its ground-effect curve: below the peak height the diffuser flow
 * separates and downforce falls away (Ruhrmann & Zhang 2003).
 */
export type FloorRegime = 'attached' | 'peak' | 'stalled';

/** A named static set-up the UI offers as a one-click choice. */
export interface RideHeightPreset extends RideHeights {
  id: string;
  label: string;
}

export interface Station6View {
  speedKmh: number;
  /** Static (garage) ride heights the user set. */
  setup: RideHeights;
  /** Ride heights now, at speed, including any bounce. */
  dynamic: RideHeights;
  /**
   * Where this set-up sits on the map as speed rises from 0 to the top of the speed range
   * (the platform settling on its springs). Same array object until the set-up changes.
   */
  trajectory: ReadonlyArray<{ kmh: number; frontMm: number; rearMm: number }>;
  /** Map point where ClA and balance equal the constants the other stations use. */
  reference: RideHeights;
  clA: number;
  cdA: number;
  downforceN: number;
  dragN: number;
  /** Downforce ÷ drag. */
  efficiency: number;
  /** Aero balance: % of the downforce on the front axle, now and at the reference point. */
  frontSharePct: number;
  refFrontSharePct: number;
  /** Static weight on the front axle, % (what the balance is usually compared with). */
  weightFrontPct: number;
  surfaces: ReadonlyArray<{ id: AeroSurfaceId; label: string; downforceN: number }>;
  floor: {
    regime: FloorRegime;
    /** Gap under the floor at the diffuser inlet now, mm. */
    throatGapMm: number;
    /** Throat gap at which the floor makes the most downforce for the current pitch, mm. */
    peakGapMm: number;
  };
  /**
   * Underfloor centreline pressure coefficient from the front of the floor (x high) to the
   * diffuser exit (x low), car-frame metres. The arrays may be reused between frames.
   */
  pressure: {
    x: ArrayLike<number>;
    cp: ArrayLike<number>;
    /** Diffuser inlet (throat) and exit positions, m. */
    throatX: number;
    exitX: number;
    /** Where the diffuser flow separates (null when attached), m. */
    separationX: number | null;
  };
  /** Smallest gap between the plank's underside and the ground, mm (0 when touching). */
  plankClearanceMm: number;
  bottoming: boolean;
  /** Heave/pitch bounce: the least-damped body mode at this speed, and what the car is doing now. */
  bounce: {
    /** Porpoising: the mode's damping has gone negative. */
    unstable: boolean;
    frequencyHz: number;
    dampingRatio: number;
    /** Peak-to-peak ride-height swing now (real, before any exaggeration), mm. */
    amplitudeMm: number;
    /** Lowest speed at which this set-up porpoises, or null if it never does in the speed range. */
    onsetKmh: number | null;
    /**
     * Where that porpoising window ends again (the stall side flattens, or the plank lands), km/h; null with
     * no onset. The window is narrow: a set-up porpoises only while its floor sits on the stall's drop.
     */
    untilKmh: number | null;
  };
  /** How many times bigger the 3D view draws ride-height changes. */
  rideExaggeration: number;
  presets: ReadonlyArray<RideHeightPreset>;
  caption: CaptionRun[];
}

export type StationView =
  | { station: 'downforce'; view: Station1View }
  | { station: 'activeAero'; view: Station2View }
  | { station: 'energy'; view: Station3View }
  | { station: 'braking'; view: Station4View }
  | { station: 'tow'; view: Station5View }
  | { station: 'aeroMap'; view: Station6View };

// ── Shell ──────────────────────────────────────────────────────────────────────

export interface UIHandlers {
  /** User moved the speed control (slider drag, keys, preset click). */
  onSpeedInput(kmh: number): void;
  onTowGapInput(gapM: number): void;
  /** Station 6: the user changed the static ride heights (sliders, a preset, or the map). */
  onRideHeightInput(setup: RideHeights): void;
  onToggle(id: ToggleId, on: boolean): void;
  /** Whether the car sound is muted. */
  onSoundToggle(muted: boolean): void;
  onThemeChange(theme: Theme): void;
  /** Studio clay, or a 2026 team colour scheme. */
  onLiveryChange(id: LiveryId): void;
  /** Play / stop the automatic speed sweep. */
  onPlayToggle(): void;
  onResetView(): void;
  /** User picked a station tab (or pressed 1 / 2). */
  onStationChange(id: StationId): void;
  /** User picked Corner / Straight Mode (Station 2 switch, or key M to flip). */
  onAeroMode(mode: AeroMode): void;
  /**
   * User moved the playhead (Station 3: timeline drag, map click, ←/→ keys; Station 4: the brake-zone
   * chart), seconds in.
   */
  onLapScrub(tS: number): void;
  /** User picked a playback rate (Station 3: 0.5, 1 or 2; Station 4: 0.25, 0.5 or 1). */
  onLapRate(rate: number): void;
}

export interface UIOptions {
  root: HTMLElement;
  handlers: UIHandlers;
  stations: StationUIConfig[];
  initialStation: StationId;
  /** Paint already on the car. Defaults to studio clay. */
  initialLivery?: LiveryId;
  minKmh: number;
  maxKmh: number;
}

export interface UI {
  /** Present a station: tabs, prompt, presets, toggles, conditions and panel. Does not fire onStationChange. */
  setStation(id: StationId): void;
  /** Called every frame with the active station's view. Must only touch the DOM when a displayed value changes. */
  render(view: StationView): void;
  /** Move the speed control without firing onSpeedInput (used while a sweep animates). */
  setSpeedControl(kmh: number): void;
  setToggle(id: ToggleId, on: boolean): void;
  /**
   * Mark a toggle unavailable (kept focusable, announced with `reason`; clicks and its key do nothing)
   * or available again. The toggle keeps its on/off state meanwhile. `reason` is required when unavailable.
   */
  setToggleAvailable(id: ToggleId, available: boolean, reason?: string): void;
  /** Reflect the commanded aero mode without firing onAeroMode. */
  setAeroMode(mode: AeroMode): void;
  setPlaying(playing: boolean): void;
  /** Pixels of the viewport covered by UI panels, for stage.setInsets(). */
  getInsets(): Insets;
  /** Fires when panel sizes change (resize, breakpoint, station switch). */
  onLayoutChange(cb: () => void): void;
  dispose(): void;
}

export type CreateUI = (opts: UIOptions) => UI;
