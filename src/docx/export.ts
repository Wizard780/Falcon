import { strToU8, zipSync } from 'fflate';
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { TableMap } from 'prosemirror-tables';
import { colWidths, schema } from '../editor/schema';
import { STYLES_XML } from './styles';

/** Paragraph style → Word style id (Verbatim uses the built-in headings for Pocket/Hat/Block/Tag). */
export const PSTYLE: Record<string, string | null> = {
  normal: null, pocket: 'Heading1', hat: 'Heading2', block: 'Heading3', tag: 'Heading4', analytic: 'Analytic', undertag: 'Undertag',
};

// characters XML 1.0 forbids (control codes, lone surrogates) are dropped so Word can always open the file
const esc = (s: string) => s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hex = (c: string) => {
  const m = c.trim().match(/^#?([0-9a-f]{6})$/i);
  if (m) return m[1].toUpperCase();
  const rgb = c.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgb) return [rgb[1], rgb[2], rgb[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('').toUpperCase();
  return 'auto';
};

function rPr(marks: readonly Mark[]): string {
  const has = (n: string) => marks.find((m) => m.type.name === n);
  // one character-style slot: cite keeps it and underline/emphasis are then written as direct formatting
  const cite = !!has('cite');
  const style = cite ? 'Style13ptBold' : has('emphasis') ? 'Emphasis' : has('underline') ? 'StyleUnderline' : '';
  const parts: string[] = [];
  if (style) parts.push(`<w:rStyle w:val="${style}"/>`);
  if (has('bold') || (cite && has('emphasis'))) parts.push('<w:b/><w:bCs/>');
  if (has('unbold')) parts.push('<w:b w:val="0"/><w:bCs w:val="0"/>');
  if (has('italic')) parts.push('<w:i/><w:iCs/>');
  if (has('strike')) parts.push('<w:strike/>');
  const color = has('color');
  if (color) parts.push(`<w:color w:val="${hex(color.attrs.color)}"/>`);
  const size = has('size');
  const pt = size ? size.attrs.pt : null;
  if (pt) parts.push(`<w:sz w:val="${Math.round(pt * 2)}"/><w:szCs w:val="${Math.round(pt * 2)}"/>`);
  const hl = has('highlight');
  if (hl) parts.push(`<w:highlight w:val="${esc(hl.attrs.color)}"/>`);
  if (cite && (has('underline') || has('emphasis'))) parts.push('<w:u w:val="single"/>');
  if (cite && has('emphasis')) parts.push('<w:bdr w:val="single" w:sz="8" w:space="0" w:color="auto"/>');
  const shd = has('shading');
  if (shd) parts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hex(shd.attrs.color)}"/>`);
  if (has('sup')) parts.push('<w:vertAlign w:val="superscript"/>');
  else if (has('sub')) parts.push('<w:vertAlign w:val="subscript"/>');
  return parts.length ? `<w:rPr>${parts.join('')}</w:rPr>` : '';
}

function runText(text: string): string {
  // tabs become <w:tab/>; everything else is a preserved-space text run
  return text
    .split('\t')
    .map((t) => (t ? `<w:t xml:space="preserve">${esc(t)}</w:t>` : ''))
    .join('<w:tab/>');
}

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** What the whole package collects while parts are written: picture files and footnotes. */
class Package {
  media = new Map<string, { name: string; own: { w: number; h: number } | null }>(); // data URL -> its file under word/media/
  files: Record<string, Uint8Array> = {};
  notes: string[] = []; // footnote XML; a note's id is its index + 1
  pics = 0; // drawing ids, unique across the file
  notesPart: Part | null = null;
}

/** One XML part (document.xml or footnotes.xml) and the relationships (links, pictures) it numbers for itself. */
class Part {
  rels = new Map<string, { id: string; type: string; target: string; external: boolean }>();
  constructor(private first: number, readonly pkg: Package) {}
  rel(type: string, target: string, external: boolean): string {
    const key = `${type} ${target}`;
    if (!this.rels.has(key)) this.rels.set(key, { id: `rId${this.rels.size + this.first}`, type, target, external });
    return this.rels.get(key)!.id;
  }
  relsXml(fixed = ''): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${fixed}${
  [...this.rels.values()].map((r) => `<Relationship Id="${r.id}" Type="${REL}/${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')
}</Relationships>`;
  }
}
const newPart = () => new Part(2, new Package());

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/tiff': 'tiff', 'image/x-emf': 'emf', 'image/x-wmf': 'wmf' };
const EMU_PX = 9525; // 914400 EMU per inch, 96 px per inch

function bytesOf(dataUrl: string): { bytes: Uint8Array; ext: string } | null {
  const m = dataUrl.match(/^data:([\w/.+-]+);base64,(.*)$/s);
  const ext = m && EXT[m[1].toLowerCase()];
  if (!m || !ext) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, ext };
}

/** A picture's own pixel size from its header (PNG, GIF, JPEG), for pictures that never had a size set. */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  if (b[0] === 0x89 && b[1] === 0x50 && b.length > 24) return { w: u32(16), h: u32(20) };
  if (b[0] === 0x47 && b[1] === 0x49 && b.length > 10) return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: (b[i + 7] << 8) | b[i + 8], h: (b[i + 5] << 8) | b[i + 6] };
      i += 2 + len;
    }
  }
  return null;
}

