/**
 * Tiny DOM helpers. The UI is rebuilt from `render()` every frame, so every dynamic value goes
 * through a cached "slot" that writes to the DOM only when the displayed string changes.
 */

type Child = Node | string | null | undefined | false;

export interface ElProps {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
}

/** Create an HTML element with a class, text and attributes in one call. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps | string = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const p: ElProps = typeof props === 'string' ? { class: props } : props;
  if (p.class) el.className = p.class;
  if (p.text !== undefined) el.textContent = p.text;
  if (p.attrs) for (const [k, v] of Object.entries(p.attrs)) el.setAttribute(k, v);
  for (const c of children) if (c) el.append(c);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an SVG element (attributes are numbers or strings). */
export function s<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  children: Child[] = [],
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) if (c) el.append(c);
  return el;
}

/** Returns a setter that writes `textContent` only when the string changes. */
export function textSlot(el: Element): (value: string) => void {
  let last: string | undefined;
  return (value) => {
    if (value === last) return;
    last = value;
    el.textContent = value;
  };
}

/** Returns a setter that writes one attribute only when its value changes. */
export function attrSlot(el: Element, name: string): (value: string) => void {
  let last: string | null = el.getAttribute(name);
  return (value) => {
    if (value === last) return;
    last = value;
    el.setAttribute(name, value);
  };
}

/** Returns a setter for one inline style property (custom properties included), cached. */
export function styleSlot(el: HTMLElement | SVGElement, prop: string): (value: string) => void {
  let last: string | undefined;
  return (value) => {
    if (value === last) return;
    last = value;
    el.style.setProperty(prop, value);
  };
}
