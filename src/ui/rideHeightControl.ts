/**
 * Station 6, zone A — the static ride heights, under the speed slider: two native range inputs
 * (front and rear, 1 mm steps) and the named set-ups as chips.
 *
 * Static means "in the garage": the heights the car is set to at rest. Speed then squashes the
 * car on its springs, which the readouts and the aero map show. The native inputs are the
 * keyboard and screen-reader path for the whole station (the map's draggable dot is a shortcut
 * for pointer users). render() follows the view without firing, so a preset, a map drag and the
 * sliders always agree.
 */
import { RIDE_PRESETS, SETUP_RANGE } from '../physics/aeromap';
import type { RideHeights, Station6View } from './types';
import { attrSlot, h, styleSlot, textSlot } from './dom';
import { fmtMm } from './format';

export interface RideHeightControl {
  el: HTMLElement;
  render(view: Station6View): void;
  dispose(): void;
}

type Axle = 'front' | 'rear';
const RANGE: Record<Axle, [number, number]> = { front: SETUP_RANGE.frontMm, rear: SETUP_RANGE.rearMm };
const spokenMm = (mm: number) => `${mm} ${mm === 1 ? 'millimetre' : 'millimetres'}`;

export function createRideHeightControl(onInput: (setup: RideHeights) => void): RideHeightControl {
  const slider = (axle: Axle, name: string) => {
    const [min, max] = RANGE[axle];
    const id = `rh-${axle}-input`;
    const input = h('input', {
      class: 'rh-input',
      attrs: { id, type: 'range', min: String(min), max: String(max), step: '1', 'aria-label': `${name} ride height, static` },
    });
    const value = h('span', 'rh-num');
    const el = h('div', 'rh-row', [
      h('label', { class: 'rh-name', text: name, attrs: { for: id } }),
      input,
      h('span', 'rh-val', [value, h('span', { class: 'rh-unit', text: ' mm' })]),
    ]);
    const setText = textSlot(value);
    const setSpoken = attrSlot(input, 'aria-valuetext');
    const setFill = styleSlot(input, '--p');
    return {
      el,
      input,
      /** Reflect a value (from the user or the view) in the readout, fill and spoken text. */
      show(mm: number) {
        setText(fmtMm(mm));
        setSpoken(spokenMm(mm));
        setFill(((mm - min) / (max - min)).toFixed(4));
      },
      set(mm: number) {
        const v = String(Math.round(mm));
        if (input.value !== v) input.value = v;
        this.show(Number(input.value));
      },
    };
  };
  const front = slider('front', 'Front');
  const rear = slider('rear', 'Rear');

  const chips = RIDE_PRESETS.map((p) => {
    const b = h('button', { class: 'rh-chip', text: p.label, attrs: { type: 'button', 'aria-pressed': 'false' } });
    b.dataset.preset = p.id;
    return { preset: p, el: b, pressed: false };
  });
  const presetRow = h('div', { class: 'rh-presets', attrs: { role: 'group', 'aria-label': 'Ride-height set-ups' } }, chips.map((c) => c.el));

  const el = h('div', { class: 'rh-control', attrs: { role: 'group', 'aria-labelledby': 'rh-title' } }, [
    h('div', 'rh-head', [
      h('span', { class: 'micro rh-title', text: 'Static ride height', attrs: { id: 'rh-title' } }),
      h('span', { class: 'rh-aside', text: 'parked, floor to road' }),
    ]),
    front.el,
    rear.el,
    presetRow,
  ]);

  function syncChips(f: number, r: number) {
    for (const c of chips) {
      const on = c.preset.frontMm === f && c.preset.rearMm === r;
      if (on === c.pressed) continue;
      c.pressed = on;
      c.el.setAttribute('aria-pressed', String(on));
    }
  }

  const current = (): RideHeights => ({ frontMm: Number(front.input.value), rearMm: Number(rear.input.value) });
  const onSlide = () => {
    const setup = current();
    front.show(setup.frontMm);
    rear.show(setup.rearMm);
    syncChips(setup.frontMm, setup.rearMm);
    onInput(setup);
  };
  const onChip = (e: MouseEvent) => {
    const id = (e.target as Element).closest<HTMLElement>('[data-preset]')?.dataset.preset;
    const p = RIDE_PRESETS.find((x) => x.id === id);
    if (!p) return;
    front.set(p.frontMm);
    rear.set(p.rearMm);
    syncChips(p.frontMm, p.rearMm);
    onInput({ frontMm: p.frontMm, rearMm: p.rearMm });
  };
  front.input.addEventListener('input', onSlide);
  rear.input.addEventListener('input', onSlide);
  presetRow.addEventListener('click', onChip);
  front.set(RIDE_PRESETS[0].frontMm);
  rear.set(RIDE_PRESETS[0].rearMm);
  syncChips(RIDE_PRESETS[0].frontMm, RIDE_PRESETS[0].rearMm);

  return {
    el,
    render(v) {
      front.set(v.setup.frontMm);
      rear.set(v.setup.rearMm);
      syncChips(Math.round(v.setup.frontMm), Math.round(v.setup.rearMm));
    },
    dispose() {
      front.input.removeEventListener('input', onSlide);
      rear.input.removeEventListener('input', onSlide);
      presetRow.removeEventListener('click', onChip);
    },
  };
}
