import { strToU8, zipSync } from 'fflate';
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { STYLES_XML } from './styles';

/** Paragraph style → Word style id (Verbatim uses the built-in headings for Pocket/Hat/Block/Tag). */
export const PSTYLE: Record<string, string | null> = {
  normal: null, pocket: 'Heading1', hat: 'Heading2', block: 'Heading3', tag: 'Heading4', analytic: 'Analytic', undertag: 'Undertag',
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

export function paragraphXml(para: PMNode): string {
  const ps = PSTYLE[para.attrs.style as string];
  const ppr = [ps ? `<w:pStyle w:val="${ps}"/>` : '', para.attrs.indent ? `<w:ind w:left="${para.attrs.indent * 720}"/>` : ''].join('');
  let runs = '';
  para.forEach((n) => {
    if (n.type.name === 'hard_break') runs += '<w:r><w:br/></w:r>';
    else if (n.isText) runs += `<w:r>${rPr(n.marks)}${runText(n.text!)}</w:r>`;
  });
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runs}</w:p>`;
}

export function documentXml(doc: PMNode): string {
  const body: string[] = [];
  doc.forEach((p) => body.push(paragraphXml(p)));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

export async function docToDocx(doc: PMNode): Promise<Uint8Array> {
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    'word/document.xml': strToU8(documentXml(doc)),
    'word/_rels/document.xml.rels': strToU8(DOC_RELS),
    'word/styles.xml': strToU8(STYLES_XML),
  });
}