const cropXml = (c: { l: number; t: number; r: number; b: number } | null) => (c ? `<a:srcRect${(['l', 't', 'r', 'b'] as const).map((k) => (c[k] ? ` ${k}="${Math.round(c[k] * 100000)}"` : '')).join('')}/>` : '');

/** An in-line picture: embedded (word/media) for data URLs, a linked picture for a web address. */
function pictureXml(node: PMNode, part: Part): string {
  const src: string = node.attrs.src;
  const pkg = part.pkg;
  let blip: string;
  let own: { w: number; h: number } | null = null;
  if (src.startsWith('data:')) {
    // each picture is decoded once, however many times the document uses it
    let file = pkg.media.get(src);
    if (!file) {
      const data = bytesOf(src);
      if (!data) return '';
      file = { name: `image${pkg.media.size + 1}.${data.ext}`, own: imageSize(data.bytes) };
      pkg.media.set(src, file);
      pkg.files[`word/media/${file.name}`] = data.bytes;
    }
    blip = `r:embed="${part.rel('image', `media/${file.name}`, false)}"`;
    if (!node.attrs.width || !node.attrs.height) own = file.own;
  } else blip = `r:link="${part.rel('image', src, true)}"`;
  const w: number = node.attrs.width ?? own?.w ?? 200;
  const h: number = node.attrs.height ?? (own ? Math.round((w * own.h) / own.w) : w);
  const cx = Math.round(w * EMU_PX), cy = Math.round(h * EMU_PX);
  const id = ++pkg.pics;
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="Picture ${id}" descr="${esc(node.attrs.alt ?? '')}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip ${blip}/>${cropXml(node.attrs.crop)}<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

/** A footnote reference run; the note itself (Word's number mark, a space, then its runs) goes to footnotes.xml. */
function footnoteRun(node: PMNode, part: Part): string {
  const pkg = part.pkg;
  let content: PMNode[] = [];
  try { content = (node.attrs.content as Record<string, unknown>[]).map((j) => schema.nodeFromJSON(j)).filter((n) => n.isText || n.type.name === 'hard_break'); } catch { content = []; }
  pkg.notesPart ??= new Part(1, pkg);
  const id = pkg.notes.push('');
  pkg.notes[id - 1] = `<w:footnote w:id="${id}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>${runsXml(schema.nodes.paragraph.create(null, content), pkg.notesPart)}</w:p></w:footnote>`;
  return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
}

function runsXml(para: PMNode, part: Part): string {
  let runs = '';
  let open: string | null = null; // href of the hyperlink the runs are inside
  para.forEach((n) => {
    const href: string | null = n.marks.find((m) => m.type.name === 'link')?.attrs.href ?? null;
    if (href !== open) {
      if (open !== null) runs += '</w:hyperlink>';
      if (href !== null) runs += `<w:hyperlink r:id="${part.rel('hyperlink', href, true)}">`;
      open = href;
    }
    if (n.type.name === 'hard_break') runs += '<w:r><w:br/></w:r>';
    else if (n.type.name === 'image') runs += pictureXml(n, part);
    else if (n.type.name === 'footnote') runs += footnoteRun(n, part);
    else if (n.isText) runs += `<w:r>${rPr(n.marks)}${runText(n.text!)}</w:r>`;
  });
  if (open !== null) runs += '</w:hyperlink>';
  return runs;
}

export function paragraphXml(para: PMNode, part: Part = newPart()): string {
  const ps = PSTYLE[para.attrs.style as string];
  const ppr = [ps ? `<w:pStyle w:val="${ps}"/>` : '', para.attrs.indent ? `<w:ind w:left="${para.attrs.indent * 720}"/>` : ''].join('');
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runsXml(para, part)}</w:p>`;
}

const PAGE_TWIPS = 9360; // 6.5in of text width at 1in margins; 15 twips per CSS pixel
const borders = (on: boolean) => ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => (on ? `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="auto"/>` : `<w:${s} w:val="nil"/>`)).join('');

/** A table: column widths in tblGrid, gridSpan for column spans, vMerge for row spans, shading per cell. */
function tableXml(table: PMNode, part: Part): string {
  const map = TableMap.get(table);
  const px = colWidths(table);
  const known = px.reduce<number>((a, w) => a + (w ?? 0) * 15, 0), missing = px.filter((w) => w === null).length;
  const each = missing ? Math.max(720, Math.round((PAGE_TWIPS - known) / missing)) : 0;
  const twips = px.map((w) => (w !== null ? Math.round(w * 15) : each));
  let rows = '';
  for (let r = 0; r < map.height; r++) {
    const row = table.child(r);
    let header = row.childCount > 0;
    row.forEach((c) => { if (c.type.name !== 'table_header') header = false; });
    let cells = '';
    for (let c = 0; c < map.width;) {
      const pos = map.map[r * map.width + c];
      const cell = table.nodeAt(pos)!;
      const rect = map.findCell(pos);
      const span = rect.right - rect.left;
      const top = rect.top === r;
      const w = twips.slice(c, c + span).reduce((a, x) => a + x, 0);
      const merge = rect.bottom - rect.top > 1 ? (top ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>') : '';
      const shd = cell.attrs.background ? `<w:shd w:val="clear" w:color="auto" w:fill="${hex(cell.attrs.background)}"/>` : '';
      let body = '';
      if (top) cell.forEach((p) => { body += paragraphXml(p, part); });
      cells += `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${merge}${shd}</w:tcPr>${body || '<w:p/>'}</w:tc>`;
      c += span;
    }
    rows += `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells}</w:tr>`;
  }
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${borders(table.attrs.borders !== false)}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${twips.map((t) => `<w:gridCol w:w="${t}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>`;
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

