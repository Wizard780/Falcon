// The live co-editing spike, kept as tests: two Falcon editors (Falcon's own schema and plugins) bound to Loro docs
// through loro-prosemirror, with updates held in a queue so edits on both sides are truly concurrent until flush().
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TextSelection, type Command } from 'prosemirror-state';
import { addColumnAfter, addRowAfter, TableMap } from 'prosemirror-tables';
import type { EditorView } from 'prosemirror-view';
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { insertIntoSpeech } from '../src/editor/speech';
import { createState, createView, markMap, swapState } from '../src/editor/editor';
import { falconKeys as K } from '../src/editor/keymap';
import { schema } from '../src/editor/schema';
import { leftSince, markOf, redo, undo, untouched } from '../src/editor/live-hooks';
import { applyRemote, docOf, isLiveState, liveState, localState, narrowLoroReplace, newBinding, seed, type Binding } from '../src/collab/live-doc';
import { loroSyncPluginKey } from 'loro-prosemirror';

const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

beforeAll(() => {
  // jsdom has no layout
  Object.assign(document, { elementFromPoint: () => null });
  const zero = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => zero as DOMRect;
  Element.prototype.scrollIntoView = () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});

type Side = { b: Binding; view: EditorView; out: Uint8Array[] };
const sides: Side[] = [];
afterEach(() => { for (const s of sides.splice(0)) s.view.destroy(); document.body.innerHTML = ''; });

function mount(b: Binding, doc: PMNode, name: string): Side {
  const out: Uint8Array[] = [];
  b.doc.subscribeLocalUpdates((u) => out.push(u));
  const el = document.createElement('div');
  document.body.append(el);
  const view = createView(el, () => {}, liveState(createState(doc), b, { name, color: '#3b82f6' }));
  const s = { b, view, out };
  sides.push(s);
  return s;
}

/** A host with `doc` and a peer that joined from the host's snapshot. */
async function pair(doc: PMNode) {
  const hb = newBinding();
  hb.doc.setPeerId(1n);
  seed(hb, doc);
  const jb = newBinding();
  jb.doc.setPeerId(2n);
  jb.doc.import(hb.doc.export({ mode: 'snapshot' }));
  const A = mount(hb, doc, 'Avery');
  const B = mount(jb, docOf(jb)!, 'Blake');
  await tick(); // the binding attaches on a timeout
  await flush(A, B); // attaching can write a no-op or two (the binding deletes null attrs, which Loro records): deliver them like any update
  return { A, B };
}
/** Deliver what each side has queued to the other, in both directions. */
async function flush(...s: Side[]) {
  for (let round = 0; round < 3; round++) {
    for (const from of s) {
      const batch = from.out.splice(0);
      for (const to of s) if (to !== from) for (const u of batch) to.b.doc.import(u);
    }
    await tick();
  }
  await tick();
}
const posOf = (view: EditorView, text: string, off = 0) => {
  let found = -1;
  view.state.doc.descendants((n, pos) => {
    if (found >= 0 || !n.isTextblock) return found < 0;
    const i = n.textContent.indexOf(text);
    if (i >= 0) found = pos + 1 + i + off;
    return false;
  });
  if (found < 0) throw new Error(`no ${text}`);
  return found;
};
const select = (s: Side, text: string) => { const f = posOf(s.view, text); s.view.dispatch(s.view.state.tr.setSelection(TextSelection.create(s.view.state.doc, f, f + text.length))); };
const caret = (s: Side, text: string, off = 0) => { const p = posOf(s.view, text, off); s.view.dispatch(s.view.state.tr.setSelection(TextSelection.create(s.view.state.doc, p))); };
const run = (s: Side, cmd: Command) => cmd(s.view.state, s.view.dispatch, s.view);
const type = (s: Side, text: string) => { for (const ch of text) s.view.dispatch(s.view.state.tr.insertText(ch)); };
const mm = (s: Side) => markMap(s.view.state.doc);
const valid = (s: Side) => { s.view.state.doc.check(); return true; };

