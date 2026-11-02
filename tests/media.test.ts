import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { DOMSerializer } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import { docToDocx, imageSize } from '../src/docx/export';
import { docxToDoc } from '../src/docx/import';
import { createState, docFromHTML, markMap } from '../src/editor/editor';
import { findKey } from '../src/editor/find';
import { cleanPastedHTML } from '../src/editor/paste';
import { readDoc, markedDoc, sendDoc } from '../src/editor/save-modes';
import { schema } from '../src/editor/schema';
import { insertTable, evenColumns } from '../src/editor/tables';
import { insertFootnote } from '../src/editor/footnotes';
import { buildOutline, readWords } from '../src/editor/outline';
import { run } from './helpers';

const FIXTURE = new Uint8Array(fs.readFileSync('.claude/skills/verify-falcon/fixtures/media.docx'));
const PNG_2X3 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAEklEQVR4nGP4z8DAxMDAwMAAAA4gAgdLgRgVAAAAAElFTkSuQmCC';
const parts = (bytes: Uint8Array) => {
  const files = unzipSync(bytes);
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, k.startsWith('word/media/') ? v : strFromU8(v)])) as Record<string, string>;
};

describe('tables, pictures and footnotes in .docx', () => {
  it('opens a Word table with its header row, shading, column span and row merge', async () => {
    const mm = markMap(await docxToDoc(FIXTURE));
    expect(mm).toContain('table 4 rows');
    expect(mm).toContain('cell r0c0 bg#D9D9D9 head normal: [Year]{bold}');
    expect(mm).toContain('cell r1c2 1x2 normal: IPCC AR6 projections, the middle scenario');
    expect(mm).toContain('cell r3c0 2x1 bg#FFF2CC normal: [Past every threshold the card names]{underline}');
    expect(mm).toContain('cell r1c1 normal: [1.5]{highlight:cyan+underline}');
  });

  it('opens pictures at their Word size and footnotes with their text', async () => {
    const doc = await docxToDoc(FIXTURE);
    const mm = markMap(doc);
    expect(mm).toContain('normal: [image 360x203]');
    expect(mm).toContain('[^Smith, J. (2024). Climate Futures. Oxford University Press, p. 12.]');
    let italic = false;
    doc.descendants((n) => { if (n.type.name === 'footnote' && JSON.stringify(n.attrs.content).includes('"italic"')) italic = true; return true; });
    expect(italic).toBe(true); // the note keeps its formatting, not just its text
  });

  it('saves them back the way Word reads them, and reopens to the same document', async () => {
    const doc = await docxToDoc(FIXTURE);
    const out = await docToDocx(doc);
    const p = parts(out);
    const xml = p['word/document.xml'];
    expect(xml).toContain('<w:gridSpan w:val="2"/>');
    expect(xml).toContain('<w:vMerge w:val="restart"/>');
    expect(xml).toContain('<w:vMerge/>');
    expect(xml).toContain('<w:tblHeader/>');
    expect(xml).toContain('w:fill="D9D9D9"');
    expect(xml).toMatch(/<w:tblGrid><w:gridCol w:w="2400"\/><w:gridCol w:w="2400"\/><w:gridCol w:w="4560"\/><\/w:tblGrid>/);
    expect(xml).toContain(`<wp:extent cx="${360 * 9525}" cy="${203 * 9525}"/>`);
    expect(xml.match(/<w:footnoteReference w:id="\d"\/>/g)).toEqual(['<w:footnoteReference w:id="1"/>', '<w:footnoteReference w:id="2"/>']);
    // the parts Word needs: footnote separators, the picture file, and every relationship and content type
    expect(p['word/footnotes.xml']).toContain('w:type="separator" w:id="-1"');
    expect(p['word/footnotes.xml']).toContain('w:type="continuationSeparator" w:id="0"');
    expect(Object.keys(p)).toContain('word/media/image1.png');
    expect(p['[Content_Types].xml']).toContain('<Default Extension="png" ContentType="image/png"/>');
    expect(p['[Content_Types].xml']).toContain('/word/footnotes.xml');
    const rels = p['word/_rels/document.xml.rels'];
    expect(rels).toContain('Target="footnotes.xml"');
    const embed = xml.match(/r:embed="(rId\d+)"/)![1];
    expect(rels).toMatch(new RegExp(`Id="${embed}" Type="[^"]+/image" Target="media/image1.png"`));
    for (const [name, body] of Object.entries(p)) if (/\.(xml|rels)$/.test(name)) expect(new DOMParser().parseFromString(body, 'application/xml').querySelector('parsererror'), name).toBeNull();
    expect(markMap(await docxToDoc(out))).toBe(markMap(doc));
  });

  it('writes one picture file for a picture used twice, and unique drawing ids', async () => {
    const png = `data:image/png;base64,${PNG_2X3}`;
    const img = () => schema.nodes.image.create({ src: png });
    const doc = schema.node('doc', null, [schema.nodes.paragraph.create(null, [img(), schema.text(' and '), img()])]);
    const p = parts(await docToDocx(doc));
    expect(Object.keys(p).filter((k) => k.startsWith('word/media/'))).toEqual(['word/media/image1.png']);
    expect(p['word/document.xml'].match(/wp:docPr id="(\d+)"/g)).toEqual(['wp:docPr id="1"', 'wp:docPr id="2"']);
    // no size set: the picture's own 2x3 pixels
    expect(p['word/document.xml']).toContain(`<wp:extent cx="${2 * 9525}" cy="${3 * 9525}"/>`);
  });

  it('reads picture sizes from PNG, GIF and JPEG headers', () => {
    const png = Uint8Array.from(atob(PNG_2X3), (c) => c.charCodeAt(0));
    expect(imageSize(png)).toEqual({ w: 2, h: 3 });
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 5, 0, 7, 0, 0]);
    expect(imageSize(gif)).toEqual({ w: 5, h: 7 });
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 9, 0, 11, 3, 0, 0, 0, 0]);
    expect(imageSize(jpg)).toEqual({ w: 11, h: 9 });
  });

  it('a web picture that was never fetched saves as a linked picture', async () => {
    const doc = schema.node('doc', null, [schema.nodes.paragraph.create(null, [schema.nodes.image.create({ src: 'https://example.com/a.png', width: 100, height: 50 })])]);
    const p = parts(await docToDocx(doc));
    const id = p['word/document.xml'].match(/r:link="(rId\d+)"/)![1];
    expect(p['word/_rels/document.xml.rels']).toContain(`Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.com/a.png" TargetMode="External"`);
    expect(markMap(await docxToDoc(await docToDocx(doc)))).toBe('normal: [image 100x50]');
  });

  it('a document ending in a table gets the paragraph Word needs after it', async () => {
    const s = run(createState(), insertTable(2, 2));
    expect(s.doc.lastChild!.type.name).toBe('paragraph'); // Insert Table leaves a line under it
    const doc = schema.node('doc', null, [s.doc.firstChild!]);
    const xml = parts(await docToDocx(doc))['word/document.xml'];
    expect(xml).toMatch(/<\/w:tbl><w:p\/><w:sectPr>/);
  });
});

