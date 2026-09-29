/**
 * Station 02 — Active aero. 2026 cars have no DRS: every driver can switch the wings between
 * Corner Mode (closed, maximum downforce) and Straight Mode (open, less drag) inside marked zones.
 *
 * Two controls — speed and the mode switch — and one idea: top speed is where the power reaching
 * the tyres meets the power the air takes. The rules fade the electric motor out above 290 km/h
 * while drag power grows with speed³, so the drag Straight Mode saves is worth ~11 km/h.
 */
import { aeroState, modeCoefficients } from '../../physics/aero';
import { ESTIMATES, PHYS, REGS } from '../../physics/constants';
import { availablePowerW, mguKLimitKw, powerStatus, requiredPowerW, topSpeedKmh } from '../../physics/powertrain';
import type { Shot } from '../../scene/stage';
import type { AeroMode, StationUIConfig } from '../../ui/types';
import type { Station, StationContext } from '../types';
import { captionFor, PRESETS } from './content';

/** High rear three-quarter: both wings in view, rear flap opening toward the camera. */
const SHOT: Shot = { position: [-6.26, 3.39, 7.68], target: [0.1, 0.45, 0] };

export const ACTIVE_AERO_CONFIG: StationUIConfig = {
  meta: {
    id: 'activeAero',
    number: '02',
    title: 'Active aero',
    prompt: 'Switch the wings. Watch drag — and top speed — change.',
  },
  presets: PRESETS,
  toggles: ['airflow'],
  conditions:
    `${REGS.minMassKg.value} kg · ICE ${ESTIMATES.iceKw} kW est. · motor ≤ ${REGS.mguKMaxKw.value} kW · ` +
    `η ${ESTIMATES.drivelineEfficiency} est. · CdA ${ESTIMATES.cdA}→${modeCoefficients(1).cdA.toFixed(2)} m² est. · ρ ${PHYS.rho} kg/m³`,
};

export function createActiveAeroStation({ garage, ui }: StationContext): Station {
  const state = { mode: 'corner' as AeroMode, airflow: true };
  const topCornerKmh = topSpeedKmh(0);
  const topStraightKmh = topSpeedKmh(1);

  function setMode(mode: AeroMode) {
    state.mode = mode;
    garage.setAeroMode(mode);
    ui.setAeroMode(mode);
  }

  return {
    config: ACTIVE_AERO_CONFIG,
    sweep: { from: 200, to: 345 },
    intro: { kmh: 300, belowKmh: 200 },
    shot: () => SHOT,
    enter() {
      setMode(state.mode);
      garage.setAirflow(state.airflow);
      garage.setWeightArrow(false);
      ui.setToggle('airflow', state.airflow);
    },
    exit() {
      // Other stations assume Corner Mode; the flaps close at the regulated rate.
      garage.setAeroMode('corner');
    },
    onToggle(id, on) {
      if (id !== 'airflow') return;
      state.airflow = on;
      garage.setAirflow(on);
      ui.setToggle('airflow', on);
    },
    onAeroMode: setMode,
    frame(dt, kmh) {
      const t = garage.straightT;
      const aero = aeroState(kmh, undefined, t);
      garage.update(dt, kmh, aero);
      const corner = aeroState(kmh);
      const need = requiredPowerW(kmh, t);
      const have = availablePowerW(kmh);
      const status = powerStatus({ requiredPowerW: need.totalW, availablePowerW: have });
      ui.render({
        station: 'activeAero',
        view: {
          speedKmh: kmh,
          mode: state.mode,
          straightT: t,
          downforceN: aero.downforceN,
          cornerDownforceN: corner.downforceN,
          dragN: aero.dragN,
          cornerDragN: corner.dragN,
          surfaces: aero.surfaces,
          dragPowerW: need.dragW,
          requiredPowerW: need.totalW,
          availablePowerW: have,
          mguKLimitKw: mguKLimitKw(kmh),
          iceKw: ESTIMATES.iceKw,
          topSpeedCornerKmh: topCornerKmh,
          topSpeedStraightKmh: topStraightKmh,
          caption: captionFor({ kmh, mode: state.mode, straightT: t, status, topCornerKmh, topStraightKmh }),
        },
      });
    },
  };
}