const P = (style: string, text: string) => schema.node('paragraph', { style }, text ? [schema.text(text)] : []);
const card = () => schema.node('doc', null, [
  P('block', 'Economy'),
  P('tag', 'Growth is slowing next year'),
  P('normal', 'Smith 24, Professor of Economics at MIT'),
  P('normal', 'The rapid expansion of AI has pushed utilities to their limits, and Global demand keeps rising.'),
  P('normal', 'Temperatures rose again.'),
]);

describe('two editors through Loro', () => {
  it('a joiner starts from the host doc exactly', async () => {
    const { A, B } = await pair(card());
    expect(mm(B)).toBe(mm(A));
    expect(B.b.doc.toJSON()).toEqual(A.b.doc.toJSON());
  });

  it('concurrent F-key formatting on both sides converges: underline, highlight, emphasis, cite, tag', async () => {
    const { A, B } = await pair(card());
    select(A, 'pushed utilities'); run(A, K.F9); // underline
    select(B, 'utilities to their'); run(B, K.F11); // highlight
    select(B, 'expansion of'); run(B, K.F10); // emphasis
    select(A, 'Smith 24'); run(A, K.F8); // cite
    caret(A, 'Temperatures'); run(A, K.F7); // tag
    caret(B, 'Temperatures', 3); type(B, 'XX');
    await flush(A, B);
    expect(mm(B)).toBe(mm(A));
    expect(valid(A) && valid(B)).toBe(true);
    const map = mm(A);
    expect(map).toContain('[pushed ]{underline}');
    expect(map).toContain('{highlight:yellow+underline}');
    expect(map).toContain('[expansion of]{emphasis}');
    expect(map).toContain('[Smith 24]{cite}');
    expect(map).toContain('tag: TemXXperatures rose again.');
  });

  it('underline and emphasis put on the same words at once settle the same way on both sides', async () => {
    const { A, B } = await pair(card());
    select(A, 'rapid expansion'); run(A, K.F9);
    select(B, 'expansion of AI'); run(B, K.F10);
    await flush(A, B);
    expect(mm(B)).toBe(mm(A));
    expect(valid(A) && valid(B)).toBe(true); // never both marks on one run
    expect(B.b.doc.toJSON()).toEqual(A.b.doc.toJSON());
  });

  it('someone typing ahead of my caret in my paragraph moves my caret along: my next key lands where I left off', async () => {
    const { A, B } = await pair(card());
    caret(A, 'Temperatures rose again.', 'Temperatures rose again.'.length); // the end of the paragraph
    caret(B, 'Temperatures');
    type(B, 'Hot: ');
    await flush(A, B);
    await tick(10); // the binding puts the caret back from Loro on a timeout
    type(A, ' More.');
    await flush(A, B);
    expect(mm(A)).toContain('normal: Hot: Temperatures rose again. More.');
    expect(mm(B)).toBe(mm(A));
  });

  it('typing at the same place, and Enter against typing, converge', async () => {
    const { A, B } = await pair(card());
    caret(A, 'Temperatures'); type(A, 'aaa');
    caret(B, 'Temperatures'); type(B, 'bbb');
    caret(A, 'Global'); run(A, (s, d) => { d!(s.tr.split(s.selection.from)); return true; });
    caret(B, 'Global', 2); type(B, '!');
    await flush(A, B);
    expect(mm(B)).toBe(mm(A));
    expect(mm(A)).toMatch(/aaa|bbb/);
    // the binding makes a split a delete and a new paragraph, so B's ! stays where its text was: both agree, nothing is lost
    expect(mm(A)).toContain('!');
    expect(mm(A)).toContain('\nnormal: Global demand keeps rising.');
  });

  it('tables: typing in different cells, a row and a column added at once, converge to a valid table', async () => {
    const cell = (t: string) => schema.nodes.table_cell.create({ colwidth: [200] }, P('normal', t));
    const table = schema.nodes.table.create(null, [schema.nodes.table_row.create(null, [cell('a1'), cell('b1')]), schema.nodes.table_row.create(null, [cell('a2'), cell('b2')])]);
    const { A, B } = await pair(schema.node('doc', null, [P('tag', 'Table card'), table, P('normal', 'after')]));
    B.b.fixer = () => false; // A tidies remote changes; B leaves them to A
    caret(A, 'a1', 2); type(A, '-A');
    caret(B, 'b2', 2); type(B, '-B');
    caret(A, 'a1'); run(A, addRowAfter);
    caret(B, 'b2'); run(B, addColumnAfter);
    await flush(A, B);
    expect(B.b.doc.toJSON()).toEqual(A.b.doc.toJSON());
    expect(mm(B)).toBe(mm(A));
    expect(valid(A) && valid(B)).toBe(true);
    const t = A.view.state.doc.child(1);
    expect(TableMap.get(t).problems ?? null).toBeNull();
    expect(mm(A)).toContain('a1-A');
    expect(mm(A)).toContain('b2-B');
  });

  it('footnotes: notes added and edited on both sides converge', async () => {
    const { A, B } = await pair(card());
    const note = (text: string) => schema.nodes.footnote.create({ content: [{ type: 'text', text }] });
    caret(A, 'Temperatures', 12); run(A, (s, d) => { d!(s.tr.replaceSelectionWith(note('A note'))); return true; });
    caret(B, 'Smith 24', 8); run(B, (s, d) => { d!(s.tr.replaceSelectionWith(note('B note'))); return true; });
    await flush(A, B);
    expect(mm(B)).toBe(mm(A));
    expect(mm(A)).toContain('[^A note]');
    expect(mm(A)).toContain('[^B note]');
    // both edit A's note at once: one version wins, the same on both sides
    for (const [s, text] of [[A, 'A edit'], [B, 'B edit']] as const) {
      let at = -1;
      s.view.state.doc.descendants((n, p) => { if (n.type.name === 'footnote' && n.attrs.content[0]?.text === 'A note') at = p; });
      s.view.dispatch(s.view.state.tr.setNodeMarkup(at, null, { content: [{ type: 'text', text }] }));
    }
    await flush(A, B);
    expect(mm(B)).toBe(mm(A));
    expect(mm(A)).toMatch(/\[\^(A|B) edit\]/);
  });

  it('undo takes back only my own edits: typing and formatting', async () => {
    const { A, B } = await pair(card());
    caret(A, 'Temperatures'); type(A, 'mine ');
    caret(B, 'Smith 24'); type(B, 'theirs ');
    await flush(A, B);
    run(A, undo);
    await tick(10);
    expect(mm(A)).not.toContain('mine ');
    expect(mm(A)).toContain('theirs ');
    await flush(A, B);
    expect(mm(B)).toBe(mm(A));
    run(A, redo);
    await tick(10);
    expect(mm(A)).toContain('mine ');
    await tick(600); // a new undo step
    select(A, 'pushed utilities'); run(A, K.F9);
    caret(B, 'Global'); type(B, 'very ');
    await flush(A, B);
    run(A, undo);
    await tick(10);
    expect(mm(A)).not.toContain('{underline}');
    expect(mm(A)).toContain('very Global');
    await flush(A, B);
    expect(mm(B)).toBe(mm(A));
    // B never typed since the flush: its undo takes back B's own typing, not A's
    run(B, undo);
    await tick(10);
    expect(mm(B)).not.toContain('very ');
    expect(mm(B)).toContain('mine ');
  });
});

