import { describe, expect, it } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { undo } from 'prosemirror-history';
import { schema, type ParaStyle } from '../src/editor/schema';
import { createState } from '../src/editor/editor';
import { findInfo, replaceAll, replaceOne, setGrouped, setQuery, step } from '../src/editor/find';

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

  it('replace all is one undo step', () => {
    const v = viewOf(PARAS);
    setQuery(v, 'nuclear');
    expect(replaceAll(v, 'atomic')).toBe(6);
    expect(v.state.doc.textContent).not.toMatch(/nuclear/i);
    undo(v.state, v.dispatch);
    expect(v.state.doc.textContent).toBe(PARAS.map((p) => p[1]).join(''));
  });
});
