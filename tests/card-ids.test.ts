import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { Slice } from 'prosemirror-model';
import { TextSelection, type EditorState } from 'prosemirror-state';
import { docToDocx } from '../src/docx/export';
import { docxToDoc } from '../src/docx/import';
import { schema } from '../src/editor/schema';
import { falconKeys as K } from '../src/editor/keymap';
import { at, caret, make, run } from './helpers';

const ids = (doc: EditorState['doc']) => {
  const out: [string, string, string | null][] = [];
  doc.forEach((n) => out.push([n.attrs.style, n.textContent, n.attrs.card]));
  return out;
};
const heads = (doc: EditorState['doc']) => ids(doc).filter(([s]) => !['normal', 'undertag'].includes(s));
const docXml = async (doc: EditorState['doc']) => strFromU8(unzipSync(await docToDocx(doc))['word/document.xml']);
const CARDS: [Parameters<typeof make>[0][number][0], string][] = [['block', 'AT: Deterrence'], ['tag', 'First tag'], ['normal', 'Smith 24'], ['normal', 'body one'], ['analytic', 'An analytic'], ['tag', 'Second tag'], ['normal', 'body two']];

describe('stable card ids', () => {
  it('a file with no ids opens with a unique id on every heading and none on body text', async () => {
    const doc = await docxToDoc(await docToDocx(make(CARDS).doc));
    const h = heads(doc);
    expect(h.map(([, t]) => t)).toEqual(['AT: Deterrence', 'First tag', 'An analytic', 'Second tag']);
    expect(h.every(([, , id]) => /^[a-z0-9]{8}$/.test(id ?? ''))).toBe(true);
    expect(new Set(h.map(([, , id]) => id)).size).toBe(4);
    expect(ids(doc).filter(([s]) => s === 'normal').every(([, , id]) => id === null)).toBe(true);
  });

  it('ids survive save and reopen, as hidden _fc_ bookmarks at the start of each heading', async () => {
    const first = await docxToDoc(await docToDocx(make(CARDS).doc));
    const xml = await docXml(first);
    const id = heads(first)[1][2];
    expect(xml).toContain(`<w:pPr><w:pStyle w:val="Heading4"/></w:pPr><w:bookmarkStart w:id="1" w:name="_fc_${id}"/><w:bookmarkEnd w:id="1"/>`);
    expect(xml.match(/w:name="_fc_/g)?.length).toBe(4);
    const again = await docxToDoc(await docToDocx(first));
    expect(heads(again)).toEqual(heads(first));
  });

  it('reads an id another program wrote: Word-style casing, between paragraphs, or a repeated copy', async () => {
    const files = unzipSync(await docToDocx(make([['tag', 'One'], ['normal', 'a'], ['tag', 'Two'], ['tag', 'Three']]).doc));
    let xml = strFromU8(files['word/document.xml']).replace(/<w:bookmark(Start|End)[^>]*\/>/g, '');
    let n = 0;
    xml = xml.replace(/<w:p><w:pPr><w:pStyle w:val="Heading4"\/><\/w:pPr>/g, (m) => {
      n++;
      if (n === 1) return `${m}<w:bookmarkStart w:id="7" w:name="_FC_ABC123"/><w:bookmarkEnd w:id="7"/>`; // bookmark names are case-blind in Word
      if (n === 2) return `<w:bookmarkStart w:id="8" w:name="_fc_loose1"/>${m}<w:bookmarkEnd w:id="8"/>`;
      return `${m}<w:bookmarkStart w:id="9" w:name="_fc_abc123"/><w:bookmarkEnd w:id="9"/>`; // a script copied the first card whole
    });
    files['word/document.xml'] = strToU8(xml);
    const h = heads(await docxToDoc(zipSync(files)));
    expect(h[0]).toEqual(['tag', 'One', 'abc123']);
    expect(h[1]).toEqual(['tag', 'Two', 'loose1']);
    expect(h[2][2]).not.toBe('abc123');
    expect(h[2][2]).toMatch(/^[a-z0-9]{8}$/);
  });

  it('typing keeps the id; a new tag gets one; a pasted copy gets a fresh one and the original keeps its own', async () => {
    let s = make(CARDS);
    s = s.apply(s.tr.insertText('x')); // any change stamps the headings
    const before = heads(s.doc);
    expect(before.every(([, , id]) => id)).toBe(true);
    s = run(caret(s, 'First tag', 5), (st, d) => { d!(st.tr.insertText(' edited')); return true; });
    expect(heads(s.doc)[1]).toEqual(['tag', 'First edited tag', before[1][2]]);
    // F7 on body text makes a new tag with its own id
    s = run(caret(s, 'body two'), K.F7);
    const made = heads(s.doc).find(([, t]) => t === 'body two')!;
    expect(made[2]).toMatch(/^[a-z0-9]{8}$/);
    expect(heads(s.doc).filter(([, , id]) => id === made[2]).length).toBe(1);
    // copy the first card (tag + body) and paste it above itself
    const from = at(s, 'First edited tag') - 1, to = at(s, 'body one') + 'body one'.length + 1;
    const copy = new Slice(s.doc.slice(from, to).content, 0, 0);
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, from)).replace(from, from, copy));
    const firsts = heads(s.doc).filter(([, t]) => t === 'First edited tag');
    expect(firsts.length).toBe(2);
    expect(firsts[1][2]).toBe(before[1][2]); // the original (now second) keeps it
    expect(firsts[0][2]).not.toBe(before[1][2]);
    expect(new Set(heads(s.doc).map(([, , id]) => id)).size).toBe(heads(s.doc).length);
  });

  it('Enter at the start of a tag leaves the id with the tag text, not the blank line above', () => {
    let s = make(CARDS);
    s = s.apply(s.tr.insertText('x'));
    const id = heads(s.doc)[1][2];
    s = caret(s, 'First tag');
    const pos = s.selection.from;
    s = s.apply(s.tr.split(pos));
    expect(heads(s.doc).find(([, t]) => t === 'First tag')![2]).toBe(id);
    expect(heads(s.doc).filter(([, , x]) => x === id).length).toBe(1);
  });

  it('cut and paste elsewhere (a move) keeps the id', () => {
    let s = make(CARDS);
    s = s.apply(s.tr.insertText('x'));
    const id = heads(s.doc).find(([, t]) => t === 'Second tag')![2];
    const from = at(s, 'Second tag') - 1, to = s.doc.content.size;
    const cut = s.doc.slice(from, to);
    s = s.apply(s.tr.delete(from, to));
    const into = at(s, 'First tag') - 1;
    s = s.apply(s.tr.replace(into, into, new Slice(cut.content, 0, 0)));
    expect(heads(s.doc)[1]).toEqual(['tag', 'Second tag', id]);
  });

  it('copy as HTML keeps the id so a paste can tell a copy from a move', () => {
    const p = schema.nodes.paragraph.create({ style: 'tag', card: 'abc12345' }, schema.text('T'));
    const dom = schema.nodes.paragraph.spec.toDOM!(p) as [string, Record<string, string>];
    expect(dom[1]['data-card']).toBe('abc12345');
  });
});