describe('undo steps in a live doc', () => {
  const block = () => Fragment.from([P('tag', 'INSERTED TAG'), P('normal', 'inserted body')]);
  it('a card inserted right after typing is its own step: one Mod-Z takes the card, the next the typing', async () => {
    const { A } = await pair(card());
    caret(A, 'Temperatures'); type(A, 'mine ');
    A.view.dispatch(insertIntoSpeech(A.view.state, block())); // within the 500 ms the typing merges over
    await tick(10);
    run(A, undo);
    await tick(10);
    expect(mm(A)).not.toContain('INSERTED TAG');
    expect(mm(A)).toContain('mine ');
    run(A, undo);
    await tick(10);
    expect(mm(A)).not.toContain('mine ');
    // and typing after it merges again as before
    caret(A, 'Temperatures'); type(A, 'ab');
    run(A, undo);
    await tick(10);
    expect(mm(A)).not.toContain('abTemperatures');
    expect(mm(A)).not.toContain('aTemperatures');
  });
  it("a send's toast Undo still works after someone else edits, and not after you do (markOf / untouched)", async () => {
    const { A, B } = await pair(card());
    A.view.dispatch(insertIntoSpeech(A.view.state, block()));
    const m = markOf(A.view.state);
    caret(B, 'Smith 24'); type(B, 'theirs ');
    await flush(A, B);
    expect(mm(A)).toContain('theirs ');
    expect(untouched(A.view.state, m)).toBe(true);
    caret(A, 'Temperatures'); type(A, 'x');
    expect(untouched(A.view.state, m)).toBe(false);
  });
  it('a mark made while live, once the doc is plain again, is not untouched (its undo went with the session)', async () => {
    const { A } = await pair(card());
    const plugins = createState(card()).plugins;
    A.view.dispatch(insertIntoSpeech(A.view.state, block()));
    const m = markOf(A.view.state);
    A.view.updateState(localState(A.view.state, plugins));
    expect(untouched(A.view.state, m)).toBe(false);
    expect(leftSince(A.view.state, m)).toBe(true);
  });
  it("someone else's edits arriving several to a frame leave my undo alone", async () => {
    const { A, B } = await pair(card());
    caret(A, 'Temperatures'); type(A, 'mine ');
    await flush(A, B);
    caret(B, 'Smith 24'); type(B, 'ab'); // two updates, as one frame carries them
    const frame = B.out.splice(0);
    expect(frame.length).toBeGreaterThan(1);
    // what LiveSession.take does with a frame
    for (const u of frame) A.b.doc.import(u);
    await tick(10);
    expect(A.b.undo.canUndo()).toBe(true);
    run(A, undo);
    await tick(10);
    expect(mm(A)).not.toContain('mine ');
    expect(mm(A)).toContain('ab');
  });
  it('a paste right after typing is its own step too', async () => {
    const { A } = await pair(card());
    caret(A, 'Temperatures'); type(A, 'mine ');
    A.view.dispatch(A.view.state.tr.insert(A.view.state.doc.content.size, block()).setMeta('uiEvent', 'paste'));
    await tick(10);
    run(A, undo);
    await tick(10);
    expect(mm(A)).not.toContain('INSERTED TAG');
    expect(mm(A)).toContain('mine ');
  });
});

