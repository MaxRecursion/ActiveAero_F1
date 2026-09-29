import './styles/tokens.css';
import { startApp } from './app/app';
import { createStage } from './scene/stage';

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

if (!hasWebGL2()) {
  boot.textContent = 'This explainer needs WebGL 2, which this browser or device has turned off.';
} else {
  const stage = createStage({ mount });
  startApp(stage, uiRoot);
  let frames = 0;
  const off = stage.onFrame(() => {
    if (++frames < 3) return;
    boot.classList.add('gone');
    window.__ready = true;
    off();
  });
  stage.start();
}
