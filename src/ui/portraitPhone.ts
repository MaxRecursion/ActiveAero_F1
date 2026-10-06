/**
 * A phone held upright: touch with no hover, narrower than any tablet, in portrait. The explainer
 * asks it to turn sideways (the "turn your phone" screen, src/styles/rotate.css, which uses the same
 * query), and pauses behind that screen. A narrow desktop window or a tablet in portrait is not one.
 */
export const PORTRAIT_PHONE_QUERY = '(orientation: portrait) and (max-width: 599.98px) and (hover: none) and (pointer: coarse)';

/** Calls `onChange` now and whenever the phone turns. Returns a function that stops watching. */
export function watchPortraitPhone(onChange: (upright: boolean) => void): () => void {
  const mq = window.matchMedia(PORTRAIT_PHONE_QUERY);
  const fire = () => onChange(mq.matches);
  mq.addEventListener('change', fire);
  fire();
  return () => mq.removeEventListener('change', fire);
}
