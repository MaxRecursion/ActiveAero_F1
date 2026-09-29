/**
 * Zone A — the speed control: a big readout, a native range input dressed as a precision scale
 * (graduations every 10 km/h, figures every 50) and preset buttons.
 *
 * The native <input type=range> stays the real control so keyboard, touch and screen readers get
 * platform behaviour for free; everything else here is decoration positioned on the same axis.
 * Presets and scale markers belong to the station and are swapped with it.
 */
import type { SpeedPreset } from './types';
import { attrSlot, h, styleSlot, textSlot } from './dom';
import { fmtKmh, spokenSpeed } from './format';

export interface SpeedControlOptions {
  minKmh: number;
  maxKmh: number;
  onInput(kmh: number): void;
}

/**
 * A labelled line on the scale. `tone` picks the colour (one meaning per colour), `row` stacks
 * labels of markers that sit close together, `side` is where the label hangs off the line, and
 * `band` shades the scale from this marker to the next marker (or to the end).
 */
export interface MarkerDef {
  tone: 'down' | 'drag' | 'drag-alt';
  row: 0 | 1;
  side: 'left' | 'right';
  band?: 'next' | 'end';
}

export interface ScaleMarker {
  set(kmh: number, label: string): void;
}

export interface SpeedControl {
  el: HTMLElement;
  /** Move the thumb without firing onInput. */
  setValue(kmh: number): void;
  setPresets(presets: SpeedPreset[]): void;
  /** Replace the scale markers; returns one handle per definition, in order. */
  setMarkers(defs: MarkerDef[]): ScaleMarker[];
  /** One line of fine print under the presets (empty hides it). */
  setNote(text: string): void;
  /** Per-frame: readout and current preset. */
  render(speedKmh: number): void;
  dispose(): void;
}

const MINOR_STEP = 10;
const MAJOR_STEP = 50;

export function createSpeedControl(opts: SpeedControlOptions): SpeedControl {
  const { minKmh, maxKmh } = opts;
  const span = maxKmh - minKmh;
  const pct = (kmh: number) => `${(((Math.min(maxKmh, Math.max(minKmh, kmh)) - minKmh) / span) * 100).toFixed(3)}%`;

  const num = h('span', { class: 'speed-num', text: '0' });
  const readout = h('div', { class: 'speed-readout', attrs: { 'aria-hidden': 'true' } }, [
    num,
    h('span', { class: 'speed-unit', text: 'km/h' }),
  ]);

  // Graduations are built once; they live on an axis inset by half the thumb width so a tick
  // sits exactly under the thumb's centre line at that speed.
  const axis = h('div', 'scale-axis');
  const markerLayer = h('div', 'scale-markers');
  for (let v = Math.ceil(minKmh / MINOR_STEP) * MINOR_STEP; v <= maxKmh; v += MINOR_STEP) {
    const major = v % MAJOR_STEP === 0;
    const tick = h('span', major ? 'scale-tick is-major' : 'scale-tick');
    tick.style.left = pct(v);
    axis.append(tick);
    if (major) {
      const label = h('span', { class: 'scale-fig', text: fmtKmh(v) });
      label.style.left = pct(v);
      axis.append(label);
    }
  }
  axis.prepend(markerLayer);

  const input = h('input', {
    class: 'scale-input',
    attrs: {
      type: 'range',
      min: String(minKmh),
      max: String(maxKmh),
      step: '1',
      'aria-label': 'Speed',
    },
  });
  const scale = h('div', 'scale', [axis, input]);

  // Presets read as places on a lap ("Hairpin"), with the speed underneath as the fine print.
  const presets = h('div', { class: 'presets', attrs: { role: 'group', 'aria-label': 'Speed presets' } });
  let presetButtons: { kmh: number; el: HTMLButtonElement; current: boolean }[] = [];
  const note = h('p', 'speed-law');

  const el = h('section', { class: 'zone zone-speed', attrs: { 'aria-label': 'Speed' } }, [
    h('h2', 'micro zone-title', [h('span', { class: 'idx', text: 'A' }), 'Speed']),
    readout,
    scale,
    presets,
    note,
  ]);

  const setNum = textSlot(num);
  const setFill = styleSlot(input, '--p');
  const setValueText = attrSlot(input, 'aria-valuetext');
  const setNoteText = textSlot(note);

  function syncInput(kmh: number) {
    setFill(((kmh - minKmh) / span).toFixed(4));
    setValueText(spokenSpeed(kmh));
  }

  function setValue(kmh: number) {
    const v = String(Math.round(kmh));
    if (input.value !== v) input.value = v;
    syncInput(Number(input.value));
  }

  const onInput = () => {
    const kmh = Number(input.value);
    syncInput(kmh);
    opts.onInput(kmh);
  };
  // One delegated listener survives every preset swap.
  const onPreset = (e: MouseEvent) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-kmh]');
    if (!btn) return;
    const kmh = Number(btn.dataset.kmh);
    setValue(kmh);
    opts.onInput(kmh);
  };
  input.addEventListener('input', onInput);
  presets.addEventListener('click', onPreset);
  setValue(minKmh);

  return {
    el,
    setValue,
    setPresets(list) {
      presetButtons = list.map((p) => {
        const b = h('button', { class: 'preset', attrs: { type: 'button' } }, [
          h('span', { class: 'preset-label', text: p.label }),
          h('span', 'preset-kmh', [fmtKmh(p.kmh), h('span', { class: 'preset-unit', text: ' km/h' })]),
        ]);
        b.dataset.kmh = String(p.kmh);
        return { kmh: p.kmh, el: b, current: false };
      });
      presets.replaceChildren(...presetButtons.map((b) => b.el));
    },
    setMarkers(defs) {
      scale.classList.toggle('has-two-rows', defs.some((d) => d.row === 1));
      markerLayer.replaceChildren();
      return defs.map((def, i) => {
        const label = h('span', 'scale-marker-label');
        const line = h('span', `scale-marker scale-marker--${def.tone} row-${def.row} hang-${def.side}`, [label]);
        line.style.left = `var(--m${i}, 100%)`;
        if (def.band) {
          const band = h('span', `scale-band scale-band--${def.tone}`);
          band.style.left = `var(--m${i}, 100%)`;
          band.style.right = def.band === 'end' ? '0' : `calc(100% - var(--m${i + 1}, 100%))`;
          markerLayer.append(band);
        }
        markerLayer.append(line);
        const setPos = styleSlot(axis, `--m${i}`);
        const setLabel = textSlot(label);
        return {
          set(kmh: number, text: string) {
            setPos(pct(kmh));
            setLabel(text);
          },
        };
      });
    },
    setNote(text) {
      setNoteText(text);
      note.hidden = !text;
    },
    render(speedKmh) {
      setNum(fmtKmh(speedKmh));
      const rounded = Math.round(speedKmh);
      for (const b of presetButtons) {
        const current = b.kmh === rounded;
        if (current !== b.current) {
          b.current = current;
          b.el.classList.toggle('is-current', current);
          if (current) b.el.setAttribute('aria-current', 'true');
          else b.el.removeAttribute('aria-current');
        }
      }
    },
    dispose() {
      input.removeEventListener('input', onInput);
      presets.removeEventListener('click', onPreset);
    },
  };
}
