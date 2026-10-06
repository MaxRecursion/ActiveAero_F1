/**
 * The car can be turned and zoomed — say so once. A small dark pill over the middle of the free area
 * with a moving picture of the gesture: two fingers pinching apart on a touch screen, a mouse wheel on a
 * computer, and the words for it. It appears shortly after the car is on screen (on a phone, once the
 * phone is turned sideways), never blocks a touch (pointer events pass through it), and goes for good
 * the first time the visitor touches, drags or scrolls the 3D view — or on its own after a while.
 *
 * Hidden from screen readers: the gestures belong to the 3D view, which has its own label.
 */
import type { Insets } from '../scene/stage';
import { h, s } from './dom';
import { watchPortraitPhone } from './portraitPhone';

export interface GestureHint {
  el: HTMLElement;
  /** The free area (pixels covered by panels on each side); the hint centres itself in what is left. */
  setArea(insets: Insets): void;
  dispose(): void;
}

/** After the car is on screen; then how long it stays if nobody touches the car. */
const SHOW_AFTER_MS = 1200;
const SHOW_FOR_MS = 9000;

function pinchIcon(): SVGSVGElement {
  return s('svg', { class: 'gh-icon gh-icon--touch', viewBox: '0 0 64 64', 'aria-hidden': 'true', focusable: 'false' }, [
    s('path', { class: 'gh-track', d: 'M 14 50 L 50 14' }),
    s('path', { class: 'gh-tip', d: 'M 14 42 L 14 50 L 22 50' }),
    s('path', { class: 'gh-tip', d: 'M 42 14 L 50 14 L 50 22' }),
    s('circle', { class: 'gh-finger gh-finger--a', cx: 27, cy: 37, r: 7 }),
    s('circle', { class: 'gh-finger gh-finger--b', cx: 37, cy: 27, r: 7 }),
  ]);
}

function mouseIcon(): SVGSVGElement {
  return s('svg', { class: 'gh-icon gh-icon--mouse', viewBox: '0 0 64 64', 'aria-hidden': 'true', focusable: 'false' }, [
    s('rect', { class: 'gh-mouse', x: 21, y: 10, width: 22, height: 38, rx: 11 }),
    s('path', { class: 'gh-wheel', d: 'M 32 17 L 32 24' }),
    s('path', { class: 'gh-track', d: 'M 10 56 Q 32 62 54 56' }),
  ]);
}

export function createGestureHint(): GestureHint {
  const el = h('div', { class: 'gesture-hint', attrs: { 'aria-hidden': 'true' } }, [
    h('div', 'gh-card', [
      pinchIcon(),
      mouseIcon(),
      h('span', 'gh-text', [
        h('span', { class: 'gh-touch', text: 'Pinch to zoom · drag to turn the car' }),
        h('span', { class: 'gh-mouse-text', text: 'Scroll to zoom · drag to turn the car' }),
      ]),
    ]),
  ]);

  let done = false;
  let upright = false;
  let showTimer = 0;
  let hideTimer = 0;

  const clear = () => {
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
  };
  function hide(forGood: boolean) {
    clear();
    el.classList.remove('is-shown');
    if (forGood) done = true;
  }
  function schedule() {
    clear();
    if (done || upright) return;
    showTimer = window.setTimeout(() => {
      el.classList.add('is-shown');
      hideTimer = window.setTimeout(() => hide(true), SHOW_FOR_MS);
    }, SHOW_AFTER_MS);
  }

  // The first touch, drag or scroll on the 3D view: they know.
  const onUse = (e: Event) => {
    if (done) return;
    if (e.target instanceof Element && e.target.closest('#stage')) hide(true);
  };
  const opts = { capture: true, passive: true } as const;
  document.addEventListener('pointerdown', onUse, opts);
  document.addEventListener('wheel', onUse, opts);

  // On a phone held upright the "turn your phone" screen is up: wait for it to go.
  const stopWatching = watchPortraitPhone((on) => {
    upright = on;
    if (on) hide(false);
    else schedule();
  });

  return {
    el,
    setArea(insets) {
      el.style.top = `${insets.top}px`;
      el.style.right = `${insets.right}px`;
      el.style.bottom = `${insets.bottom}px`;
      el.style.left = `${insets.left}px`;
    },
    dispose() {
      clear();
      stopWatching();
      document.removeEventListener('pointerdown', onUse, opts);
      document.removeEventListener('wheel', onUse, opts);
      el.remove();
    },
  };
}
