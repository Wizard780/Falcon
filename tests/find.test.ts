import { describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { undo } from 'prosemirror-history';
import { schema, type ParaStyle } from '../src/editor/schema';
import { createState } from '../src/editor/editor';
import { findInfo, findKey, replaceAll, replaceOne, setGrouped, setQuery, step } from '../src/editor/find';
import { toggleRead } from '../src/editor/read';
import { falconKeys as K } from '../src/editor/keymap';

function viewOf(paras: [ParaStyle, string, boolean?][]) {
  const doc = schema.node('doc', null, paras.map(([style, text, cite]) => schema.node('paragraph', { style }, [schema.text(text, cite ? [schema.marks.cite.create()] : [])])));
  const view = new EditorView(document.createElement('div'), { state: createState(doc) });
  return view;
}
/** The paragraph text holding each match, in the order Enter visits them. */
const visits = (v: EditorView) => {
  const f = findInfo(v.state)!;
  return f.order.map((k) => v.state.doc.resolve(f.matches[k].from).parent.textContent);
};

const PARAS: [ParaStyle, string, boolean?][] = [
  ['normal', 'body nuclear war'], ['tag', 'Nuclear war tag'], ['normal', 'Smith 24 nuclear', true], ['block', 'Nuclear block'], ['undertag', 'under “nuclear”'], ['analytic', 'nuclear analytic'],
];

describe('find', () => {
  it('groups matches by type by default, or orders them by position', () => {
    const v = viewOf(PARAS);
    setQuery(v, 'NUCLEAR', true);
    expect(visits(v)).toEqual(['Nuclear block', 'Nuclear war tag', 'nuclear analytic', 'under “nuclear”', 'Smith 24 nuclear', 'body nuclear war']);
    setGrouped(v, false);
    expect(visits(v)).toEqual(PARAS.map((p) => p[1]));
  });

  it('ignores case and curly quotes', () => {
    const v = viewOf(PARAS);
    setQuery(v, '"nuclear"');
    expect(findInfo(v.state)!.matches).toHaveLength(1);
  });

  it('replaces one match and moves to the next, keeping its formatting', () => {
    const v = viewOf(PARAS);
    setQuery(v, 'nuclear', false);
    step(v, 1); step(v, 1); // the cite line
    replaceOne(v, 'atomic');
    expect(v.state.doc.child(2).textContent).toBe('Smith 24 atomic');
    expect(v.state.doc.child(2).lastChild!.marks.map((m) => m.type.name)).toEqual(['cite']);
    const f = findInfo(v.state)!;
    expect(v.state.doc.resolve(f.matches[f.order[f.index]].from).parent.textContent).toBe('Nuclear block');
  });

  it('replacing with text that still matches moves on instead of looping', () => {
    const v = viewOf([['normal', 'a a']]);
    setQuery(v, 'a', false);
    replaceOne(v, 'aa');
    expect(v.state.doc.textContent).toBe('aa a');
    const f = findInfo(v.state)!;
    expect(f.matches[f.order[f.index]].from).toBe(4);
  });

  it('replacing with nothing goes on to the next match of the same kind', () => {
    const v = viewOf([['tag', 'foo one'], ['tag', 'foo two'], ['tag', 'foo three'], ['normal', 'Smith foo', true]]);
    setQuery(v, 'foo', true);
    replaceOne(v, '');
    const f = findInfo(v.state)!;
    expect(v.state.doc.resolve(f.matches[f.order[f.index]].from).parent.textContent).toBe('foo two');
  });

  it('replace all is one undo step', () => {
    const v = viewOf(PARAS);
    setQuery(v, 'nuclear');
    expect(replaceAll(v, 'atomic')).toBe(6);
    expect(v.state.doc.textContent).not.toMatch(/nuclear/i);
    undo(v.state, v.dispatch);
    expect(v.state.doc.textContent).toBe(PARAS.map((p) => p[1]).join(''));
  });

  it('a match covers its own text after letters that lowercase to two characters', () => {
    const v = viewOf([['normal', 'İİİ foo bar İ']]);
    setQuery(v, 'foo');
    const m = findInfo(v.state)!.matches[0];
    expect(v.state.doc.textBetween(m.from, m.to)).toBe('foo');
    setQuery(v, 'bar İ');
    const n = findInfo(v.state)!.matches[0];
    expect(v.state.doc.textBetween(n.from, n.to)).toBe('bar İ');
  });

  it('replace and replace all change nothing in read mode', () => {
    const v = viewOf(PARAS);
    toggleRead(v.state, v.dispatch);
    setQuery(v, 'nuclear');
    replaceOne(v, 'atomic');
    expect(replaceAll(v, 'atomic')).toBe(0);
    expect(v.state.doc.textContent).toBe(PARAS.map((p) => p[1]).join(''));
  });

  it('scrolls the page to a far match while the caret stays in the find box', () => {
    // jsdom has no layout: each paragraph is 20px tall, the page shows 800px
    const sc = document.body.appendChild(document.createElement('div'));
    sc.className = 'f-scroll';
    let top = 0;
    Object.defineProperty(sc, 'scrollTop', { get: () => top, set: (y: number) => { top = Math.max(0, y); } });
    sc.getBoundingClientRect = () => ({ top: 0, bottom: 800, height: 800 }) as DOMRect;
    const doc = schema.node('doc', null, Array.from({ length: 2000 }, (_, i) => schema.node('paragraph', null, [schema.text(i === 1500 ? 'needle' : `para ${i}`)])));
    const v = new EditorView(sc, { state: createState(doc) });
    v.coordsAtPos = (pos) => { const y = v.state.doc.resolve(pos).index(0) * 20 - top; return { top: y, bottom: y + 20, left: 0, right: 0 }; };
    const input = document.body.appendChild(document.createElement('input'));
    input.focus();
    setQuery(v, 'needle');
    const r = v.coordsAtPos(v.state.selection.from);
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.bottom).toBeLessThanOrEqual(800);
    v.destroy(); sc.remove(); input.remove();
  });
});

