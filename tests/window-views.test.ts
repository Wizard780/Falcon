// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { createView } from '../src/editor/editor';
import { schema } from '../src/editor/schema';

// jsdom lays nothing out, so the window stays at the first 80 paragraphs: everything past them is far
const p = (t: string, style = 'normal') => schema.nodes.paragraph.create({ style }, t ? schema.text(t) : undefined);
const cell = (t: string) => schema.nodes.table_cell.create(null, p(t));
const table = (t: string) => schema.nodes.table.create(null, schema.nodes.table_row.create(null, [cell(t), cell(`${t}b`)]));
let views: EditorView[] = [];
afterEach(() => { views.forEach((v) => v.destroy()); views = []; });
function view(doc: PMNode) {
  const mount = document.createElement('div');
  document.body.append(mount);
  const v = createView(mount, () => {}, doc);
  views.push(v);
  return v;
}
const paras = (n: number, at: (i: number) => PMNode = (i) => p(`para ${i}`)) => schema.nodes.doc.create(null, Array.from({ length: n }, (_, i) => at(i)));
const kid = (v: EditorView, i: number) => v.dom.children[i] as HTMLElement;
const isFar = (v: EditorView, i: number) => kid(v, i).classList.contains('f-far');
const caretIn = (v: EditorView, i: number) => {
  let pos = 0;
  for (let k = 0; k < i; k++) pos += v.state.doc.child(k).nodeSize;
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos + 1)));
};

describe('far paragraphs are empty placeholders', () => {
  it('builds the paragraphs near the screen, the caret\'s and the ends; the rest are empty, sized, and keep their tag and style', () => {
    const v = view(paras(200, (i) => p(`para ${i}`, i === 150 ? 'tag' : 'normal')));
    expect(kid(v, 10).textContent).toBe('para 10');
    expect(isFar(v, 10)).toBe(false);
    for (const i of [100, 150, 198]) {
      expect(isFar(v, i)).toBe(true);
      expect(kid(v, i).childNodes.length).toBe(0);
      expect(parseFloat(kid(v, i).style.height)).toBeGreaterThan(0);
    }
    expect(kid(v, 150).tagName).toBe('H4');
    expect(kid(v, 150).className).toContain('f-tag');
    // the browser's own moves to the doc's end need a built last paragraph
    expect(isFar(v, 199)).toBe(false);
    expect(kid(v, 199).textContent).toBe('para 199');
    expect(v.dom.children.length).toBe(200);
  });

  it('the caret\'s paragraph and the ones either side are built, and go back to placeholders when it leaves', () => {
    const v = view(paras(200));
    caretIn(v, 120);
    expect([119, 120, 121].map((i) => kid(v, i).textContent)).toEqual(['para 119', 'para 120', 'para 121']);
    expect(isFar(v, 118) || isFar(v, 122)).toBe(true);
    caretIn(v, 5);
    expect(isFar(v, 120)).toBe(true);
    expect(kid(v, 120).childNodes.length).toBe(0);
  });

  it('typing and Enter in a far paragraph the caret moved to show up', () => {
    const v = view(paras(200));
    caretIn(v, 140);
    v.dispatch(v.state.tr.insertText('X'));
    v.dispatch(v.state.tr.split(v.state.selection.from));
    expect([140, 141].map((i) => kid(v, i).textContent)).toEqual(['X', 'para 140']);
    expect(isFar(v, 141)).toBe(false);
    expect(v.dom.children.length).toBe(201);
  });

  it('a longer paragraph gets a taller placeholder', () => {
    const v = view(paras(200, (i) => p(i === 120 ? 'word '.repeat(400) : 'short')));
    expect(parseFloat(kid(v, 120).style.height)).toBeGreaterThan(5 * parseFloat(kid(v, 121).style.height));
  });

  it('table cells, and far paragraphs holding something other than text, are built as before', () => {
    const doc = paras(200, (i) => (i === 130 ? table('cell') : i === 140 ? schema.nodes.paragraph.create(null, [schema.text('a'), schema.nodes.hard_break.create(), schema.text('b')]) : p(`para ${i}`)));
    const v = view(doc);
    expect(kid(v, 130).textContent).toContain('cell');
    expect(v.dom.querySelectorAll('td .f-far, th .f-far').length).toBe(0);
    expect(isFar(v, 140)).toBe(false);
    expect(kid(v, 140).querySelector('br')).not.toBeNull();
    // sized like a placeholder: a new element has no remembered size, and content-visibility alone would make it 1.3em
    expect(parseFloat(kid(v, 140).style.height)).toBeGreaterThan(0);
    expect(kid(v, 140).style.boxSizing).toBe('border-box');
  });

  it('the document model and its clipboard text are the same whatever is drawn', () => {
    const doc = paras(200);
    const v = view(doc);
    expect(v.state.doc.eq(doc)).toBe(true);
    expect(v.state.doc.textBetween(0, v.state.doc.content.size, '\n\n')).toContain('para 150');
  });
});
