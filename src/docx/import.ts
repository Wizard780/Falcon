import { strFromU8, unzipSync } from 'fflate';
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { HIGHLIGHTS, schema, type ParaStyle } from '../editor/schema';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const M = schema.marks;

type StyleInfo = { name: string; alias: string; basedOn?: string; type: string; outline?: number; rpr?: Element };

const kids = (el: Element | null | undefined, name?: string) =>
  el ? Array.from(el.children).filter((c) => !name || c.localName === name) : [];
const kid = (el: Element | null | undefined, name: string) => kids(el, name)[0];
const val = (el: Element | undefined) => el?.getAttributeNS(W, 'val') ?? el?.getAttribute('w:val') ?? null;
const on = (el: Element | undefined) => !!el && !['0', 'false', 'off', 'none'].includes(val(el) ?? 'true');

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

function readStyles(xml: string | undefined): Map<string, StyleInfo> {
  const map = new Map<string, StyleInfo>();
  if (!xml) return map;
  for (const s of kids(parseXml(xml).documentElement, 'style')) {
    const id = s.getAttributeNS(W, 'styleId') ?? s.getAttribute('w:styleId');
    if (!id) continue;
    const ppr = kid(s, 'pPr');
    const ol = val(kid(ppr, 'outlineLvl'));
    map.set(id, {
      name: (val(kid(s, 'name')) ?? id).toLowerCase(),
      // alias lists in real files are long and messy ("heading 4" aliased "heading 2,Citation,..."), so only the first counts
      alias: (val(kid(s, 'aliases')) ?? '').split(',')[0].trim().toLowerCase(),
      basedOn: val(kid(s, 'basedOn')) ?? undefined,
      type: s.getAttributeNS(W, 'type') ?? s.getAttribute('w:type') ?? '',
      outline: ol == null ? undefined : Number(ol),
      rpr: kid(s, 'rPr'),
    });
  }
  return map;
}

/** Walk a style and the styles it's based on. */
function* chain(styles: Map<string, StyleInfo>, id: string | null) {
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const s = styles.get(id);
    if (!s) return;
    yield [id, s] as const;
    id = s.basedOn ?? null;
  }
}

const PARA_BY_ID: Record<string, ParaStyle> = { heading1: 'pocket', heading2: 'hat', heading3: 'block', heading4: 'tag', analytic: 'analytic', undertag: 'undertag' };
function paraByName(n: string): ParaStyle | null {
  if (/^analytic/.test(n)) return 'analytic';
  if (/^undertag/.test(n)) return 'undertag';
  if (/^heading ?1$|^pocket$/.test(n)) return 'pocket';
  if (/^heading ?2$|^hat$/.test(n)) return 'hat';
  if (/^heading ?3$|^block$/.test(n)) return 'block';
  if (/^heading ?4$|^tag$/.test(n)) return 'tag';
  return null;
}

function paraStyleOf(styles: Map<string, StyleInfo>, id: string | null, ppr: Element | undefined): ParaStyle {
  for (const [sid, s] of chain(styles, id)) {
    const hit = PARA_BY_ID[sid.toLowerCase()] ?? paraByName(s.name) ?? paraByName(s.alias);
    if (hit) return hit;
    if (s.outline != null && s.outline <= 3) return (['pocket', 'hat', 'block', 'tag'] as const)[s.outline];
  }
  const ol = val(kid(ppr, 'outlineLvl'));
  if (ol != null && Number(ol) <= 3) return (['pocket', 'hat', 'block', 'tag'] as const)[Number(ol)];
  return 'normal';
}

type CharKind = 'cite' | 'underline' | 'emphasis' | null;
const CHAR_BY_ID: Record<string, CharKind> = { style13ptbold: 'cite', cite: 'cite', styleunderline: 'underline', underline: 'underline', emphasis: 'emphasis' };
function charByName(n: string): CharKind {
  if (/^emphasis$/.test(n)) return 'emphasis';
  if (/^(style )?underline/.test(n)) return 'underline';
  if (/^cite$|^style 13 ?pt bold$/.test(n)) return 'cite';
  return null;
}
function charStyleOf(styles: Map<string, StyleInfo>, id: string | null): CharKind {
  for (const [sid, s] of chain(styles, id)) {
    const hit = CHAR_BY_ID[sid.toLowerCase()] ?? charByName(s.name) ?? charByName(s.alias);
    if (hit) return hit;
    // unknown custom style: judge by its look
    const r = s.rpr;
    if (r) {
      const u = kid(r, 'u');
      const uOn = !!u && val(u) !== 'none' && val(u) !== '0';
      if (kid(r, 'bdr') && uOn) return 'emphasis';
      if (uOn) return 'underline';
    }
  }
  return null;
}

