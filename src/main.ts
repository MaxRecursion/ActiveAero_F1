import './styles/tokens.css';
import { startApp } from './app/app';
import { buildCar } from './scene/car/buildCar';
import { loadCar } from './scene/car/loadCar';
import type { CarModel } from './scene/car/types';
import { createStage, type Stage } from './scene/stage';

declare global {
  interface Window {
    /** Set once the first frames are on screen (used by scripts/shot.mjs). */
    __ready?: boolean;
  }
}

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

const mount = document.getElementById('stage')!;
const uiRoot = document.getElementById('ui')!;
const boot = document.getElementById('boot')!;

/** The real body if the model loads; the procedural car keeps the page working if it does not. */
async function getCar(): Promise<CarModel> {
  try {
    return await loadCar();
  } catch (err) {
    console.warn('Car model failed to load, using the procedural car.', err);
    return buildCar();
  }
}

async function start(stage: Stage) {
  const car = await getCar();
  startApp(stage, uiRoot, car);
  let frames = 0;
  const off = stage.onFrame(() => {
    if (++frames < 3) return;
    boot.classList.add('gone');
    window.__ready = true;
    off();
  });
  stage.start();
}

if (!hasWebGL2()) {
  boot.textContent = 'This explainer needs WebGL 2, which this browser or device has turned off.';
} else {
  void start(createStage({ mount }));
}