describe('find while editing', () => {
  /** What the page shows: the line of every highlight, which highlight is the current one, the count, and the order Enter visits. */
  const shown = (v: EditorView) => {
    const f = findInfo(v.state)!;
    const runs = [...v.dom.querySelectorAll('.f-find')];
    return {
      lines: runs.map((e) => e.closest('p, h1, h2, h3, h4')?.textContent),
      cur: runs.flatMap((e, i) => (e.classList.contains('f-find-cur') ? [i] : [])),
      count: `${f.index + 1}/${f.matches.length}`,
      visits: visits(v),
    };
  };
  /** The same document searched afresh from the same starting point. */
  const fresh = (v: EditorView) => {
    const f = findInfo(v.state)!;
    const w = new EditorView(document.createElement('div'), { state: createState(v.state.doc) });
    w.dispatch(w.state.tr.setMeta(findKey, { query: f.query, index: f.index, anchor: f.anchor, grouped: f.grouped }));
    return shown(w);
  };
  const textAt = (v: EditorView, text: string) => {
    let pos = -1;
    v.state.doc.descendants((n, p) => { if (pos < 0 && n.isText && n.text!.includes(text)) pos = p + n.text!.indexOf(text); return pos < 0; });
    return pos;
  };

  it('keeps the highlights, count and order right through typing, deleting, splitting, joining, restyling, moving and undo', () => {
    const v = viewOf([['tag', 'the tag'], ['normal', 'the cat'], ['normal', 'the dog and the'], ['tag', 'next the'], ['normal', 'other words']]);
    setQuery(v, 'the');
    step(v, 1);
    expect(shown(v)).toEqual(fresh(v));
    const edits: [string, () => void][] = [
      ['type a match', () => v.dispatch(v.state.tr.insertText('the ', textAt(v, 'words')))],
      ['delete a match', () => v.dispatch(v.state.tr.delete(textAt(v, 'the cat'), textAt(v, 'the cat') + 4))],
      ['split a line', () => v.dispatch(v.state.tr.split(textAt(v, 'and')))],
      ['join two lines', () => { const p = textAt(v, 'and'); v.dispatch(v.state.tr.join(p - 1)); }],
      ['make a cite line', () => { const p = textAt(v, 'cat'); v.dispatch(v.state.tr.addMark(p, p + 3, schema.marks.cite.create())); }],
      ['step on', () => step(v, 1)],
      ['move a card down', () => { v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, textAt(v, 'cat')))); K['Mod-Alt-ArrowDown'](v.state, v.dispatch); expect(v.state.doc.firstChild!.textContent).toBe('next the'); }],
      ['undo the move', () => undo(v.state, v.dispatch)],
    ];
    for (const [what, edit] of edits) {
      edit();
      expect({ what, ...shown(v) }).toEqual({ what, ...fresh(v) });
    }
  });

  it('typing and stepping through matches stay fast in a long document', () => {
    const BODY = 'The rapid expansion of the grid has pushed the utilities to their limits and the rest of the text here. ';
    const paras: [ParaStyle, string][] = Array.from({ length: 2000 }, (_, i) => (i % 10 ? ['normal', BODY.repeat(3)] : ['tag', `Tag ${i}`]));
    const v = viewOf(paras);
    setQuery(v, 'the');
    const ms = (f: () => void) => { const t = performance.now(); for (let i = 0; i < 10; i++) f(); return (performance.now() - t) / 10; };
    const typing = ms(() => v.dispatch(v.state.tr.insertText('x', 3)));
    const stepping = ms(() => step(v, 1));
    expect(findInfo(v.state)!.matches).toHaveLength(1800 * 18);
    expect(typing).toBeLessThan(30);
    expect(stepping).toBeLessThan(30);
  });
});
