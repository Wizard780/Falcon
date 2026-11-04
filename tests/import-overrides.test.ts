import { expect, test } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import type { Node as PMNode } from 'prosemirror-model';
import { docToDocx } from '../src/docx/export';
import { docxToDoc } from '../src/docx/import';
import { markMap } from '../src/editor/editor';

// Backfiles from other teams: what Word shows for runs whose own formatting overrides their style, and for
// character styles Falcon has no name for. Style sheet trimmed from real files (Verbatim + Word's own).
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const STYLES = `<w:styles ${NS}>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:link w:val="Heading4Char"/><w:pPr><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Heading4Char"><w:name w:val="Heading 4 Char"/><w:link w:val="Heading4"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="StyleUnderline"><w:name w:val="Style Underline"/><w:rPr><w:b w:val="0"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/><w:rPr><w:b/><w:u w:val="single"/><w:bdr w:val="single" w:sz="8" w:space="0" w:color="auto"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/><w:bCs/></w:rPr></w:style>
<w:style w:type="character" w:customStyle="1" w:styleId="8-pointsmall"><w:name w:val="8-point small"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>
</w:styles>`;
const docx = (body: string) => zipSync({
  'word/document.xml': strToU8(`<w:document ${NS}><w:body>${body}</w:body></w:document>`),
  'word/styles.xml': strToU8(STYLES),
});
const r = (text: string, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (runs: string, style = '') => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${runs}</w:p>`;

/** The marks on the text holding `text` (runs with the same marks join into one), e.g. "underline size(8)". */
function marksOf(doc: PMNode, text: string): string {
  let out: string | null = null;
  doc.descendants((n) => {
    if (out === null && n.isText && n.text!.includes(text)) out = n.marks.map((m) => m.type.name + (m.attrs.color ? `(${m.attrs.color})` : m.attrs.pt ? `(${m.attrs.pt})` : '')).join(' ');
    return out === null;
  });
  if (out === null) throw new Error(`no run "${text}"`);
  return out;
}

test('a run that switches its style\'s underline or box off shows without it', async () => {
  const doc = await docxToDoc(docx(p([
    r('read', '<w:rStyle w:val="StyleUnderline"/>'),
    r(' unread', '<w:rStyle w:val="StyleUnderline"/><w:u w:val="none"/>'),
    r(' boxed', '<w:rStyle w:val="Emphasis"/>'),
    r(' shrunk', '<w:rStyle w:val="Emphasis"/><w:b w:val="0"/><w:sz w:val="16"/><w:u w:val="none"/><w:bdr w:val="none"/>'),
    r(' still boxed', '<w:rStyle w:val="Emphasis"/><w:highlight w:val="cyan"/><w:u w:val="none"/>'),
    r(' unboxed', '<w:rStyle w:val="Emphasis"/><w:bdr w:val="none" w:sz="0" w:space="0" w:color="auto"/>'),
    r(' direct', '<w:u w:val="single"/><w:bdr w:val="nil"/>'),
  ].join(''))));
  expect(marksOf(doc, 'read')).toBe('underline');
  expect(marksOf(doc, ' unread')).toBe('');
  expect(marksOf(doc, ' boxed')).toBe('emphasis');
  expect(marksOf(doc, ' shrunk')).toBe('size(8)');
  expect(marksOf(doc, ' still boxed')).toBe('emphasis highlight(cyan)'); // Word still draws the box
  expect(marksOf(doc, ' unboxed')).toBe('underline');
  expect(marksOf(doc, ' direct')).toBe('underline');
});

test('character styles Falcon has no name for keep the bold, size and italic Word shows', async () => {
  const doc = await docxToDoc(docx([
    p(r('Smith', '<w:rStyle w:val="Heading4Char"/>') + r(' 24, Professor', '') + r(' strong', '<w:rStyle w:val="Strong"/>') + r(' small', '<w:rStyle w:val="8-pointsmall"/>') + r(' own size', '<w:rStyle w:val="8-pointsmall"/><w:sz w:val="22"/>')),
    p(r('Tag with ') + r('tagword', '<w:rStyle w:val="Strong"/>'), 'Heading4'),
  ].join('')));
  expect(marksOf(doc, 'Smith')).toBe('size(13) bold');
  expect(marksOf(doc, ' strong')).toBe('bold');
  expect(marksOf(doc, ' small')).toBe('size(8)');
  expect(marksOf(doc, ' own size')).toBe(''); // the run's own 11pt beats the style's 8pt
  expect(marksOf(doc, 'tagword')).toBe(''); // a tag is bold already
});

test('what opens is what saves', async () => {
  const doc = await docxToDoc(docx(p(r('a', '<w:rStyle w:val="StyleUnderline"/><w:u w:val="none"/>') + r('b', '<w:rStyle w:val="Strong"/>') + r('c', '<w:rStyle w:val="Emphasis"/><w:bdr w:val="none"/>'))));
  expect(markMap(await docxToDoc(await docToDocx(doc)))).toBe(markMap(doc));
});
