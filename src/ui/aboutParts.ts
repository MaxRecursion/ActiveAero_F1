/**
 * Building blocks shared by the "How it works" groups: sections, paragraphs with coloured key words,
 * formula rows, the assumptions table and its source tags.
 */
import { h } from './dom';

export type Kind = 'estimate' | 'reg' | 'phys' | 'result';

export function section(n: string, title: string, body: Node[]): HTMLElement {
  return h('section', 'about-sec', [
    h('h3', 'about-h', [h('span', { class: 'idx', text: n }), title]),
    ...body,
  ]);
}

export const p = (text: string, cls = '') => h('p', { class: cls, text });

/** A run of text with coloured key words, e.g. "blue arrows" in the downforce colour. */
export function para(parts: (string | [string, string])[]): HTMLElement {
  return h('p', {}, parts.map((x) => (typeof x === 'string' ? x : h('span', { class: `tone-${x[0]}`, text: x[1] }))));
}

export function tag(kind: Kind, text: string): HTMLElement {
  return h('span', { class: `src-tag src-tag--${kind}`, text });
}

export const formula = (lhs: string, rhs: string, note: string) =>
  h('div', 'formula-row', [h('span', { class: 'formula', text: `${lhs} = ${rhs}` }), h('span', { class: 'formula-note', text: note })]);

export const row = (quantity: string, value: string, source: HTMLElement) =>
  h('tr', {}, [h('th', { text: quantity, attrs: { scope: 'row' } }), h('td', { class: 'num', text: value }), h('td', {}, [source])]);

export function assumptionsTable(rows: HTMLElement[]): HTMLElement {
  return h('div', 'table-wrap', [
    h('table', 'assumptions', [
      h('thead', {}, [
        h('tr', {}, [
          h('th', { text: 'Quantity', attrs: { scope: 'col' } }),
          h('th', { text: 'Value', attrs: { scope: 'col' } }),
          h('th', { text: 'Source', attrs: { scope: 'col' } }),
        ]),
      ]),
      h('tbody', {}, rows),
    ]),
  ]);
}

export const list = (items: string[]) => h('ul', 'about-list', items.map((text) => h('li', { text })));
export const pct = (x: number) => Math.round(x * 100);

/** A list item with a source link at its end. */
export const sourced = (text: string, src: { label: string; url: string }) =>
  h('li', {}, [`${text} `, h('a', { class: 'about-cite', text: src.label, attrs: { href: src.url, target: '_blank', rel: 'noopener' } })]);
