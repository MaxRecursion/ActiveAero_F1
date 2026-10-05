/**
 * A station is one idea: one main control, one thing made visible, a few live numbers and a
 * one-line why. The app owns the shared speed; a station turns it into physics, drives the
 * garage and pushes its view to the UI.
 */
import type { Garage } from '../app/garage';
import type { Shot, ShotName, Stage } from '../scene/stage';
import type { AeroMode, RideHeights, StationUIConfig, ToggleId, UI } from '../ui/types';

export interface StationContext {
  stage: Stage;
  garage: Garage;
  ui: UI;
}

export interface Station {
  config: StationUIConfig;
  /** Where the camera goes for this station's current state. */
  shot(): ShotName | Shot;
  /** Automatic sweep bounds (km/h) for the play button (stations driven by the speed slider). */
  sweep?: { from: number; to: number };
  /** Speed eased to when the station opens below `belowKmh`, so the untouched view already teaches. */
  intro?: { kmh: number; belowKmh: number };
  /**
   * Stations that drive their own speed (the Station 3 lap) report it here; the app adopts it so a
   * station switch continues from the same speed.
   */
  currentKmh?(): number;
  /** Replaces the app's speed sweep for the play button / Space. */
  onPlayToggle?(): void;
  onLapScrub?(tS: number): void;
  onLapRate?(rate: number): void;
  onTowGap?(gapM: number): void;
  /** Station 6: new static ride heights. */
  onRideHeight?(setup: RideHeights): void;
  /** Take over the garage and UI (called after the previous station exited). */
  enter(): void;
  /** Put anything the station changed back to neutral. */
  exit(): void;
  onToggle?(id: ToggleId, on: boolean): void;
  onAeroMode?(mode: AeroMode): void;
  /** Once per frame with the shared speed: physics → garage.update → ui.render. */
  frame(dt: number, kmh: number): void;
  /**
   * Car sound for this frame. Stations where the car is simply holding the shared speed omit it,
   * and the mix infers throttle from the aero power balance.
   */
  audio?(): SoundCue | void;
}

/** What a station adds when speed alone is the wrong story: a stop, a lift, a lap. */
export interface SoundCue {
  /** Speed the car is actually doing, when that is not the shared slider. */
  kmh?: number;
  /** 0 overrun … 1 full power. */
  load: number;
  /** 0–1, from how hard the brakes are working. */
  brake: number;
  /** Signed motor kW: + deploying, − harvesting. */
  mguKKw: number;
}

export type StationFactory = (ctx: StationContext) => Station;