describe('a live doc going in and out of the editor', () => {
  const insertPara = (s: Side, text: string) => s.view.dispatch(s.view.state.tr.insert(s.view.state.doc.content.size, P('normal', text)));

  it('put away while others edit, then shown again: what came in is there, and an edit before the binding is back is held off', async () => {
    const { A, B } = await pair(card());
    const other = createState(schema.node('doc', null, [P('tag', 'Another file')]));
    const live = B.view.state;
    swapState(B.view, other);
    insertPara(A, 'Added while B was away');
    await flush(A, B);
    expect(mm(B)).toBe('tag: Another file'); // the other doc is untouched
    swapState(B.view, live);
    B.view.dispatch(B.view.state.tr.setSelection(TextSelection.atStart(B.view.state.doc))); // selection only: goes through
    B.view.dispatch(B.view.state.tr.insertText('stale ')); // a doc change before the binding is back: dropped
    expect(mm(B)).not.toContain('stale');
    await tick();
    await flush(A, B);
    expect(mm(B)).toContain('Added while B was away');
    expect(mm(A)).toContain('Added while B was away');
    expect(mm(B)).toBe(mm(A));
    caret(B, 'Temperatures'); type(B, 'back ');
    await flush(A, B);
    expect(mm(A)).toContain('back Temperatures');
  });

  it("a joiner that already has the host's caret mounts without a sound, and shows it", async () => {
    const hb = newBinding(); hb.doc.setPeerId(1n);
    const doc = schema.node('doc', null, Array.from({ length: 300 }, (_, i) => P(i % 4 ? 'normal' : 'tag', `Paragraph ${i}`)));
    seed(hb, doc);
    const host = mount(hb, doc, 'Avery');
    await tick();
    // Avery's caret, as the cursor plugin sets it when Avery's editor has focus (jsdom gives it none)
    const text = ((hb.doc.getMap('doc').get('children') as unknown as { get(i: number): { get(k: string): { get(i: number): { getCursor(p: number): unknown } } } }).get(1).get("children").get(0)); // near the top: far paragraphs are drawn as empty placeholders (window.ts)
    const at = text.getCursor(3) as never;
    hb.presence.setLocal({ user: (hb.presence as unknown as { mine: { name: string; color: string } }).mine, anchor: at, focus: at });
    const jb = newBinding(); jb.doc.setPeerId(2n);
    jb.doc.import(hb.doc.export({ mode: 'snapshot' }));
    jb.presence.apply(hb.presence.encodeAll());
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const B = mount(jb, docOf(jb)!, 'Blake');
      await tick();
      expect(errors).not.toHaveBeenCalled();
      expect(B.view.dom.querySelector('.f-peer')?.getAttribute('title')).toBe('Avery');
    } finally { errors.mockRestore(); }
    expect(host).toBeTruthy();
  });

  it('two live docs in one editor, switched between, each keep to their own Loro doc', async () => {
    const one = await pair(card());
    const two = await pair(schema.node('doc', null, [P('tag', 'Second doc'), P('normal', 'Its body')]));
    const first = one.B.view.state, second = two.B.view.state;
    two.B.view.destroy(); // the second doc leaves its own editor and goes into the first one's
    swapState(one.B.view, second);
    await tick();
    insertPara(one.A, 'One more in the first');
    insertPara(two.A, 'One more in the second');
    await flush(one.A, one.B);
    await flush(two.A, two.B);
    expect(mm(one.B)).toContain('One more in the second');
    expect(mm(one.B)).not.toContain('One more in the first');
    swapState(one.B.view, first);
    await tick();
    expect(mm(one.B)).toContain('One more in the first');
    expect(mm(one.B)).not.toContain('Second doc');
    expect(one.B.b.doc.toJSON()).toEqual(one.A.b.doc.toJSON());
    expect(two.B.b.doc.toJSON()).toEqual(two.A.b.doc.toJSON());
  });

  it('leaving: the doc stays, undo is prosemirror-history again, and nothing more goes into Loro', async () => {
    const { A, B } = await pair(card());
    const plain = createState(card()).plugins;
    caret(A, 'Temperatures'); type(A, 'shared ');
    await flush(A, B);
    const before = mm(B);
    B.view.updateState(localState(B.view.state, plain));
    expect(isLiveState(B.view.state)).toBe(false);
    expect(mm(B)).toBe(before);
    await tick(600);
    caret(B, 'Global'); type(B, 'mine ');
    expect(B.out.length).toBe(0);
    run(B, undo);
    expect(mm(B)).toBe(before);
    run(B, undo); // history began at leaving: the shared typing before it isn't undone
    expect(mm(B)).toContain('shared ');
  });
});

