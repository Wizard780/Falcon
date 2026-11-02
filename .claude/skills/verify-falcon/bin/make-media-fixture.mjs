#!/usr/bin/env node
// Writes fixtures/media.docx: a card with two footnotes, a table (header row, shading, a column span and
// a row merge), and a picture, in the XML shapes Word itself writes (wp:inline drawing, w:vMerge,
// w:gridSpan, footnotes.xml with its separators). Falcon didn't write it, so opening it tests the import.
// Usage: node .claude/skills/verify-falcon/bin/make-media-fixture.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { strToU8, zipSync } from 'fflate';

const out = path.join(path.dirname(new URL(import.meta.url).pathname), '../fixtures/media.docx');

// a 480x270 bar chart PNG, drawn pixel by pixel
function chartPng(w = 480, h = 270) {
  const px = Buffer.alloc((w * 3 + 1) * h);
  const bars = [[60, 0x3b82f6, 0.35], [170, 0x3b82f6, 0.55], [280, 0x3b82f6, 0.72], [390, 0xef4444, 0.92]];
  for (let y = 0; y < h; y++) {
    px[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      let c = 0xffffff;
      if (y === h - 30 || x === 30) c = 0x444444;
      for (const [bx, col, frac] of bars) if (x >= bx && x < bx + 70 && y < h - 30 && y > (h - 30) * (1 - frac)) c = col;
      const i = y * (w * 3 + 1) + 1 + x * 3;
      px[i] = c >> 16; px[i + 1] = (c >> 8) & 255; px[i + 2] = c & 255;
    }
  }
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(px)), chunk('IEND', Buffer.alloc(0))]);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const t = (s, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${s}</w:t></w:r>`;
const p = (runs, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${runs}</w:p>`;
const note = (id) => `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
const U = '<w:rStyle w:val="StyleUnderline"/>', HL = '<w:rStyle w:val="StyleUnderline"/><w:highlight w:val="cyan"/>';
const tc = (w, body, pr = '') => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${pr}</w:tcPr>${body}</w:tc>`;
const shd = (fill) => `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`;
const cols = [2400, 2400, 4560];

const table = `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr>`
  + `<w:tblGrid>${cols.map((c) => `<w:gridCol w:w="${c}"/>`).join('')}</w:tblGrid>`
  + `<w:tr><w:trPr><w:tblHeader/></w:trPr>${tc(cols[0], p(t('Year', '<w:b/>')), shd('D9D9D9'))}${tc(cols[1], p(t('Warming (°C)', '<w:b/>')), shd('D9D9D9'))}${tc(cols[2], p(t('Source', '<w:b/>')), shd('D9D9D9'))}</w:tr>`
  + `<w:tr>${tc(cols[0], p(t('2030')))}${tc(cols[1], p(t('1.5', HL)))}${tc(cols[2], p(t('IPCC AR6 projections, the middle scenario')), '<w:vMerge w:val="restart"/>')}</w:tr>`
  + `<w:tr>${tc(cols[0], p(t('2050')))}${tc(cols[1], p(t('2.1', HL)))}${tc(cols[2], p(''), '<w:vMerge/>')}</w:tr>`
  + `<w:tr>${tc(cols[0] + cols[1], p(t('Past every threshold the card names', U)), `<w:gridSpan w:val="2"/>${shd('FFF2CC')}`)}${tc(cols[2], p(t('Smith 24')))}</w:tr></w:tbl>`;

const emu = (px) => px * 9525;
const picture = `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${emu(360)}" cy="${emu(203)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="1" name="Picture 1" descr="Warming chart"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="chart.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId9"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(360)}" cy="${emu(203)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

const body = [
  p(t('Climate'), 'Heading3'),
  p(t('Warming past 2 degrees causes cascading extinction'), 'Heading4'),
  p(t('Smith 24', '<w:rStyle w:val="Style13ptBold"/>') + t(' – Professor of Earth Systems, Oxford') + note(1)),
  p(t('Each tenth of a degree ') + t('raises the risk of crossing', U) + t(' tipping points ', HL) + t('that feed on each other') + note(2) + t(', and the data below shows when.')),
  table,
  p(picture),
  p(t('The chart above is the card\'s own figure 3.')),
].join('');

const footnotes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes ${W}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>`
  + `<w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>${t(' Smith, J. (2024). ')}${t('Climate Futures', '<w:i/>')}${t('. Oxford University Press, p. 12.')}</w:p></w:footnote>`
  + `<w:footnote w:id="2"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>${t(' Lenton et al. 2019, "Climate tipping points", Nature 575.')}</w:p></w:footnote></w:footnotes>`;

const styles = fs.readFileSync(new URL('../../../../src/docx/styles.ts', import.meta.url), 'utf8').match(/`([\s\S]*)`/)[1];
fs.writeFileSync(out, zipSync({
  '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>`),
  '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
  'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`),
  'word/_rels/document.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/chart.png"/></Relationships>'),
  'word/styles.xml': strToU8(styles),
  'word/footnotes.xml': strToU8(footnotes),
  'word/media/chart.png': chartPng(),
}));
console.log(`wrote ${out}`);
