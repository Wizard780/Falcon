import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { EditorState } from 'prosemirror-state';
import { docToDocx } from '../src/docx/export';
import { docxToDoc } from '../src/docx/import';
import { createState } from '../src/editor/editor';
import { falconKeys as K } from '../src/editor/keymap';
import { pendingKey, pendingSections } from '../src/editor/pending';
import { sendContent } from '../src/editor/speech';
import { schema, type ParaStyle } from '../src/editor/schema';
import { caret, run } from './helpers';

type P = [ParaStyle, string, boolean?];
const build = (paras: P[]) => createState(schema.node('doc', null, paras.map(([style, text, pending]) => schema.node('paragraph', { style, pending: !!pending }, text ? [schema.text(text)] : []))));
const FILE: P[] = [['block', 'AT: Deterrence'], ['tag', 'Old card'], ['normal', 'old body'], ['tag', 'Claude card', true], ['normal', 'Smith 24'], ['normal', 'new body'], ['tag', 'Second old'], ['normal', 'second body'], ['tag', 'Claude two', true], ['normal', 'two body']];
const texts = (s: EditorState) => { const o: string[] = []; s.doc.forEach((n) => o.push(n.textContent)); return o; };
const orange = (s: EditorState) => {
  const o: string[] = [];
  const set = pendingKey.getState(s)!.decos;
  s.doc.forEach((n, pos) => { if (set.find(pos, pos + n.nodeSize).some((d) => d.from === pos && d.to === pos + n.nodeSize && (d as unknown as { type: { attrs?: { class?: string } } }).type.attrs?.class?.includes('f-pending'))) o.push(n.textContent); });
  return o;
};
const xmlOf = async (s: EditorState) => strFromU8(unzipSync(await docToDocx(s.doc))['word/document.xml']);

describe('pending cards', () => {
  it('a pending card (tag and body) is drawn orange; the cards around it are not', () => {
    expect(orange(build(FILE))).toEqual(['Claude card', 'Smith 24', 'new body', 'Claude two', 'two body']);
  });

  it('a pending block covers every card under it', () => {
    const s = build([['block', 'New block', true], ['tag', 'a'], ['normal', 'a body'], ['block', 'Next block'], ['tag', 'b']]);
    expect(orange(s)).toEqual(['New block', 'a', 'a body']);
    expect(pendingSections(s.doc).length).toBe(1);
  });

  it('opens a _fcp_ bookmark as pending and saves it back; Word sees only a hidden bookmark, never a color', async () => {
    const s = build(FILE);
    const xml = await xmlOf(s);
    expect(xml.match(/w:name="_fcp_[a-z0-9]+"/g)?.length).toBe(2);
    expect(xml.match(/w:name="_fc_[a-z0-9]+"/g)?.length).toBe(3);
    // the pending file's XML is the plain file's with only the bookmark names changed
    const plain = await xmlOf(build(FILE.map(([st, t]) => [st, t] as P)));
    const strip = (x: string) => x.replace(/<w:bookmark(Start|End)[^>]*\/>/g, '');
    expect(strip(xml)).toBe(strip(plain));
    const back = await docxToDoc(await docToDocx(s.doc));
    const pend: string[] = [];
    back.forEach((n) => { if (n.attrs.pending) pend.push(n.textContent); });
    expect(pend).toEqual(['Claude card', 'Claude two']);
  });

  it('reads a marker Claude wrote with python-docx: a _fcp_ bookmark in the tag paragraph', async () => {
    const files = unzipSync(await docToDocx(build([['tag', 'Mine'], ['normal', 'x'], ['tag', 'From Claude'], ['normal', 'y']]).doc));
    let n = 0;
    files['word/document.xml'] = strToU8(strFromU8(files['word/document.xml']).replace(/<w:bookmark(Start|End)[^>]*\/>/g, '').replace(/<w:pStyle w:val="Heading4"\/><\/w:pPr>/g, (m) => (++n === 2 ? `${m}<w:bookmarkStart w:id="90" w:name="_fcp_c1aude01"/><w:bookmarkEnd w:id="90"/>` : m)));
    const doc = await docxToDoc(zipSync(files));
    expect(doc.child(2).attrs).toMatchObject({ style: 'tag', card: 'c1aude01', pending: true });
    expect(doc.child(0).attrs.pending).toBe(false);
  });

  it('Approve keeps the card, clears the orange and goes to the next pending card', () => {
    let s = caret(build(FILE), 'new body');
    s = run(s, K['Mod-Shift-Enter']);
    expect(texts(s)).toEqual(FILE.map((p) => p[1]));
    expect(orange(s)).toEqual(['Claude two', 'two body']);
    expect(s.doc.resolve(s.selection.from).parent.textContent).toBe('Claude two');
  });

  it('Reject deletes the card (tag and body) and goes to the next pending card; Undo brings it back', () => {
    const s0 = caret(build(FILE), 'Smith');
    let s = run(s0, K['Mod-Shift-Backspace']);
    expect(texts(s)).toEqual(['AT: Deterrence', 'Old card', 'old body', 'Second old', 'second body', 'Claude two', 'two body']);
    expect(s.doc.resolve(s.selection.from).parent.textContent).toBe('Claude two');
    s = run(s, K['Mod-z']);
    expect(texts(s)).toEqual(FILE.map((p) => p[1]));
  });

  it('outside a pending card the keys only jump to the next one: nothing is approved or deleted', () => {
    let s = caret(build(FILE), 'second body');
    s = run(s, K['Mod-Shift-Backspace']);
    expect(texts(s)).toEqual(FILE.map((p) => p[1]));
    expect(s.doc.resolve(s.selection.from).parent.textContent).toBe('Claude two');
    let none = caret(build([['tag', 'a'], ['normal', 'b']]), 'b');
    const before = none;
    none = run(none, K['Mod-Shift-Enter']);
    expect(none).toBe(before);
  });

  it('the last approval leaves no orange, and a card sent to speech is never pending there', () => {
    let s = caret(build(FILE), 'new body');
    s = run(s, K['Mod-Shift-Enter']);
    s = run(s, K['Mod-Shift-Enter']);
    expect(orange(s)).toEqual([]);
    const sent = sendContent(caret(build(FILE), 'new body'))!;
    const flags: boolean[] = [];
    sent.content.forEach((n) => flags.push(n.attrs.pending));
    expect(flags).toEqual([false, false, false]);
  });

});