describe('what a doc from someone else can and can\'t do', () => {
  type LMap = { get(k: string): unknown; set(k: string, v: unknown): void; size: number };
  type LList = { get(i: number): unknown; length: number };
  const at = (b: Binding, ...path: number[]) => {
    let n = (b.doc.getMap('doc') as unknown as LMap);
    for (const i of path) n = ((n.get('children') as LList).get(i) as LMap);
    return n;
  };
  it('an attr with CSS in it draws as nothing: no url(), no layout tricks, wherever it came from', async () => {
    const { A, B } = await pair(card());
    // a modified Falcon writes straight into Loro: a color with CSS after it, and a size with more
    const text = ((at(A.b, 3).get('children') as LList).get(0)) as { mark(r: { start: number; end: number }, k: string, v: unknown): void };
    text.mark({ start: 4, end: 9 }, 'color', { color: 'red;background:url(https://evil.example/x)' });
    text.mark({ start: 10, end: 19 }, 'size', { pt: '12pt;position:fixed;inset:0' });
    A.b.doc.commit();
    await flush(A, B);
    // the raw value may sit in an inert data- attribute; no inline style carries any of it
    const styles = [...B.view.dom.querySelectorAll('[style]')].map((e) => e.getAttribute('style') ?? '');
    expect(styles.filter((x) => /url\(|position|;\s*background/.test(x))).toEqual([]);
    expect(B.view.dom.querySelector('.f-color')?.getAttribute('style')).toMatch(/^color:\s*inherit;?$/);
    expect(B.view.dom.querySelector('.f-size')?.getAttribute('style')).toMatch(/^font-size:\s*11pt;?$/);
  });
  it('a table cell spanning a billion columns and a style that doesn\'t exist are repaired, on join and as they come in, for everyone', async () => {
    const cell = (t: string) => schema.nodes.table_cell.create({ colwidth: [200] }, P('normal', t));
    const table = schema.nodes.table.create(null, [schema.nodes.table_row.create(null, [cell('a1'), cell('b1')])]);
    const { A, B } = await pair(schema.node('doc', null, [P('tag', 'Table card'), table, P('normal', 'after')]));
    (at(A.b, 1, 0, 0).get('attributes') as LMap).set('colspan', 1_000_000_000);
    (at(A.b, 2).get('attributes') as LMap).set('style', 'evil');
    A.b.doc.commit();
    await flush(A, B);
    const t = B.view.state.doc.child(1);
    expect(t.child(0).child(0).attrs.colspan).toBe(1);
    expect(B.view.state.doc.child(2).attrs.style).toBe('normal');
    expect(valid(B)).toBe(true);
    // B's repair went back into Loro, so A's doc has it too
    expect((at(A.b, 1, 0, 0).get('attributes') as LMap).get('colspan')).toBe(1);
    // and someone joining now gets the repaired doc
    const jb = newBinding(); jb.doc.setPeerId(3n);
    jb.doc.import(A.b.doc.export({ mode: 'snapshot' }));
    expect(docOf(jb)!.child(1).child(0).child(0).attrs.colspan).toBe(1);
  });
  it('a cell with no paragraph left (two people deleting its last lines at once) gets an empty one, not a broken table', async () => {
    const cell = (t: string) => schema.nodes.table_cell.create(null, P('normal', t));
    const table = schema.nodes.table.create(null, [schema.nodes.table_row.create(null, [cell('a1'), cell('b1')])]);
    const { A, B } = await pair(schema.node('doc', null, [P('tag', 'Table card'), table]));
    const kids = at(A.b, 1, 0, 0).get('children') as { delete(i: number, n: number): void };
    kids.delete(0, 1);
    A.b.doc.commit();
    await flush(A, B);
    expect(valid(B)).toBe(true);
    expect(B.view.state.doc.child(1).child(0).child(0).childCount).toBe(1);
  });
});

describe('a modified Falcon in the room', () => {
  type LMap = { get(k: string): unknown; set(k: string, v: unknown): void };
  it("a node it writes that the binding can't rebuild is taken out, and what it writes after still shows", async () => {
    const { A, B } = await pair(card());
    const { LoroDoc, LoroMap } = await import('loro-crdt');
    // the modified Falcon writes into Loro directly, never through an editor (an editor's own edits would take it out)
    const H = new LoroDoc(); H.setPeerId(9n);
    H.import(A.b.doc.export({ mode: 'snapshot' }));
    const root = H.getMap('doc') as unknown as LMap;
    const kids = root.get('children') as { insertContainer(i: number, c: unknown): LMap; get(i: number): LMap };
    const bad = kids.insertContainer(1, new LoroMap());
    bad.set('nodeName', 42);
    H.commit();
    const last = ((kids.get(5).get('children') as { get(i: number): unknown }).get(0)) as { insert(at: number, t: string): void };
    last.insert(0, 'hostile typed ');
    H.commit();
    B.b.doc.import(H.export({ mode: 'update', from: B.b.doc.oplogVersion() }));
    await tick();
    expect(valid(B)).toBe(true);
    expect(mm(B)).toContain('hostile typed Temperatures');
    expect(JSON.stringify(B.b.doc.toJSON())).not.toContain('"nodeName":42'); // B took it out of Loro
  });
  it("a caret whose bytes don't decode is left out; edits keep coming", async () => {
    const { A, B } = await pair(card());
    const { EphemeralStore } = await import('loro-crdt');
    const evil = new EphemeralStore(60_000);
    evil.set('99', { anchor: new Uint8Array([1, 2, 3, 4]), focus: new Uint8Array([9, 9]), user: { name: 'Mallory', color: 'red;background:url(x)' } });
    B.b.presence.apply(evil.encodeAll());
    caret(A, 'Temperatures'); type(A, 'still arriving ');
    await flush(A, B);
    expect(mm(B)).toContain('still arriving Temperatures');
  });
  it('a picture whose source is a file on disk is left out; an absurd size is the picture\'s own', async () => {
    const { A, B } = await pair(card());
    const img = (attrs: Record<string, unknown>) => schema.nodes.image.create({ alt: '', crop: null, ...attrs });
    caret(A, 'Temperatures');
    run(A, (st, d) => { d!(st.tr.replaceSelectionWith(img({ src: 'data:image/png;base64,iVBORw0KGgo=', width: 1e9, height: 5 }))); return true; });
    caret(A, 'Smith');
    run(A, (st, d) => { d!(st.tr.replaceSelectionWith(img({ src: 'file:///etc/passwd', width: 10, height: 10 }))); return true; });
    await flush(A, B);
    const imgs: Record<string, unknown>[] = [];
    B.view.state.doc.descendants((n) => { if (n.type.name === 'image') imgs.push(n.attrs); return true; });
    expect(imgs).toHaveLength(1);
    expect(imgs[0].src).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(imgs[0].width).toBeNull();
    expect(valid(B)).toBe(true);
  });
});

describe('a live doc whose tab is put away', () => {
  it('is kept up to date with what comes in, and an edit to it (Send to speech) goes into Loro', async () => {
    const { A, B } = await pair(card());
    let stored: import('prosemirror-state').EditorState | null = null, off: (() => void) | null = null;
    B.b.shown = (shown, last) => { // what the session does (ui/Live.tsx follow)
      off?.(); off = null;
      if (shown) return;
      stored = last;
      off = B.b.doc.subscribe((e) => { const next = stored && applyRemote(stored, B.b, e); if (next) stored = next; });
    };
    const live = B.view.state;
    swapState(B.view, createState(schema.node('doc', null, [P('tag', 'Another file')])));
    expect(stored).not.toBeNull();
    A.view.dispatch(A.view.state.tr.insert(A.view.state.doc.content.size, P('normal', 'While B looks elsewhere')));
    await flush(A, B);
    expect(markMap(stored!.doc)).toContain('While B looks elsewhere');
    expect(markMap(stored!.doc)).toBe(mm(A));
    // an edit to the put-away state, as Send to speech makes one: it goes through and reaches A
    const next = stored!.apply(stored!.tr.insert(stored!.doc.content.size, P('tag', 'Sent to speech')));
    expect(markMap(next.doc)).toContain('Sent to speech');
    stored = next;
    await flush(A, B);
    expect(mm(A)).toContain('Sent to speech');
    expect(live).toBeTruthy();
    (off as (() => void) | null)?.();
  });
});

describe('a remote change replaces only what differs', () => {
  const doc = schema.node('doc', null, Array.from({ length: 40 }, (_, i) => P(i % 5 ? 'normal' : 'tag', `Paragraph ${i} text`)));
  const whole = (b: PMNode) => { const s = createState(doc); return { s, tr: s.tr.replace(0, s.doc.content.size, b.slice(0, b.content.size)).setMeta(loroSyncPluginKey, { type: 'non-local-updates' }) }; };
  const edit = (i: number, text: string) => P('normal', text) ?? i;
  it('edits in three places: three small steps, the same doc', () => {
    const kids: PMNode[] = []; doc.forEach((n) => kids.push(n));
    kids[2] = edit(2, 'Paragraph 2 texX'); kids[20] = edit(20, 'Paragraph 20 text more'); kids.splice(35, 1);
    const b = schema.node('doc', null, kids);
    const { s, tr } = whole(b);
    const n = narrowLoroReplace(s, tr);
    expect(n.doc.eq(b)).toBe(true);
    expect(n.steps.length).toBe(3);
    for (const st of n.steps) { const m = st.getMap(); let len = 0; m.forEach((f, t) => { len += t - f; }); expect(len).toBeLessThan(40); }
    expect(n.getMeta(loroSyncPluginKey)).toEqual({ type: 'non-local-updates' });
  });
  it('nothing changed: no steps; a moved paragraph: still the same doc', () => {
    const same = whole(doc);
    expect(narrowLoroReplace(same.s, same.tr).steps.length).toBe(0);
    const kids: PMNode[] = []; doc.forEach((n) => kids.push(n));
    const [moved] = kids.splice(3, 1); kids.splice(30, 0, moved);
    const b = schema.node('doc', null, kids);
    const { s, tr } = whole(b);
    expect(narrowLoroReplace(s, tr).doc.eq(b)).toBe(true);
  });
});

describe('a large block file', () => {
  // ~4,800 paragraphs: a 1,200-card block file, several hundred pages (LIVE_CARDS=3700 for a 15k-paragraph one)
  const CARDS = Number(process.env.LIVE_CARDS) || 1200;
  const big = () => {
    const paras: PMNode[] = [];
    const U = schema.marks.underline.create(), H = schema.marks.highlight.create({ color: 'cyan' }), C = schema.marks.cite.create();
    for (let i = 0; i < CARDS; i++) {
      if (i % 40 === 0) paras.push(P('block', `Block ${i / 40}`));
      paras.push(P('tag', `Tag ${i}: the impact outweighs on magnitude and timeframe`));
      paras.push(schema.node('paragraph', null, [schema.text(`Author ${i}`, [C]), schema.text(', Professor at Somewhere University, 2024')]));
      paras.push(schema.node('paragraph', null, [schema.text('Lorem ipsum dolor sit amet, '), schema.text('consectetur adipiscing elit', [U, H]), schema.text(', sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.')]));
      paras.push(schema.node('paragraph', null, [schema.text('Quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat, '), schema.text('duis aute irure dolor', [U])]));
    }
    return schema.node('doc', null, paras);
  };

  it('loads, types and takes remote edits at usable speed', async () => {
    const doc = big();
    const t0 = performance.now();
    const hb = newBinding(); hb.doc.setPeerId(1n);
    seed(hb, doc);
    const seedMs = performance.now() - t0;
    const snap = hb.doc.export({ mode: 'snapshot' });
    const t1 = performance.now();
    const jb = newBinding(); jb.doc.setPeerId(2n);
    jb.doc.import(snap);
    const joined = docOf(jb)!;
    const joinMs = performance.now() - t1;
    expect(joined.eq(doc)).toBe(true);
    const A = mount(hb, doc, 'Avery'), B = mount(jb, joined, 'Blake');
    await tick();
    await flush(A, B);

    // a key, as the binding sees it: the transaction applied with the binding's diff into Loro
    const keyMs = (s: Side, at: number) => {
      s.view.dispatch(s.view.state.tr.setSelection(TextSelection.create(s.view.state.doc, at)));
      const times: number[] = [];
      for (let i = 0; i < 15; i++) {
        const tr = s.view.state.tr.insertText('k');
        const t = performance.now();
        s.view.state.apply(tr); // what the binding costs per key (no DOM)
        times.push(performance.now() - t);
        s.view.dispatch(s.view.state.tr.insertText('k'));
      }
      return times.sort((a, b) => a - b)[7];
    };
    const size = A.view.state.doc.content.size;
    const start = keyMs(A, 3), middle = keyMs(A, Math.floor(size / 2) - (Math.floor(size / 2) % 2)), end = keyMs(A, A.view.state.doc.content.size - 3);
    // a remote batch, as live.ts sends it: everything B lacks in one update, imported once
    A.out.length = 0;
    const batch = A.b.doc.export({ mode: 'update', from: B.b.doc.oplogVersion() });
    const t2 = performance.now();
    B.b.doc.import(batch);
    const remoteMs = performance.now() - t2;
    await tick();
    expect(mm(B)).toBe(mm(A));
    const report = { paragraphs: doc.childCount, seedMs, snapshotKB: snap.length / 1024, joinMs, keyMs: { start, middle, end }, remoteBatchMs: remoteMs };
    console.log('live big file', JSON.stringify(report, (_k, v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v)));
    expect(Math.max(start, middle, end)).toBeLessThan(150); // ~4 ms here: headroom for slow CI machines
  }, 120_000);
});