describe('editing tables, pictures and footnotes', () => {
  it('Insert Table turns an empty line into a page-wide 3 × 3 table with the cursor in the first cell', () => {
    const s = run(createState(), insertTable(3, 3));
    expect(markMap(s.doc).split('\n')[0]).toBe('table 3 rows');
    expect(markMap(s.doc).split('\n').pop()).toBe('normal: ');
    expect(s.selection.$from.node(s.selection.$from.depth - 1).type.name).toBe('table_cell');
    let widths = 0;
    s.doc.descendants((n) => { if (n.type.name === 'table_cell') widths += n.attrs.colwidth[0]; return true; });
    expect(widths).toBe(208 * 9); // 624px page split three ways, nine cells
  });

  it('Even makes every column the same width', () => {
    let s = run(createState(), insertTable(2, 2));
    const cell = s.doc.firstChild!.firstChild!.firstChild!;
    s = s.apply(s.tr.setNodeMarkup(3 - 1, null, { ...cell.attrs, colwidth: [500] }));
    s = run(s, evenColumns);
    const ws: number[] = [];
    s.doc.descendants((n) => { if (n.type.name === 'table_cell') ws.push(n.attrs.colwidth[0]); return true; });
    expect(ws).toEqual([312, 312, 312, 312]);
  });

  it('dragging an inner column edge moves the edge: the next column gives up the width, the table keeps its size', () => {
    let s = run(createState(), insertTable(2, 3));
    const widths = () => { const ws: number[] = []; s.doc.firstChild!.firstChild!.forEach((c) => ws.push(c.attrs.colwidth[0])); return ws; };
    // what the column drag commits: every cell in column 1 gets the new width
    const tr = s.tr;
    s.doc.firstChild!.forEach((row, rowOff) => {
      const pos = 1 + rowOff + 1;
      tr.setNodeMarkup(pos, null, { ...row.firstChild!.attrs, colwidth: [298] });
    });
    s = s.applyTransaction(tr).state;
    expect(widths()).toEqual([298, 118, 208]);
    // the last edge still widens the table
    const tr2 = s.tr;
    s.doc.firstChild!.forEach((row, rowOff) => {
      row.forEach((cell, off, i) => { if (i === 2) tr2.setNodeMarkup(1 + rowOff + 1 + off, null, { ...cell.attrs, colwidth: [260] }); });
    });
    s = s.applyTransaction(tr2).state;
    expect(widths()).toEqual([298, 118, 260]);
  });

  it('Insert Footnote puts a numbered reference at the cursor and selects it (its editor opens)', () => {
    let s = createState(schema.node('doc', null, [schema.nodes.paragraph.create(null, [schema.text('Smith 24')])]));
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 9)));
    s = run(s, insertFootnote);
    expect(markMap(s.doc)).toBe('normal: Smith 24[^]');
    expect((s.selection as unknown as { node?: { type: { name: string } } }).node?.type.name).toBe('footnote');
  });

  it('Find searches inside table cells and lands on the right text', async () => {
    const doc = await docxToDoc(FIXTURE);
    let s = createState(doc);
    s = s.apply(s.tr.setMeta(findKey, { query: 'middle scenario' }));
    const f = findKey.getState(s)!;
    expect(f.matches.length).toBe(1);
    expect(s.doc.textBetween(f.matches[0].from, f.matches[0].to)).toBe('middle scenario');
  });

  it('a table stays in its card: Send Doc, Read Doc and Marked Doc keep it whole', async () => {
    const doc = await docxToDoc(FIXTURE);
    for (const d of [sendDoc(doc)!, readDoc(doc)!]) expect(markMap(d)).toContain('table 4 rows');
    // the table isn't a card of its own (it has no red text, so nothing is marked)
    expect(markedDoc(doc)).toBeNull();
    expect(buildOutline(doc).map((o) => o.text)).toEqual(['Climate', 'Warming past 2 degrees causes cascading extinction']);
    // read time counts the highlighted numbers in the table
    expect(readWords(doc)).toBeGreaterThanOrEqual(readWords(schema.node('doc', null, doc.content.content.filter((n) => n.type.name !== 'table'))) + 2);
  });
});