const HL_NAMES = new Set(Object.keys(HIGHLIGHTS));

/** Relationship id → URL for the document's external hyperlinks. */
function readLinks(xml: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!xml) return map;
  for (const r of Array.from(parseXml(xml).documentElement.children)) {
    const id = r.getAttribute('Id'), target = r.getAttribute('Target');
    if (id && target && r.getAttribute('TargetMode') === 'External' && /\/hyperlink$/.test(r.getAttribute('Type') ?? '')) map.set(id, target);
  }
  return map;
}

function runMarks(styles: Map<string, StyleInfo>, rpr: Element | undefined, paraStyle: ParaStyle, cache: Map<string, CharKind>): Mark[] {
  const marks: Mark[] = [];
  if (!rpr) return marks;
  const rs = val(kid(rpr, 'rStyle'));
  let kind: CharKind = null;
  if (rs) {
    if (!cache.has(rs)) cache.set(rs, charStyleOf(styles, rs));
    kind = cache.get(rs)!;
  }
  const u = kid(rpr, 'u');
  const uOn = !!u && val(u) !== 'none' && val(u) !== '0';
  const emph = kind === 'emphasis' || (!!kid(rpr, 'bdr') && uOn && kind !== 'underline');
  if (emph) marks.push(M.emphasis.create());
  else if (kind === 'underline' || uOn) marks.push(M.underline.create());
  if (kind === 'cite') marks.push(M.cite.create());
  const b = kid(rpr, 'b');
  if (b) {
    const boldDefault = (paraStyle !== 'normal' && paraStyle !== 'undertag') || kind === 'cite' || emph;
    if (on(b) && !boldDefault) marks.push(M.bold.create());
    else if (!on(b) && boldDefault) marks.push(M.unbold.create());
  }
  if (on(kid(rpr, 'i'))) marks.push(M.italic.create());
  if (on(kid(rpr, 'strike'))) marks.push(M.strike.create());
  const hl = val(kid(rpr, 'highlight'));
  if (hl && hl !== 'none' && HL_NAMES.has(hl)) marks.push(M.highlight.create({ color: hl }));
  const shd = kid(rpr, 'shd');
  const fill = shd?.getAttributeNS(W, 'fill') ?? shd?.getAttribute('w:fill');
  if (fill && /^[0-9a-f]{6}$/i.test(fill) && fill.toUpperCase() !== 'FFFFFF') marks.push(M.shading.create({ color: `#${fill.toUpperCase()}` }));
  const color = val(kid(rpr, 'color'));
  if (color && /^[0-9a-f]{6}$/i.test(color) && color !== '000000') marks.push(M.color.create({ color: `#${color.toUpperCase()}` }));
  const sz = Number(val(kid(rpr, 'sz')));
  if (sz) {
    const pt = sz / 2;
    const natural = paraStyle === 'normal' || paraStyle === 'undertag' ? (kind === 'cite' ? 13 : 11) : null;
    if (natural !== null && pt !== natural) marks.push(M.size.create({ pt }));
  }
  const va = val(kid(rpr, 'vertAlign'));
  if (va === 'superscript') marks.push(M.sup.create());
  else if (va === 'subscript') marks.push(M.sub.create());
  return marks;
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/x-emf', wmf: 'image/x-wmf' };
const EMU_PX = 9525; // 914400 EMU per inch, 96 px per inch

function dataUrl(bytes: Uint8Array, mime: string): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

/** Relationship id → target, for images (embedded file under word/, or an external link). */
function readImageRels(xml: string | undefined, files: Record<string, Uint8Array>): Map<string, string> {
  const map = new Map<string, string>();
  if (!xml) return map;
  for (const r of Array.from(parseXml(xml).documentElement.children)) {
    const id = r.getAttribute('Id'), target = r.getAttribute('Target');
    if (!id || !target || !/\/image$/.test(r.getAttribute('Type') ?? '')) continue;
    if (r.getAttribute('TargetMode') === 'External') { if (/^https?:\/\//i.test(target)) map.set(id, target); continue; }
    const path = target.startsWith('/') ? target.slice(1) : `word/${target.replace(/^\.\//, '')}`;
    const bytes = files[path];
    const mime = MIME[path.split('.').pop()!.toLowerCase()];
    if (bytes && mime) map.set(id, dataUrl(bytes, mime));
  }
  return map;
}

const descendant = (el: Element, name: string) => el.getElementsByTagNameNS('*', name)[0] as Element | undefined;
const rAttr = (el: Element | undefined, name: string) => el?.getAttributeNS(R, name) ?? el?.getAttribute(`r:${name}`) ?? null;

/** A picture from a <w:drawing> (DrawingML, inline or floating) or a <w:pict> (older VML). Null for shapes and charts. */
function readPicture(el: Element, images: Map<string, string>): PMNode | null {
  if (el.localName === 'drawing') {
    const blip = descendant(el, 'blip');
    const src = images.get(rAttr(blip, 'embed') ?? '') ?? images.get(rAttr(blip, 'link') ?? '');
    if (!src) return null;
    const ext = descendant(el, 'extent');
    const cx = Number(ext?.getAttribute('cx')), cy = Number(ext?.getAttribute('cy'));
    const alt = descendant(el, 'docPr')?.getAttribute('descr') ?? '';
    return schema.nodes.image.create({ src, alt, width: cx > 0 ? Math.round(cx / EMU_PX) : null, height: cy > 0 ? Math.round(cy / EMU_PX) : null });
  }
  const data = descendant(el, 'imagedata');
  const src = images.get(rAttr(data, 'id') ?? '');
  if (!src) return null;
  const style = descendant(el, 'shape')?.getAttribute('style') ?? '';
  const len = (k: string) => {
    const m = style.match(new RegExp(`(?:^|;)\\s*${k}:\\s*([\\d.]+)(pt|px|in)`));
    return m ? Math.round(Number(m[1]) * (m[2] === 'pt' ? 96 / 72 : m[2] === 'in' ? 96 : 1)) : null;
  };
  return schema.nodes.image.create({ src, width: len('width'), height: len('height') });
}

type Footnotes = Map<string, Element>;
function readFootnotes(xml: string | undefined): Footnotes {
  const map: Footnotes = new Map();
  if (!xml) return map;
  for (const f of kids(parseXml(xml).documentElement, 'footnote')) {
    const type = f.getAttributeNS(W, 'type') ?? f.getAttribute('w:type');
    const id = f.getAttributeNS(W, 'id') ?? f.getAttribute('w:id');
    if (id && (!type || type === 'normal')) map.set(id, f);
  }
  return map;
}

/** Convert a .docx (zip bytes) into a Falcon document. */
export async function docxToDoc(data: Uint8Array): Promise<PMNode> {
  const files = unzipSync(data, { filter: (f) => f.name === 'word/document.xml' || f.name === 'word/styles.xml' || f.name === 'word/_rels/document.xml.rels' || f.name === 'word/footnotes.xml' || f.name === 'word/_rels/footnotes.xml.rels' || f.name.startsWith('word/media/') || f.name.startsWith('media/') });
  const docXml = files['word/document.xml'];
  if (!docXml) throw new Error('not a Word document');
  const str = (name: string) => (files[name] ? strFromU8(files[name]) : undefined);
  const styles = readStyles(str('word/styles.xml'));
  const links = readLinks(str('word/_rels/document.xml.rels'));
  const images = readImageRels(str('word/_rels/document.xml.rels'), files);
  const noteImages = readImageRels(str('word/_rels/footnotes.xml.rels'), files);
  const notes = readFootnotes(str('word/footnotes.xml'));
  const body = kid(parseXml(strFromU8(docXml)).documentElement, 'body');
  const cache = new Map<string, CharKind>();
  const pstyleCache = new Map<string, ParaStyle>();

  const styleOf = (ppr: Element | undefined): ParaStyle => {
    const ps = val(kid(ppr, 'pStyle'));
    const key = ps ?? '';
    let style = pstyleCache.get(key);
    if (!style || kid(ppr, 'outlineLvl')) {
      style = paraStyleOf(styles, ps, ppr);
      if (!kid(ppr, 'outlineLvl')) pstyleCache.set(key, style);
    }
    return style;
  };

  /** A paragraph's inline content: text runs, breaks, links, pictures and footnote references. */
  const readInline = (p: Element, style: ParaStyle, pics: Map<string, string>, inNote: boolean, boxes?: PMNode[]): PMNode[] => {
    const inline: PMNode[] = [];
    const readRuns = (parent: Element, link: Mark | null) => {
      for (const c of kids(parent)) {
        const ln = c.localName;
        if (ln === 'r') {
          const marks = runMarks(styles, kid(c, 'rPr'), style, cache);
          if (link) marks.push(link);
          let text = '';
          const flush = () => { if (text) { inline.push(schema.text(text, marks)); text = ''; } };
          const readRun = (run: Element) => {
            for (const t of kids(run)) {
              const tl = t.localName;
              if (tl === 't') text += t.textContent ?? '';
              else if (tl === 'tab') text += '\t';
              else if (tl === 'noBreakHyphen') text += '‑';
              else if (tl === 'sym') text += String.fromCharCode(parseInt(t.getAttributeNS(W, 'char') ?? '20', 16));
              else if (tl === 'br' || tl === 'cr') {
                const type = t.getAttributeNS(W, 'type');
                if (type === 'page' || type === 'column') continue;
                flush();
                inline.push(schema.nodes.hard_break.create());
              } else if (tl === 'drawing' || tl === 'pict') {
                const pic = readPicture(t, pics);
                if (pic) { flush(); inline.push(link ? pic.mark([link]) : pic); }
                else if (boxes) {
                  // a text box: Falcon has no floating boxes, so its text comes out as paragraphs after this one
                  const box = descendant(t, 'txbxContent');
                  if (box) readBlocks(box, boxes, true);
                }
              } else if (tl === 'AlternateContent') {
                // Word writes a modern picture and an older fallback: read the first one that gives anything
                for (const alt of kids(t)) {
                  const before = inline.length + (boxes?.length ?? 0);
                  readRun(alt);
                  if (inline.length + (boxes?.length ?? 0) > before) break;
                }
              } else if (tl === 'footnoteReference' && !inNote) {
                const note = notes.get(t.getAttributeNS(W, 'id') ?? t.getAttribute('w:id') ?? '');
                if (note) { flush(); inline.push(schema.nodes.footnote.create({ content: noteContent(note) })); }
              }
            }
          };
          readRun(c);
          flush();
        } else if (ln === 'hyperlink') {
          // links to a web address (through the relationships file); links to a bookmark in the file stay plain text
          const href = links.get(c.getAttributeNS(R, 'id') ?? c.getAttribute('r:id') ?? '');
          readRuns(c, href ? M.link.create({ href }) : link);
        } else if (ln === 'smartTag' || ln === 'ins' || ln === 'fldSimple' || ln === 'customXml' || ln === 'sdtContent') {
          readRuns(c, link);
        } else if (ln === 'sdt') {
          readRuns(kid(c, 'sdtContent') ?? c, link);
        }
      }
    };
    readRuns(p, null);
    return inline;
  };

  /** A footnote's paragraphs as one run of text, joined by line breaks; Word's own leading space after the number goes. */
  const noteContent = (note: Element) => {
    const out: PMNode[] = [];
    kids(note, 'p').forEach((p, i) => {
      if (i > 0) out.push(schema.nodes.hard_break.create());
      out.push(...readInline(p, 'normal', noteImages, true).filter((n) => n.type.name !== 'image'));
    });
    const first = out[0];
    if (first?.isText && first.text!.startsWith(' ')) out[0] = first.text!.length > 1 ? schema.text(first.text!.slice(1), first.marks) : null!;
    return out.filter(Boolean).map((n) => n.toJSON());
  };

  const readPara = (p: Element, out: PMNode[]) => {
    const ppr = kid(p, 'pPr');
    const style = styleOf(ppr);
    const ind = kid(ppr, 'ind');
    const left = Number(ind?.getAttributeNS(W, 'left') ?? ind?.getAttributeNS(W, 'start') ?? ind?.getAttribute('w:left') ?? 0);
    const indent = left > 0 ? Math.min(8, Math.round(left / 720)) : 0;
    const boxes: PMNode[] = [];
    out.push(schema.nodes.paragraph.create({ style, indent }, readInline(p, style, images, false, boxes)), ...boxes);
  };

  /** Block content: paragraphs, with content controls opened up and (inside a cell) nested tables flattened. */
  const readBlocks = (el: Element, out: PMNode[], flattenTables: boolean) => {
    for (const c of kids(el)) {
      if (c.localName === 'p') readPara(c, out);
      else if (c.localName === 'tbl') {
        if (flattenTables) { for (const tr of kids(c, 'tr')) for (const tc of kids(tr, 'tc')) readBlocks(tc, out, true); }
        else { const t = readTable(c); if (t) out.push(t); }
      } else if (c.localName === 'sdt') readBlocks(kid(c, 'sdtContent') ?? c, out, flattenTables);
      else if (c.localName === 'customXml') readBlocks(c, out, flattenTables);
    }
  };

  /** A Word table: grid widths, column spans (gridSpan), row spans (vMerge), cell shading and header rows. */
  const readTable = (tbl: Element): PMNode | null => {
    const grid = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => Math.round(Number(g.getAttributeNS(W, 'w') ?? g.getAttribute('w:w') ?? 0) / 15));
    type Cell = { attrs: Record<string, unknown>; header: boolean; paras: PMNode[] };
    const rows: Cell[][] = [];
    const open: (Cell | null)[] = []; // per grid column: the cell a vertical merge continues
    const rowEls: Element[] = [];
    const collectRows = (el: Element) => { for (const c of kids(el)) { if (c.localName === 'tr') rowEls.push(c); else if (c.localName === 'sdt' || c.localName === 'customXml') collectRows(kid(c, 'sdtContent') ?? c); } };
    collectRows(tbl);
    for (const tr of rowEls) {
      const header = !!kid(kid(tr, 'trPr'), 'tblHeader');
      const row: Cell[] = [];
      let col = Number(val(kid(kid(tr, 'trPr'), 'gridBefore')) ?? 0) || 0;
      const cellEls: Element[] = [];
      const collectCells = (el: Element) => { for (const c of kids(el)) { if (c.localName === 'tc') cellEls.push(c); else if (c.localName === 'sdt' || c.localName === 'customXml') collectCells(kid(c, 'sdtContent') ?? c); } };
      collectCells(tr);
      for (const tc of cellEls) {
        const pr = kid(tc, 'tcPr');
        const span = Math.max(1, Number(val(kid(pr, 'gridSpan'))) || 1);
        const vm = kid(pr, 'vMerge');
        const vmVal = vm ? val(vm) ?? 'continue' : null;
        if (vmVal === 'continue' && open[col]) {
          (open[col]!.attrs.rowspan as number)++;
          col += span;
          continue;
        }
        const paras: PMNode[] = [];
        readBlocks(tc, paras, true);
        if (!paras.length) paras.push(schema.nodes.paragraph.create());
        const fill = kid(pr, 'shd')?.getAttributeNS(W, 'fill') ?? kid(pr, 'shd')?.getAttribute('w:fill');
        const widths = grid.slice(col, col + span);
        const cell: Cell = {
          header, paras,
          attrs: { colspan: span, rowspan: 1, colwidth: widths.length === span && widths.every((w) => w > 0) ? widths : null, background: fill && /^[0-9a-f]{6}$/i.test(fill) && fill.toUpperCase() !== 'FFFFFF' ? `#${fill.toUpperCase()}` : null },
        };
        for (let k = 0; k < span; k++) open[col + k] = vmVal === 'restart' ? cell : null;
        row.push(cell);
        col += span;
      }
      if (row.length) rows.push(row);
    }
    if (!rows.length) return null;
    const T = schema.nodes;
    return T.table.create(null, rows.map((r) => T.table_row.create(null, r.map((c) => (c.header ? T.table_header : T.table_cell).create(c.attrs, c.paras)))));
  };

  const blocks: PMNode[] = [];
  if (body) readBlocks(body, blocks, false);
  if (!blocks.length) blocks.push(schema.nodes.paragraph.create());
  return schema.node('doc', null, blocks);
}
