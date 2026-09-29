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

/** Replace the loading line with a message screen readers announce and everyone can read. */
function showFailure(message: string) {
  boot.textContent = message;
  boot.classList.remove('gone');
  boot.classList.add('failed');
  boot.removeAttribute('aria-hidden');
  boot.setAttribute('role', 'alert');
}

async function start(mountEl: HTMLElement) {
  let stage: Stage;
  let car: CarModel;
  try {
    stage = createStage({ mount: mountEl });
    car = await getCar();
    startApp(stage, uiRoot, car);
  } catch (err) {
    console.error(err);
    showFailure('Something went wrong starting the 3D view. Reload the page, or try another browser.');
    return;
  }
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
  showFailure('This explainer needs WebGL 2, which this browser or device has turned off. Try another browser or enable hardware acceleration.');
} else {
  void start(mount);
}
