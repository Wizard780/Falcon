import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from '../src/editor/schema';

const M = schema.marks;
const boxes = (kids: ReturnType<typeof schema.text>[]) => {
  const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create(null, kids)]);
  const view = new EditorView(document.createElement('div'), { state: EditorState.create({ doc }) });
  return view.dom.querySelectorAll('.f-emphasis').length;
};

describe('a box with highlight on only part of it', () => {
  const em = M.emphasis.create();
  it('stays one box across a highlight edge', () => {
    expect(boxes([schema.text('food', [em, M.highlight.create({ color: 'cyan' })]), schema.text(' system', [em])])).toBe(1);
  });
  it('stays one box across a highlight color change', () => {
    expect(boxes([schema.text('food', [em, M.highlight.create({ color: 'cyan' })]), schema.text(' system', [em, M.highlight.create({ color: 'yellow' })])])).toBe(1);
  });
  it('stays one box across a shading edge', () => {
    expect(boxes([schema.text('food', [em, M.shading.create()]), schema.text(' system', [em])])).toBe(1);
  });
});
