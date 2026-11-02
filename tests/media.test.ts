import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { DOMSerializer } from 'prosemirror-model';
import type { DecorationSet } from 'prosemirror-view';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { docToDocx, imageSize } from '../src/docx/export';
import { docxToDoc } from '../src/docx/import';
import { createState, docFromHTML, markMap } from '../src/editor/editor';
import { findKey } from '../src/editor/find';
import { cleanPastedHTML } from '../src/editor/paste';
import { readDoc, markedDoc, sendDoc } from '../src/editor/save-modes';
import { schema } from '../src/editor/schema';
import { insertTable, evenColumns } from '../src/editor/tables';
import { footnotePlugin, insertFootnote } from '../src/editor/footnotes';
import { falconKeys as K } from '../src/editor/keymap';
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

describe('review fixes', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const docx = (body: string, extra: Record<string, string> = {}, rels = '') => zipSync({
    'word/document.xml': strToU8(`<w:document ${W}><w:body>${body}</w:body></w:document>`),
    'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`),
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, strToU8(v)])),
  });

  it('a link inside a footnote uses the footnotes part\'s own relationships', async () => {
    const bytes = docx(
      '<w:p><w:r><w:t>See</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>',
      {
        'word/footnotes.xml': `<w:footnotes ${W}><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:hyperlink r:id="rId1"><w:r><w:t>source</w:t></w:r></w:hyperlink></w:p></w:footnote></w:footnotes>`,
        'word/_rels/footnotes.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/hyperlink" Target="https://right.example/" TargetMode="External"/></Relationships>`,
      },
      `<Relationship Id="rId1" Type="${REL}/hyperlink" Target="https://wrong.example/" TargetMode="External"/>`,
    );
    const doc = await docxToDoc(bytes);
    const json = JSON.stringify(doc.toJSON());
    expect(json).toContain('https://right.example/');
    expect(json).not.toContain('wrong.example');
    // and it saves back into footnotes.xml.rels
    const p = parts(await docToDocx(doc));
    expect(p['word/_rels/footnotes.xml.rels']).toContain('https://right.example/');
  });

  it('endnotes open as footnotes, so their text is kept', async () => {
    const bytes = docx('<w:p><w:r><w:t>End</w:t></w:r><w:r><w:endnoteReference w:id="2"/></w:r></w:p>', {
      'word/endnotes.xml': `<w:endnotes ${W}><w:endnote w:type="separator" w:id="-1"><w:p/></w:endnote><w:endnote w:id="2"><w:p><w:r><w:endnoteRef/></w:r><w:r><w:t xml:space="preserve"> An endnote.</w:t></w:r></w:p></w:endnote></w:endnotes>`,
    });
    expect(markMap(await docxToDoc(bytes))).toBe('normal: End[^An endnote.]');
  });

  it('a borderless Word table stays borderless, and a crop is kept', async () => {
    const png = `data:image/png;base64,${PNG_2X3}`;
    const doc = schema.node('doc', null, [
      schema.nodes.table.create({ borders: false }, [schema.nodes.table_row.create(null, [schema.nodes.table_cell.create(null, schema.nodes.paragraph.create(null, schema.text('a')))])]),
      schema.nodes.table.create(null, [schema.nodes.table_row.create(null, [schema.nodes.table_cell.create(null, schema.nodes.paragraph.create(null, schema.text('b')))])]),
      schema.nodes.paragraph.create(null, [schema.nodes.image.create({ src: png, width: 100, height: 50, crop: { l: 0.1, t: 0, r: 0.25, b: 0.05 } })]),
    ]);
    const p = parts(await docToDocx(doc));
    expect(p['word/document.xml']).toContain('<w:top w:val="nil"/>');
    expect(p['word/document.xml']).toContain('<a:srcRect l="10000" r="25000" b="5000"/>');
    // two tables in a row stay two tables
    expect(p['word/document.xml']).toMatch(/<\/w:tbl><w:p\/><w:tbl>/);
    const back = markMap(await docxToDoc(await docToDocx(doc)));
    expect(back).toContain('table 1 rows no borders');
    expect(back).toContain('[image 100x50 crop 100,0,250,50]');
  });

  it('arrowing onto a footnote selects it without opening its editor; a click or Insert Footnote opens it', () => {
    let s = createState(schema.node('doc', null, [schema.nodes.paragraph.create(null, [schema.text('ab'), schema.nodes.footnote.create({ content: [{ type: 'text', text: 'n' }] }), schema.text('cd')])]));
    const open = () => (footnotePlugin.getState(s) as { open: boolean }).open;
    s = s.apply(s.tr.setSelection(NodeSelection.create(s.doc, 3)));
    expect(open()).toBe(false);
    s = s.apply(s.tr.setSelection(NodeSelection.create(s.doc, 3)).setMeta('pointer', true));
    expect(open()).toBe(true);
    s = s.apply(s.tr.setNodeAttribute(3, 'content', [{ type: 'text', text: 'nn' }]));
    expect(open()).toBe(true); // typing in the note keeps it open
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1)));
    expect(open()).toBe(false);
  });

  it('footnote numbers follow edits: typing keeps them, deleting one renumbers the rest', () => {
    const fn = (t: string) => schema.nodes.footnote.create({ content: [{ type: 'text', text: t }] });
    let s = createState(schema.node('doc', null, [schema.nodes.paragraph.create(null, [schema.text('a'), fn('one'), schema.text('b'), fn('two')])]));
    const nums = () => (footnotePlugin.getState(s) as { decos: DecorationSet }).decos.find().flatMap((x) => {
      const n = (x as unknown as { type: { attrs?: Record<string, string> } }).type.attrs?.['data-n'];
      return n ? [`${x.from}:${n}`] : [];
    }).sort();
    expect(nums()).toEqual(['2:1', '4:2']);
    s = s.apply(s.tr.insertText('x', 1));
    expect(nums()).toEqual(['3:1', '5:2']);
    s = s.apply(s.tr.delete(3, 4));
    expect(nums()).toEqual(['4:1']);
  });

  it('pasted HTML cannot smuggle bad footnote content or styles', () => {
    const html = `<p class="f-normal">x<sup class="f-footnote" data-content='[null,{"type":"image","attrs":{"src":"x"}},{"type":"text","text":"ok"}]'></sup></p><table><tr><td data-bg="rgb(0,0,0);position:fixed">c</td></tr></table>`;
    const doc = docFromHTML(cleanPastedHTML(html));
    expect(markMap(doc)).toBe('normal: x[^ok]\ntable 1 rows\ncell r0c0 normal: c');
  });

  it('in a table cell, Enter after a heading-styled line stays in the cell', () => {
    let s = createState(schema.node('doc', null, [
      schema.nodes.table.create(null, [schema.nodes.table_row.create(null, [schema.nodes.table_cell.create(null, schema.nodes.paragraph.create({ style: 'tag' }, schema.text('Tag')))])]),
      schema.nodes.paragraph.create(),
    ]));
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 7)));
    s = run(s, K.Enter);
    expect(markMap(s.doc)).toBe('table 1 rows\ncell r0c0 tag: Tag\ncell r0c0 normal: \nnormal: ');
  });
});

describe('copying tables out', () => {
  it('a copied table carries its lines, widths and shading inline, and still pastes back into Falcon whole', async () => {
    const { clipboardHTML } = await import('../src/editor/clipboard-styles');
    const doc = schema.node('doc', null, [
      schema.nodes.paragraph.create(null, schema.text('t')),
      schema.nodes.table.create(null, [schema.nodes.table_row.create(null, [
        schema.nodes.table_cell.create({ colwidth: [120], background: '#FFF2CC' }, schema.nodes.paragraph.create(null, schema.text('a'))),
        schema.nodes.table_cell.create(null, schema.nodes.paragraph.create(null, schema.text('b'))),
      ])]),
    ]);
    const html = clipboardHTML(doc.content);
    expect(html).toContain('border:1px solid #a3a3a8;padding:3px 6px;vertical-align:top;width:120px');
    expect(html).toMatch(/background-color: ?(#FFF2CC|rgb\(255, 242, 204\))/);
    expect(markMap(docFromHTML(cleanPastedHTML(html)))).toBe(markMap(doc));
  });
});
