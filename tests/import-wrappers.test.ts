import { expect, test } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { docxToDoc } from '../src/docx/import';
import { docToDocx } from '../src/docx/export';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const docx = (body: string) => zipSync({ 'word/document.xml': strToU8(`<w:document ${NS}><w:body>${body}</w:body></w:document>`) });
const run = (t: string) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;

test('text moved with track changes on is kept, and the moved-away copy is not', async () => {
  const doc = await docxToDoc(docx(`<w:p>${run('kept ')}<w:moveFrom w:id="1">${run('OLD')}</w:moveFrom><w:moveTo w:id="2">${run('MOVED')}</w:moveTo></w:p>`));
  expect(doc.textContent).toBe('kept MOVED');
});

test('right-to-left runs are kept and survive a save', async () => {
  const doc = await docxToDoc(docx(`<w:p><w:dir w:val="rtl">${run('שלום')}</w:dir> <w:bdo w:val="rtl">${run('مرحبا')}</w:bdo></w:p>`));
  expect(doc.textContent).toBe('שלוםمرحبا');
  expect((await docxToDoc(await docToDocx(doc))).textContent).toBe('שלוםمرحبا');
});
