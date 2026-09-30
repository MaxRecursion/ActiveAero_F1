/** Station 05 — the tow: reduced drag in the lead car's wake, with reduced downforce as the tradeoff. */
import { aeroState } from '../../physics/aero';
import { towState, TOW_MODEL } from '../../physics/tow';
import type { Shot } from '../../scene/stage';
import type { Station5View, StationUIConfig } from '../../ui/types';
import type { Station, StationContext } from '../types';
import { PRESETS } from '../downforce/content';

const MIN_GAP_M = 2;
const MAX_GAP_M = 12;
const DEFAULT_GAP_M = 6;
const CAR_LENGTH_M = 5.3;

export const TOW_CONFIG: StationUIConfig = {
  meta: {
    id: 'tow',
    number: '05',
    title: 'Tow',
    prompt: 'Close the gap. See what the wake saves, and what it costs.',
  },
  presets: PRESETS,
  toggles: [],
  conditions: `Illustrative wake · ${TOW_MODEL.wakeDecayM} m decay · max ${TOW_MODEL.maxDragReduction * 100}% drag reduction / ${TOW_MODEL.maxDownforceLoss * 100}% downforce loss`,
};

function towShot(gapM: number): Shot {
  const centerX = -(CAR_LENGTH_M + gapM) / 2;
  const distance = 17 + gapM * 1.35;
  return {
    position: [centerX + distance * 0.18, distance * 0.32, distance * 0.93],
    target: [centerX, 0.55, 0],
  };
}

export function createTowStation({ stage, garage, ui }: StationContext): Station {
  let gapM = DEFAULT_GAP_M;
  const originalMaxDistance = stage.controls.maxDistance;

  function setGap(next: number) {
    gapM = Math.min(MAX_GAP_M, Math.max(MIN_GAP_M, next));
    garage.setTow(gapM);
    void stage.goTo(towShot(gapM), false);
  }

  const station: Station = {
    config: TOW_CONFIG,
    sweep: { from: 0, to: 330 },
    intro: { kmh: 250, belowKmh: 1 },
    shot: () => towShot(gapM),
    enter() {
      stage.controls.maxDistance = 36;
      garage.setExploded(false);
      garage.setCeiling(false);
      garage.setAirflow(true);
      garage.setAeroMode('corner');
      garage.setWeightArrow(false);
      garage.setForceArrows(false);
      garage.setXray(false);
      garage.setEnergyFlow(false);
      garage.setBraking(null);
      garage.setHighlight(null);
      setGap(gapM);
      ui.setToggle('airflow', false);
    },
    exit() {
      garage.setTow(null);
      stage.controls.maxDistance = originalMaxDistance;
    },
    onTowGap: setGap,
    frame(dt, kmh) {
      const wake = towState(kmh, gapM);
      garage.setTow(gapM, wake.wakeStrength);
      garage.update(dt, kmh, aeroState(kmh));
      const view: Station5View = {
        ...wake,
        caption: [
          { text: 'The following car saves ' },
          { text: `${Math.round(wake.dragReduction * 100)}% drag`, tone: 'drag' },
          { text: ` but loses ${Math.round(wake.downforceLoss * 100)}% downforce. A tow trades corner grip for straight-line speed.` },
        ],
      };
      ui.render({ station: 'tow', view });
    },
  };
  return station;
}