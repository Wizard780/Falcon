import { strToU8, zipSync } from 'fflate';
import type { Mark, Node as PMNode } from 'prosemirror-model';
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

/** Link targets, numbered as relationships of document.xml (rId1 is styles.xml). */
type Links = Map<string, string>;
const linkId = (links: Links, href: string) => {
  if (!links.has(href)) links.set(href, `rId${links.size + 2}`);
  return links.get(href)!;
};

export function paragraphXml(para: PMNode, links: Links = new Map()): string {
  const ps = PSTYLE[para.attrs.style as string];
  const ppr = [ps ? `<w:pStyle w:val="${ps}"/>` : '', para.attrs.indent ? `<w:ind w:left="${para.attrs.indent * 720}"/>` : ''].join('');
  let runs = '';
  let open: string | null = null; // href of the hyperlink the runs are inside
  para.forEach((n) => {
    const href: string | null = n.marks.find((m) => m.type.name === 'link')?.attrs.href ?? null;
    if (href !== open) {
      if (open !== null) runs += '</w:hyperlink>';
      if (href !== null) runs += `<w:hyperlink r:id="${linkId(links, href)}">`;
      open = href;
    }
    if (n.type.name === 'hard_break') runs += '<w:r><w:br/></w:r>';
    else if (n.isText) runs += `<w:r>${rPr(n.marks)}${runText(n.text!)}</w:r>`;
  });
  if (open !== null) runs += '</w:hyperlink>';
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runs}</w:p>`;
}

export function documentXml(doc: PMNode, links: Links = new Map()): string {
  const body: string[] = [];
  doc.forEach((p) => body.push(paragraphXml(p, links)));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const docRels = (links: Links) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${
  [...links].map(([href, id]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(href)}" TargetMode="External"/>`).join('')
}</Relationships>`;

export async function docToDocx(doc: PMNode): Promise<Uint8Array> {
  const links: Links = new Map();
  const xml = documentXml(doc, links);
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    'word/document.xml': strToU8(xml),
    'word/_rels/document.xml.rels': strToU8(docRels(links)),
    'word/styles.xml': strToU8(STYLES_XML),
  });
}
