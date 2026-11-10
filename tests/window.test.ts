import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { joinBackward, splitBlockKeepMarks } from 'prosemirror-commands';
import { DecorationSet } from 'prosemirror-view';
import { schema } from '../src/editor/schema';
import { windowKey, windowPlugin } from '../src/editor/window';

const p = (t: string) => schema.nodes.paragraph.create({ style: 'normal', indent: 0 }, t ? schema.text(t) : undefined);
const start = () => EditorState.create({ doc: schema.nodes.doc.create(null, [p('aaa'), p('bbb'), p('ccc')]), plugins: [windowPlugin] });
/** Which top-level paragraphs carry f-near: the ones the off-screen skip still draws. */
const near = (s: EditorState) => {
  const decos = windowKey.getState(s)!.decos;
  const out: string[] = [];
  let pos = 0;
  s.doc.forEach((n) => {
    const on = decos.find(pos, pos + n.nodeSize).some((d) => d.from === pos && d.to === pos + n.nodeSize);
    out.push(`${n.textContent || '_'}${on ? '' : ':SKIPPED'}`);
    pos += n.nodeSize;
  });
  return out.join(' ');
};
const run = (s: EditorState, at: number, cmd: typeof splitBlockKeepMarks) => {
  s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, at)));
  let out = s;
  cmd(s, (tr) => { out = s.apply(tr); });
  return out;
};

describe('near-screen window', () => {
  it('Enter at the end of a paragraph keeps it and the new line drawn', () => {
    expect(near(run(start(), 9, splitBlockKeepMarks))).toBe('aaa bbb _ ccc');
  });
  it('Enter mid-paragraph keeps both halves drawn', () => {
    expect(near(run(start(), 7, splitBlockKeepMarks))).toBe('aaa b bb ccc');
  });
  it('Backspace joining two paragraphs keeps the joined one drawn', () => {
    expect(near(run(start(), 6, joinBackward))).toBe('aaabbb ccc');
  });
  it('a paste over a paragraph boundary keeps the result drawn', () => {
    const s = start();
    expect(near(s.apply(s.tr.insertText('X', 4, 7)))).toBe('aaaXbb ccc');
  });
  it('random edits leave exactly one mark on each paragraph in range', () => {
    let seed = 7;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    let s = EditorState.create({ doc: schema.nodes.doc.create(null, Array.from({ length: 120 }, (_, i) => p(`p${i}`))), plugins: [windowPlugin] });
    s = s.apply(s.tr.setMeta(windowKey, { from: 0, to: 999 }));
    for (let k = 0; k < 300; k++) {
      const tr = s.tr;
      for (let j = 0, steps = 1 + rand(3); j < steps; j++) {
        // positions inside paragraphs' text, the way the caret and selections land
        const inText = (pos: number) => { const $p = tr.doc.resolve(pos); return $p.parent.isTextblock ? pos : $p.pos + 1; };
        const size = tr.doc.content.size, a = inText(1 + rand(size - 2)), b = inText(Math.min(size - 1, a + rand(k % 50 === 0 ? size : 12)));
        const op = rand(4);
        if (op === 0) tr.split(a);
        else if (op === 1 && a < b) tr.deleteRange(a, b);
        else tr.insertText('x', a, op === 2 ? a : Math.max(a, b));
      }
      s = s.apply(tr);
      const decos = windowKey.getState(s)!.decos.find();
      let pos = 0;
      const want: string[] = [];
      s.doc.forEach((n) => { want.push(`${pos}-${pos + n.nodeSize}`); pos += n.nodeSize; });
      expect(decos.map((d) => `${d.from}-${d.to}`).sort()).toEqual(want.sort());
    }
  });
  it('the near marks answer ProseMirror the way a stock DecorationSet of them does', () => {
    // topSet skips DecorationSet's scan for each child's own decorations; the answers must be the same
    let s = EditorState.create({ doc: schema.nodes.doc.create(null, Array.from({ length: 120 }, (_, i) => p(`p${i}`))), plugins: [windowPlugin] });
    s = s.apply(s.tr.setMeta(windowKey, { from: 10, to: 60 }));
    s = s.apply(s.tr.insertText('x', 200).split(300).delete(400, 420));
    const fast = windowKey.getState(s)!.decos, stock = DecorationSet.create(s.doc, fast.find());
    const str = (set: DecorationSet) => set.find().map((d) => `${d.from}-${d.to}:${JSON.stringify((d as unknown as { type: { attrs: unknown } }).type.attrs)}`);
    expect(str(fast)).toEqual(str(stock));
    expect((fast as unknown as { eq(o: DecorationSet): boolean }).eq(stock)).toBe(true);
    s.doc.forEach((n, off) => { expect(fast.forChild(off, n)).toBe(stock.forChild(off, n)); });
  });
  it('an edit outside the near range leaves those paragraphs skipped', () => {
    let s = start();
    s = s.apply(s.tr.setMeta(windowKey, { from: 0, to: 1 }));
    expect(near(run(s, 9, splitBlockKeepMarks))).toBe('aaa bbb:SKIPPED _:SKIPPED ccc:SKIPPED');
  });
});
