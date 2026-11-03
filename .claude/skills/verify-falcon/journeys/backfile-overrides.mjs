// A backfile whose runs switch their style's underline or box off, and whose cites and shrunk text use
// character styles Falcon has no name for ("Heading 4 Char", "Strong", "8-point small"): open it through
// Open…, check the page shows what Word shows, save, reopen the download in a fresh browser, compare.
import fs from 'node:fs';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { openFalcon } from '../lib/falcon.mjs';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const STYLES = `<w:styles ${NS}>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:link w:val="Heading4Char"/><w:pPr><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Heading4Char"><w:name w:val="Heading 4 Char"/><w:link w:val="Heading4"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="StyleUnderline"><w:name w:val="Style Underline"/><w:rPr><w:b w:val="0"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/><w:rPr><w:b/><w:u w:val="single"/><w:bdr w:val="single" w:sz="8" w:space="0" w:color="auto"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="character" w:customStyle="1" w:styleId="8-pointsmall"><w:name w:val="8-point small"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>
</w:styles>`;
const r = (text, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const body = [
  `<w:p><w:pPr><w:pStyle w:val="Heading4"/></w:pPr>${r('Wars are rare')}</w:p>`,
  `<w:p>${r('Kenny', '<w:rStyle w:val="Heading4Char"/>')}${r(' 20, Center for Global Development')}</w:p>`,
  `<w:p>${[
    r('the ', '<w:rStyle w:val="StyleUnderline"/>'),
    r('global decline', '<w:rStyle w:val="Emphasis"/><w:highlight w:val="cyan"/>'),
    r(' since 1975 fewer conflicts', '<w:rStyle w:val="StyleUnderline"/><w:sz w:val="16"/><w:u w:val="none"/>'),
    r(' plainly', '<w:rStyle w:val="Strong"/>'),
    r(' shrunk aside', '<w:rStyle w:val="Emphasis"/><w:b w:val="0"/><w:sz w:val="16"/><w:u w:val="none"/><w:bdr w:val="none"/>'),
    r(' small print', '<w:rStyle w:val="8-pointsmall"/>'),
  ].join('')}</w:p>`,
].join('');

const f = await openFalcon('backfile-overrides');
const { page, want } = f;
const file = path.join(f.out, 'backfile.docx');
fs.writeFileSync(file, zipSync({
  'word/document.xml': strToU8(`<w:document ${NS}><w:body>${body}</w:body></w:document>`),
  'word/styles.xml': strToU8(STYLES),
}));
await f.open(file);
const opened = await f.markMap();
fs.writeFileSync(`${f.out}/opened.markmap.txt`, opened + '\n');
/** The page's classes on the span holding `text` (what the user sees), e.g. "f-underline". */
const shown = (text) => page.evaluate((text) => {
  const span = [...document.querySelectorAll('.ProseMirror:not(.hm-doc) span, .ProseMirror:not(.hm-doc) strong')].filter((s) => s.textContent.includes(text)).pop();
  if (!span) return null;
  const out = [];
  for (let e = span; e && !e.matches('p'); e = e.parentElement) out.push(e.tagName === 'STRONG' ? 'bold' : e.className);
  return out.join(' ');
}, text);
want(!/underline|emphasis/.test(await shown('since 1975') ?? 'x'), 'text whose run turns underline off is not underlined');
want(/f-emphasis/.test(await shown('global decline') ?? ''), 'a normal Emphasis run is still boxed');
want(!/underline|emphasis/.test(await shown('shrunk aside') ?? 'x'), 'shrunk Emphasis with underline and box off is plain');
want(/bold/.test(await shown('Kenny') ?? '') && /f-size/.test(await shown('Kenny') ?? ''), '"Heading 4 Char" cite is bold and 13pt');
want(/bold/.test(await shown('plainly') ?? ''), '"Strong" is bold');
want(/f-size/.test(await shown('small print') ?? ''), '"8-point small" is shrunk');
await f.shot('opened');

const saved = await f.save('backfile-saved.docx');
await f.done();

const g = await openFalcon('backfile-overrides/reopen');
await g.open(saved);
const reopened = await g.markMap();
fs.writeFileSync(`${g.out}/reopened.markmap.txt`, reopened + '\n');
g.want(reopened === opened, 'the saved file reopens with the same marks');
await g.shot('reopened');
await g.done();
