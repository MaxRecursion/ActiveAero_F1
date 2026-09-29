/**
 * Station 01 — Downforce. One control (speed) makes one invisible thing visible (the air pushing
 * the car down), with live numbers and a one-line why.
 *
 *   speed ─► aeroState() ─► garage (arrows · airflow · road · wheels) + readouts · caption
 *
 * Extras: Exploded (bodywork lifts so the floor shows) and the Ceiling test (the rig flips; above
 * the ceiling speed downforce beats weight and the car stays up).
 */
import { aeroState } from '../../physics/aero';
import { ESTIMATES, PHYS, REGS } from '../../physics/constants';
import type { Shot } from '../../scene/stage';
import type { Station1View, StationUIConfig } from '../../ui/types';
import type { Station, StationContext } from '../types';
import { captionFor, PRESETS } from './content';

const EXPLODED_SHOT: Shot = { position: [6.72, 5.14, 7.92], target: [0, 0.7, 0] };

export const DOWNFORCE_CONFIG: StationUIConfig = {
  meta: {
    id: 'downforce',
    number: '01',
    title: 'Downforce',
    prompt: 'Drag the speed. Watch the air push down.',
  },
  presets: PRESETS,
  toggles: ['airflow', 'exploded', 'ceiling'],
  conditions: `ISA sea level · ρ ${PHYS.rho} kg/m³ · ${REGS.minMassKg.value} kg · ClA ${ESTIMATES.clA} m² est. · CdA ${ESTIMATES.cdA} m² est.`,
};

export function createDownforceStation({ garage, ui, stage }: StationContext): Station {
  const state = { exploded: false, ceiling: false, airflow: true };

  function setExploded(on: boolean) {
    state.exploded = on;
    garage.setExploded(on);
    ui.setToggle('exploded', on);
    if (on && state.ceiling) setCeiling(false);
  }

  function setCeiling(on: boolean) {
    state.ceiling = on;
    garage.setCeiling(on);
    garage.setWeightArrow(on);
    ui.setToggle('ceiling', on);
    if (on && state.exploded) setExploded(false);
  }

  const station: Station = {
    config: DOWNFORCE_CONFIG,
    sweep: { from: 0, to: 330 },
    intro: { kmh: 250, belowKmh: 1 },
    shot() {
      if (state.ceiling) return 'ceiling';
      if (state.exploded) return EXPLODED_SHOT;
      return 'hero';
    },
    enter() {
      garage.setAeroMode('corner');
      garage.setAirflow(state.airflow);
      garage.setHighlight(null);
      ui.setToggle('airflow', state.airflow);
      ui.setToggle('exploded', state.exploded);
      ui.setToggle('ceiling', state.ceiling);
    },
    exit() {
      // Leave the car assembled and upright for the next station.
      if (state.exploded) setExploded(false);
      if (state.ceiling) setCeiling(false);
    },
    onToggle(id, on) {
      if (id === 'airflow') {
        state.airflow = on;
        garage.setAirflow(on);
        ui.setToggle('airflow', on);
        return;
      }
      if (id === 'exploded') setExploded(on);
      else setCeiling(on);
      void stage.goTo(station.shot());
    },
    frame(dt, kmh) {
      const aero = aeroState(kmh);
      garage.update(dt, kmh, aero);
      const ceiling: Station1View['ceiling'] =
        !state.ceiling || garage.flipT < 0.9 ? 'off' : aero.downforceToWeight >= 1 ? 'sticks' : 'falls';
      ui.render({
        station: 'downforce',
        view: {
          speedKmh: kmh,
          downforceN: aero.downforceN,
          dragN: aero.dragN,
          dragPowerW: aero.dragPowerW,
          weightN: aero.weightN,
          downforceToWeight: aero.downforceToWeight,
          downforceEquivalentKg: aero.downforceEquivalentKg,
          ceilingSpeedKmh: aero.ceilingSpeedKmh,
          surfaces: aero.surfaces,
          caption: captionFor({ aero, exploded: state.exploded, ceiling }),
          ceiling,
        },
      });
    },
  };
  return station;
}
