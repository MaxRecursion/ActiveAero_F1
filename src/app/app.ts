/**
 * The app: one stage, one garage, one UI shell, several stations. Owns what stations share —
 * the speed (so switching station keeps the car running), the automatic sweep and routing
 * (#/downforce, #/active-aero) — and forwards everything else to the active station.
 */
import * as THREE from 'three';
import { SPEED_RANGE_KMH } from '../physics/constants';
import { prefersReducedMotion, type Stage } from '../scene/stage';
import { ACTIVE_AERO_CONFIG, createActiveAeroStation } from '../stations/activeAero/station';
import { createDownforceStation, DOWNFORCE_CONFIG } from '../stations/downforce/station';
import { createEnergyStation, ENERGY_CONFIG } from '../stations/energy/station';
import type { Station, StationFactory } from '../stations/types';
import { createUI } from '../ui/createUI';
import type { StationId, StationUIConfig } from '../ui/types';
import { createGarage, easeInOut } from './garage';

/** Tab order. */
const STATIONS: { config: StationUIConfig; create: StationFactory }[] = [
  { config: DOWNFORCE_CONFIG, create: createDownforceStation },
  { config: ACTIVE_AERO_CONFIG, create: createActiveAeroStation },
  { config: ENERGY_CONFIG, create: createEnergyStation },
];
const ROUTES: Record<StationId, string> = {
  downforce: '#/downforce',
  activeAero: '#/active-aero',
  energy: '#/energy',
};
const SWEEP_SECONDS = 4.5;
const INTRO_SECONDS = 3.2;
const AIRFLOW_HIDDEN_REASON = 'Airflow is hidden while the car is exploded';

function stationFromHash(): StationId | null {
  const hit = (Object.entries(ROUTES) as [StationId, string][]).find(([, route]) => route === location.hash);
  return hit ? hit[0] : null;
}

export function startApp(stage: Stage, uiRoot: HTMLElement) {
  const reducedMotion = prefersReducedMotion();
  const garage = createGarage(stage);

  const speed = { target: 0, kmh: 0 };
  let sweep: null | { t: number; loop: boolean; from: number; to: number; duration: number } = null;
  let active: Station | undefined;

  const ui = createUI({
    root: uiRoot,
    minKmh: SPEED_RANGE_KMH.min,
    maxKmh: SPEED_RANGE_KMH.max,
    stations: STATIONS.map((s) => s.config),
    initialStation: stationFromHash() ?? 'downforce',
    handlers: {
      onSpeedInput(kmh) {
        stopSweep();
        speed.target = kmh;
      },
      onToggle(id, on) {
        active?.onToggle?.(id, on);
        syncAirflowAvailability();
      },
      onAeroMode: (mode) => active?.onAeroMode?.(mode),
      onPlayToggle() {
        if (active?.onPlayToggle) active.onPlayToggle();
        else if (sweep?.loop) stopSweep();
        else startSweep(true);
      },
      onLapScrub: (tS) => active?.onLapScrub?.(tS),
      onLapRate: (rate) => active?.onLapRate?.(rate),
      onResetView: () => active && void stage.goTo(active.shot()),
      onStationChange(id) {
        if (location.hash !== ROUTES[id]) location.hash = ROUTES[id];
        else switchTo(id);
      },
    },
  });

  const ctx = { stage, garage, ui };
  const stations = Object.fromEntries(STATIONS.map((s) => [s.config.meta.id, s.create(ctx)])) as Record<
    StationId,
    Station
  >;

  /** The garage fades the airflow out while the car is exploded, so its toggle must say so. */
  function syncAirflowAvailability() {
    ui.setToggleAvailable('airflow', !garage.exploded, AIRFLOW_HIDDEN_REASON);
  }

  // ── speed sweep ────────────────────────────────────────────────────────────────
  function startSweep(loop: boolean, to?: number) {
    if (!active?.sweep) return;
    const { from: lo, to: hi } = active.sweep;
    const from = speed.kmh;
    const mid = (lo + hi) / 2;
    sweep = {
      t: 0,
      loop,
      from,
      to: to ?? (from > mid ? lo : hi),
      duration: loop ? SWEEP_SECONDS : INTRO_SECONDS,
    };
    ui.setPlaying(loop);
  }

  function stopSweep() {
    if (!sweep) return;
    sweep = null;
    ui.setPlaying(false);
  }

  function stepSweep(dt: number) {
    if (!sweep) return;
    sweep.t += dt / sweep.duration;
    const k = easeInOut(Math.min(1, sweep.t));
    speed.target = speed.kmh = sweep.from + (sweep.to - sweep.from) * k;
    ui.setSpeedControl(speed.target);
    if (sweep.t < 1) return;
    if (!sweep.loop || !active?.sweep) return stopSweep();
    const { from: lo, to: hi } = active.sweep;
    sweep = { ...sweep, t: 0, from: sweep.to, to: sweep.to === hi ? lo : hi };
  }

  /** Open a station; ease the speed into its interesting range if we're below it. */
  function introduce(station: Station) {
    if (!station.intro) return;
    const { kmh, belowKmh } = station.intro;
    if (speed.kmh >= belowKmh) return;
    if (reducedMotion) {
      speed.target = speed.kmh = kmh;
      ui.setSpeedControl(kmh);
    } else {
      startSweep(false, kmh);
    }
  }

  // ── routing ────────────────────────────────────────────────────────────────────
  function switchTo(id: StationId) {
    if (active === stations[id]) return;
    stopSweep();
    active?.exit();
    const next = stations[id];
    active = next;
    ui.setStation(id);
    next.enter();
    syncAirflowAvailability();
    void stage.goTo(next.shot());
    introduce(next);
  }

  const onHash = () => switchTo(stationFromHash() ?? 'downforce');
  window.addEventListener('hashchange', onHash);

  // ── layout: keep the car centred in the part of the screen the UI leaves free ──
  const syncInsets = () => stage.setInsets(ui.getInsets());
  ui.onLayoutChange(syncInsets);

  // ── frame ──────────────────────────────────────────────────────────────────────
  const offFrame = stage.onFrame((dt) => {
    stepSweep(dt);
    if (!sweep) speed.kmh = THREE.MathUtils.damp(speed.kmh, speed.target, 7, dt);
    if (Math.abs(speed.kmh - speed.target) < 0.05) speed.kmh = speed.target;
    active?.frame(dt, speed.kmh);
    const own = active?.currentKmh?.();
    if (own !== undefined) speed.target = speed.kmh = own;
  });

  switchTo(stationFromHash() ?? 'downforce');
  syncInsets();

  if (import.meta.env.DEV) {
    // Dev-only handle for debugging and headless checks.
    (window as unknown as { __app: unknown }).__app = {
      speed,
      get sweep() {
        return sweep;
      },
      get station() {
        return active?.config.meta.id;
      },
      garage,
    };
  }

  return {
    dispose() {
      offFrame();
      window.removeEventListener('hashchange', onHash);
      active?.exit();
      ui.dispose();
      garage.dispose();
    },
  };
}