export function documentXml(doc: PMNode, part: Part = newPart()): string {
  const body: string[] = [];
  doc.forEach((n, _o, i) => {
    // two tables in a row would merge into one in Word: a paragraph keeps them apart
    if (n.type.name === 'table' && i > 0 && doc.child(i - 1).type.name === 'table') body.push('<w:p/>');
    body.push(n.type.name === 'table' ? tableXml(n, part) : paragraphXml(n, part));
  });
  // Word wants a paragraph after a table that ends the document
  if (doc.lastChild?.type.name === 'table') body.push('<w:p/>');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const footnotesXml = (notes: string[]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes ${NS}><w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>${notes.join('')}</w:footnotes>`;
const SETTINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr></w:settings>`;

const contentTypes = (exts: string[], notes: boolean) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${
  exts.map((e) => `<Default Extension="${e}" ContentType="${Object.keys(EXT).find((k) => EXT[k] === e)}"/>`).join('')
}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${
  notes ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' : ''
}</Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

export async function docToDocx(doc: PMNode): Promise<Uint8Array> {
  let hasNotes = false;
  doc.descendants((n) => { if (n.type.name === 'footnote') hasNotes = true; return !hasNotes; });
  // rId1 is styles.xml; with footnotes, rId2 and rId3 are footnotes.xml and settings.xml
  const pkg = new Package();
  const part = new Part(hasNotes ? 4 : 2, pkg);
  const xml = documentXml(doc, part);
  const fixed = `<Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/>${hasNotes ? `<Relationship Id="rId2" Type="${REL}/footnotes" Target="footnotes.xml"/><Relationship Id="rId3" Type="${REL}/settings" Target="settings.xml"/>` : ''}`;
  const exts = [...new Set([...pkg.media.values()].map((m) => m.name.split('.').pop()!))];
  const notes: Record<string, Uint8Array> = hasNotes ? { 'word/footnotes.xml': strToU8(footnotesXml(pkg.notes)), 'word/settings.xml': strToU8(SETTINGS) } : {};
  if (pkg.notesPart?.rels.size) notes['word/_rels/footnotes.xml.rels'] = strToU8(pkg.notesPart.relsXml());
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes(exts, hasNotes)),
    '_rels/.rels': strToU8(RELS),
    'word/document.xml': strToU8(xml),
    'word/_rels/document.xml.rels': strToU8(part.relsXml(fixed)),
    'word/styles.xml': strToU8(STYLES_XML),
    ...notes,
    ...pkg.files,
  });
}
