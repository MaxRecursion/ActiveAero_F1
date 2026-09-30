/**
 * A station is one idea: one main control, one thing made visible, a few live numbers and a
 * one-line why. The app owns the shared speed; a station turns it into physics, drives the
 * garage and pushes its view to the UI.
 */
import type { Garage } from '../app/garage';
import type { Shot, ShotName, Stage } from '../scene/stage';
import type { AeroMode, StationUIConfig, ToggleId, UI } from '../ui/types';

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
  /** Take over the garage and UI (called after the previous station exited). */
  enter(): void;
  /** Put anything the station changed back to neutral. */
  exit(): void;
  onToggle?(id: ToggleId, on: boolean): void;
  onAeroMode?(mode: AeroMode): void;
  /** Once per frame with the shared speed: physics → garage.update → ui.render. */
  frame(dt: number, kmh: number): void;
}

export type StationFactory = (ctx: StationContext) => Station;