describe('pasting tables and pictures', () => {
  it('a table pasted from Word or the web stays a table, with its spans, shading and widths', () => {
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><body><table class=MsoTableGrid><tr><td width=200 style='background:#D9D9D9;mso-x'><p class=MsoNormal>Year</p></td><td colspan=2 style='width:150.0pt'><p>Source</p></td></tr><tr><td rowspan=2><p>2030</p></td><td><p>1.5</p></td><td><p>x</p></td></tr><tr><td><p>2.1</p></td><td><p>y</p></td></tr></table></body></html>`;
    const mm = markMap(docFromHTML(cleanPastedHTML(html)));
    expect(mm).toContain('table 3 rows');
    expect(mm).toContain('cell r0c0 bg#D9D9D9 normal: Year');
    expect(mm).toContain('cell r0c1 2x1 normal: Source');
    expect(mm).toContain('cell r1c0 1x2 normal: 2030');
    const doc = docFromHTML(cleanPastedHTML(html));
    expect(doc.firstChild!.firstChild!.firstChild!.attrs.colwidth).toEqual([200]);
  });

  it('a pasted picture keeps its size; a picture from an unreadable place is left out', () => {
    const data = `data:image/png;base64,${PNG_2X3}`;
    const mm = markMap(docFromHTML(cleanPastedHTML(`<p>a<img src="${data}" style="width:120px;height:180px">b<img src="file:///C:/clip_image001.png"></p>`)));
    expect(mm).toBe('normal: a[image 120x180]b');
  });

  it('copy and paste inside Falcon carries tables, pictures and footnotes whole', () => {
    const doc = schema.node('doc', null, [
      schema.nodes.paragraph.create(null, [schema.text('see'), schema.nodes.footnote.create({ content: [{ type: 'text', text: 'Note one' }] })]),
      schema.nodes.table.create(null, [schema.nodes.table_row.create(null, [schema.nodes.table_cell.create({ background: '#FFF2CC', colwidth: [120] }, schema.nodes.paragraph.create(null, schema.text('cell')))])]),
    ]);
    const div = document.createElement('div');
    div.append(DOMSerializer.fromSchema(schema).serializeFragment(doc.content));
    expect(markMap(docFromHTML(cleanPastedHTML(div.innerHTML)))).toBe(markMap(doc));
  });
});
