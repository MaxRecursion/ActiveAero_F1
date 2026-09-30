/**
 * Dev page: Station 4's 3D side. The car (the real model by default, ?procedural=1 for the procedural
 * one) in the garage, driven by a BrakingScene made from the panel's controls.
 * Params: ?state=cold|hot|braking presets (default braking); the rest override the preset:
 *         &nose=mm  real dip at the front axle (the garage exaggerates it) &tail=mm  real rise at the rear
 *         &front=°C &rear=°C disc temperatures &see=0|1 see-through wheels
 *         &frontkn=kN &rearkn=kN axle loads &speed=kmh (300) sets the static loads and the road speed
 *         &explode=0|1 &off=1 (no scene: everything at neutral) &panel=0 (hide the controls)
 *         &cam=px,py,pz,tx,ty,tz &view=… (see harness)
 */
import { createHarness, num, params } from './harness';
import { aeroState } from '../src/physics/aero';
import { brakingState } from '../src/physics/braking';
import { buildCar } from '../src/scene/car/buildCar';
import { loadCar } from '../src/scene/car/loadCar';
import { createGarage, type BrakingScene } from '../src/app/garage';

type Preset = 'cold' | 'hot' | 'braking';

const car = params.get('procedural') === '1' ? buildCar() : await loadCar();
const stage = createHarness();
const garage = createGarage(stage, car);

const cam = params.get('cam')?.split(',').map(Number);
if (cam?.length === 6) void stage.controls.setLookAt(cam[0], cam[1], cam[2], cam[3], cam[4], cam[5], false);

const kmh = num('speed', 300);
const physics = brakingState(kmh);
// The station's "without braking" loads: what each axle carries before the transfer.
const frontStaticN = physics.frontLoadN - physics.transferN;
const rearStaticN = physics.rearLoadN + physics.transferN;
const requested = params.get('state');
const preset: Preset = requested === 'cold' || requested === 'hot' ? requested : 'braking';

const PRESETS: Record<Preset, BrakingScene> = {
  cold: {
    noseDropM: 0,
    tailRiseM: 0,
    frontDiscC: 80,
    rearDiscC: 80,
    frontLoadN: frontStaticN,
    rearLoadN: rearStaticN,
    frontStaticN,
    rearStaticN,
    seeThrough: true,
  },
  hot: {
    noseDropM: 0,
    tailRiseM: 0,
    frontDiscC: 900,
    rearDiscC: 600,
    frontLoadN: frontStaticN,
    rearLoadN: rearStaticN,
    frontStaticN,
    rearStaticN,
    seeThrough: true,
  },
  braking: {
    noseDropM: physics.noseDropM,
    tailRiseM: physics.tailRiseM,
    frontDiscC: 700,
    rearDiscC: 500,
    frontLoadN: physics.frontLoadN,
    rearLoadN: physics.rearLoadN,
    frontStaticN,
    rearStaticN,
    seeThrough: false,
  },
};

const scene: BrakingScene = { ...PRESETS[preset] };
if (params.has('nose')) scene.noseDropM = num('nose', 0) / 1000;
if (params.has('tail')) scene.tailRiseM = num('tail', 0) / 1000;
if (params.has('front')) scene.frontDiscC = num('front', scene.frontDiscC);
if (params.has('rear')) scene.rearDiscC = num('rear', scene.rearDiscC);
if (params.has('see')) scene.seeThrough = num('see', 0) === 1;
if (params.has('frontkn')) scene.frontLoadN = num('frontkn', 0) * 1000;
if (params.has('rearkn')) scene.rearLoadN = num('rearkn', 0) * 1000;

let enabled = params.get('off') !== '1';
garage.setExploded(num('explode', 0) === 1);
garage.setAirflow(false);
garage.setForceArrows(false);
const aero = aeroState(kmh);

// Shots show the settled state: run the eases to their end before the first frame.
const apply = () => garage.setBraking(enabled ? scene : null);
apply();
for (let i = 0; i < 12; i++) garage.update(0.5, kmh, aero);

stage.onFrame((dt) => {
  apply();
  garage.update(dt, kmh, aero);
});

if (params.get('panel') !== '0') {
  const panel = document.createElement('details');
  panel.open = innerWidth > 600;
  Object.assign(panel.style, {
    position: 'fixed',
    top: '8px',
    left: '8px',
    zIndex: '5',
    padding: '8px 10px',
    background: 'rgba(255,255,255,0.86)',
    borderRadius: '8px',
    font: '12px/1.4 var(--font-mono, monospace)',
    color: '#2a2c31',
  });
  panel.innerHTML = '<summary>Braking</summary>';
  const row = (label: string, control: HTMLElement, value?: HTMLElement) => {
    const r = document.createElement('label');
    Object.assign(r.style, { display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0' });
    const name = document.createElement('span');
    name.textContent = label;
    name.style.width = '96px';
    r.append(name, control);
    if (value) r.append(value);
    panel.append(r);
  };
  const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, unit: string) => {
    const input = document.createElement('input');
    Object.assign(input, { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()) });
    input.style.width = '120px';
    const out = document.createElement('span');
    out.style.width = '64px';
    const show = () => (out.textContent = `${Number(input.value).toFixed(step < 1 ? 1 : 0)} ${unit}`);
    input.oninput = () => {
      set(Number(input.value));
      show();
    };
    show();
    row(label, input, out);
  };
  const toggle = (label: string, get: () => boolean, set: (on: boolean) => void) => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = get();
    input.onchange = () => set(input.checked);
    row(label, input);
  };

  toggle('Braking on', () => enabled, (on) => (enabled = on));
  slider('Nose drop', 0, 15, 0.1, () => scene.noseDropM * 1000, (v) => (scene.noseDropM = v / 1000), 'mm');
  slider('Tail rise', 0, 15, 0.1, () => scene.tailRiseM * 1000, (v) => (scene.tailRiseM = v / 1000), 'mm');
  slider('Front disc', 20, 1000, 10, () => scene.frontDiscC, (v) => (scene.frontDiscC = v), '°C');
  slider('Rear disc', 20, 1000, 10, () => scene.rearDiscC, (v) => (scene.rearDiscC = v), '°C');
  toggle('See-through', () => scene.seeThrough, (on) => (scene.seeThrough = on));
  slider('Front load', 0, 40, 0.1, () => scene.frontLoadN / 1000, (v) => (scene.frontLoadN = v * 1000), 'kN');
  slider('Rear load', 0, 40, 0.1, () => scene.rearLoadN / 1000, (v) => (scene.rearLoadN = v * 1000), 'kN');
  toggle('Explode', () => garage.exploded, (on) => garage.setExploded(on));
  document.body.append(panel);
}
