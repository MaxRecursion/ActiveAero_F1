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

export type StationId = 'downforce' | 'activeAero' | 'energy';

export interface StationMeta {
  id: StationId;
  /** Two-digit label, e.g. "01". */
  number: string;
  /** Short title for the tab, e.g. "Downforce". */
  title: string;
  /** One-line instruction under the header, e.g. "Drag the speed. Watch the air push down." */
  prompt: string;
}

export type ToggleId = 'airflow' | 'exploded' | 'ceiling' | 'xray' | 'clipping';
export type AeroMode = 'corner' | 'straight';

/** A caption is a list of styled runs, rendered as spans (never innerHTML). */
export type Tone = 'down' | 'drag' | 'weight' | 'energy' | 'engine' | 'strong' | 'muted';
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
  /** Main control: the speed slider (default) or the lap timeline (Station 3). */
  control?: 'speed' | 'lap';
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

export type StationView =
  | { station: 'downforce'; view: Station1View }
  | { station: 'activeAero'; view: Station2View }
  | { station: 'energy'; view: Station3View };

// ── Shell ──────────────────────────────────────────────────────────────────────

export interface UIHandlers {
  /** User moved the speed control (slider drag, keys, preset click). */
  onSpeedInput(kmh: number): void;
  onToggle(id: ToggleId, on: boolean): void;
  /** Play / stop the automatic speed sweep. */
  onPlayToggle(): void;
  onResetView(): void;
  /** User picked a station tab (or pressed 1 / 2). */
  onStationChange(id: StationId): void;
  /** User picked Corner / Straight Mode (Station 2 switch, or key M to flip). */
  onAeroMode(mode: AeroMode): void;
  /** User moved the lap playhead (timeline drag, map click, ←/→ keys), seconds into the lap. */
  onLapScrub(tS: number): void;
  /** User picked a playback rate (0.5, 1 or 2). */
  onLapRate(rate: number): void;
}

export interface UIOptions {
  root: HTMLElement;
  handlers: UIHandlers;
  stations: StationUIConfig[];
  initialStation: StationId;
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
