import './styles/tokens.css';
import './styles/rotate.css';
import { getTheme, initializeTheme } from './theme';
import { startApp } from './app/app';
import { buildCar } from './scene/car/buildCar';
import { loadCar } from './scene/car/loadCar';
import type { CarModel } from './scene/car/types';
import { createStage, type Stage } from './scene/stage';
import { watchPortraitPhone } from './ui/portraitPhone';

initializeTheme();

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
const appEl = document.getElementById('app')!;

/**
 * A phone held upright gets the "turn your phone sideways" screen (index.html, rotate.css). Behind it
 * the app is inert (no focus, no taps, hidden from screen readers), the 3D view stops drawing and the
 * car goes quiet; turning the phone wakes it where it was.
 */
let upright = false;
let sleepApp: ((asleep: boolean) => void) | null = null;
watchPortraitPhone((on) => {
  upright = on;
  appEl.inert = on;
  if (on) for (const d of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) d.close();
  sleepApp?.(on);
});

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
    stage.setTheme(getTheme());
    car = await getCar();
    const app = startApp(stage, uiRoot, car);
    sleepApp = (asleep) => {
      stage.setPaused(asleep);
      app.setAsleep(asleep);
    };
    sleepApp(upright);
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
