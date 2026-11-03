import { describe, expect, it } from 'vitest';
import type { EditorState } from 'prosemirror-state';
import { cardEdits } from '../src/editor/edit-log';
import { applyMerge, mergeFromDisk } from '../src/editor/disk-merge';
import { createState } from '../src/editor/editor';
import { falconKeys as K } from '../src/editor/keymap';
import { schema, type ParaStyle } from '../src/editor/schema';
import { caret, run, select } from './helpers';

type P = [ParaStyle, string, string?, boolean?];
const build = (paras: P[]) => createState(schema.node('doc', null, paras.map(([style, text, card, pending]) => schema.node('paragraph', { style, card: card ?? null, pending: !!pending }, text ? [schema.text(text)] : []))));
const FILE: P[] = [['block', 'AT: Deterrence', 'blk'], ['tag', 'Card A', 'aa'], ['normal', 'Smith 24'], ['normal', 'a body text here'], ['tag', 'Card B', 'bb'], ['normal', 'Jones 25'], ['normal', 'b body'], ['tag', 'Claude card', 'cc', true], ['normal', 'c body'], ['analytic', 'An analytic', 'an']];
const type = (s: EditorState, text: string) => s.apply(s.tr.insertText(text));
const summary = (s0: EditorState, s: EditorState) => cardEdits(s0.doc, s.doc).map((e) => `${e.id}:${e.changes.join('+')}`);

describe('the record of the user\'s edits, for Claude', () => {
  it('no edits, no record', () => {
    const s = build(FILE);
    expect(cardEdits(s.doc, s.doc)).toEqual([]);
  });

  it('names what changed: tag, cite, body text, highlight, underline', () => {
    const s0 = build(FILE);
    let s = type(caret(s0, 'Card A', 6), ' retagged');
    s = type(caret(s, 'Jones 25', 8), ', Professor');
    s = run(select(s, 'body text'), K.F11);
    s = run(select(s, 'b body'), K.F9);
    expect(summary(s0, s)).toEqual(['aa:tag+highlight', 'bb:cite+underline']);
  });

  it('carries the card before and after, with marks, and where it is', () => {
    const s0 = build(FILE);
    const s = run(select(s0, 'body text'), K.F11);
    const [e] = cardEdits(s0.doc, s.doc);
    expect(e).toMatchObject({ id: 'aa', style: 'tag', title: 'Card A', changes: ['highlight'], position: { after: 'blk', under: 'blk' } });
    expect(e.before![2]).toEqual({ style: 'normal', runs: [{ text: 'a body text here', marks: [] }] });
    expect(e.after![2]).toEqual({ style: 'normal', runs: [{ text: 'a ', marks: [] }, { text: 'body text', marks: ['highlight:yellow'] }, { text: ' here', marks: [] }] });
  });

  it('a card moved down is "moved", not every card it passed', () => {
    const s0 = build(FILE);
    const s = run(run(caret(s0, 'Card A'), K['Mod-Alt-ArrowDown']), K['Mod-Alt-ArrowDown']);
    expect(s.doc.child(6).textContent).toBe('Card A'); // below Card B and the Claude card
    expect(summary(s0, s)).toEqual(['aa:moved']);
  });

  it('a deleted card is "removed"; a rejected pending card is "rejected"; an approved one is "approved"', () => {
    const s0 = build(FILE);
    let s = run(caret(s0, 'b body'), K['Mod-Alt-Backspace']);
    expect(summary(s0, s)).toEqual(['bb:removed']);
    expect(cardEdits(s0.doc, s.doc)[0]).toMatchObject({ after: null, position: { after: 'aa', under: 'blk' } });
    expect(summary(s0, run(caret(s0, 'c body'), K['Mod-Shift-Backspace']))).toEqual(['cc:rejected']);
    s = run(caret(s0, 'c body'), K['Mod-Shift-Enter']);
    expect(summary(s0, s)).toEqual(['cc:approved']);
  });

  it('a new card is "added" with where it went', () => {
    const s0 = build(FILE);
    let s = caret(s0, 'b body', 6);
    s = run(s, K.Enter);
    s = type(s, 'My new tag');
    s = run(s, K.F7);
    const added = cardEdits(s0.doc, s.doc).find((e) => e.changes[0] === 'added')!;
    expect(added).toMatchObject({ title: 'My new tag', style: 'tag', position: { after: 'bb', under: 'blk' } });
  });

  it('changes merged in from disk are not the user\'s: after a merge the checkpoint is the file', () => {
    const s0 = build(FILE);
    const mine = type(caret(s0, 'Card A', 6), ' mine');
    const disk = build([...FILE, ['tag', 'From disk', 'dd'], ['normal', 'd']]).doc;
    const r = mergeFromDisk(s0.doc, mine.doc, disk);
    let s = mine.apply(applyMerge(mine, r.nodes));
    expect(summary(createState(r.checkpoint), s)).toEqual(['aa:tag']);
    // approving the card that came in pending is the user's
    s = run(caret(s, 'From disk'), K['Mod-Shift-Enter']);
    expect(summary(createState(r.checkpoint), s)).toEqual(['aa:tag', 'dd:approved']);
  });
});
