import { strFromU8, unzipSync } from 'fflate';
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { HIGHLIGHTS, DEEP_TURQUOISE_UNDER, schema, type ParaStyle } from '../editor/schema';
import { parseXml, type XEl } from './xml';

type Element = XEl;

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const M = schema.marks;

type StyleInfo = { name: string; alias: string; basedOn?: string; type: string; outline?: number; rpr?: Element };

const NONE: Element[] = [];
const kids = (el: Element | null | undefined, name?: string): Element[] =>
  !el ? NONE : !name ? el.children : el.children.filter((c) => c.localName === name);
const kid = (el: Element | null | undefined, name: string): Element | undefined => {
  if (el) for (const c of el.children) if (c.localName === name) return c;
  return undefined;
};
const val = (el: Element | undefined) => el?.getAttributeNS(W, 'val') ?? el?.getAttribute('w:val') ?? null;
const on = (el: Element | undefined) => !!el && !['0', 'false', 'off', 'none'].includes(val(el) ?? 'true');

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

/** Each paragraph style's own size in points, as styles.ts writes it. */
const STYLE_PT: Record<ParaStyle, number> = { normal: 11, undertag: 11, pocket: 26, hat: 22, block: 16, tag: 13, analytic: 13 };

type CharKind = 'cite' | 'underline' | 'emphasis' | null;
/** A character style as runs see it: its kind, whether it draws a box, and for a style of no kind ("Strong",
 *  "8-point small", "Heading 4 Char") the bold, italic, size and color it gives, nearest in its chain first. */
type CharStyle = { kind: CharKind; box?: boolean; look: Partial<Record<'b' | 'i' | 'sz' | 'color', Element>> };
const CHAR_BY_ID: Record<string, CharKind> = { style13ptbold: 'cite', cite: 'cite', styleunderline: 'underline', underline: 'underline', emphasis: 'emphasis' };
function charByName(n: string): CharKind {
  if (/^emphasis$/.test(n)) return 'emphasis';
  if (/^(style )?underline/.test(n)) return 'underline';
  if (/^cite$|^style 13 ?pt bold$/.test(n)) return 'cite';
  return null;
}
const uIsOn = (u: Element | undefined) => !!u && val(u) !== 'none' && val(u) !== '0';
/** A border's state: true for a box, false for one switched off (none/nil), undefined when not set. */
const boxOf = (bdr: Element | undefined) => (bdr ? !['none', 'nil'].includes(val(bdr) ?? '') : undefined);
function charStyleOf(styles: Map<string, StyleInfo>, id: string | null): CharStyle {
  const look: CharStyle['look'] = {};
  let box: boolean | undefined;
  for (const [sid, s] of chain(styles, id)) {
    box ??= boxOf(kid(s.rpr, 'bdr'));
    const hit = CHAR_BY_ID[sid.toLowerCase()] ?? charByName(s.name) ?? charByName(s.alias);
    if (hit) return { kind: hit, box, look: {} };
    // unknown custom style: judge by its look
    const r = s.rpr;
    if (r) {
      const u = kid(r, 'u');
      if (box && uIsOn(u)) return { kind: 'emphasis', box, look: {} };
      if (uIsOn(u)) return { kind: 'underline', box, look: {} };
      for (const k of ['b', 'i', 'sz', 'color'] as const) look[k] ??= kid(r, k);
    }
  }
  return { kind: null, look };
}

const HL_NAMES = new Set(Object.keys(HIGHLIGHTS));

/** Relationship id → URL for the document's external hyperlinks. */
function readLinks(xml: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!xml) return map;
  for (const r of parseXml(xml).documentElement.children) {
    const id = r.getAttribute('Id'), target = r.getAttribute('Target');
    if (id && target && r.getAttribute('TargetMode') === 'External' && /\/hyperlink$/.test(r.getAttribute('Type') ?? '')) map.set(id, target);
  }
  return map;
}

const NO_STYLE: CharStyle = { kind: null, look: {} };
function runMarks(styles: Map<string, StyleInfo>, rpr: Element | undefined, paraStyle: ParaStyle, cache: Map<string, CharStyle>): Mark[] {
  const marks: Mark[] = [];
  if (!rpr) return marks;
  const rs = val(kid(rpr, 'rStyle'));
  let style = NO_STYLE;
  if (rs) {
    if (!cache.has(rs)) cache.set(rs, charStyleOf(styles, rs));
    style = cache.get(rs)!;
  }
  const { kind, look } = style;
  const u = kid(rpr, 'u');
  const uOn = uIsOn(u);
  const box = boxOf(kid(rpr, 'bdr'));
  // the run's own <w:u w:val="none"/> or <w:bdr w:val="none"/> beats its style, as in Word: shrunk text
  // often keeps the Emphasis or Underline style with its underline switched off. Emphasis with its underline
  // off stays boxed only where Word still draws the box (Falcon has no box without the underline).
  const underlined = u ? uOn : kind === 'underline' || kind === 'emphasis';
  const emph = kind === 'emphasis' ? (underlined ? box !== false : !!(box ?? style.box)) : underlined && !!box && uOn && kind !== 'underline';
  if (emph) marks.push(M.emphasis.create());
  else if (underlined) marks.push(M.underline.create());
  if (kind === 'cite') marks.push(M.cite.create());
  const boldDefault = (paraStyle !== 'normal' && paraStyle !== 'undertag') || kind === 'cite' || emph;
  // a style's bold only counts on text that isn't bold already (Word flips bold styles on bold text)
  const b = kid(rpr, 'b') ?? (boldDefault ? undefined : look.b);
  if (b) {
    if (on(b) && !boldDefault) marks.push(M.bold.create());
    else if (!on(b) && boldDefault) marks.push(M.unbold.create());
  }
  if (on(kid(rpr, 'i') ?? look.i)) marks.push(M.italic.create());
  if (on(kid(rpr, 'strike'))) marks.push(M.strike.create());
  const hl = val(kid(rpr, 'highlight'));
  const shd = kid(rpr, 'shd');
  const fill = shd?.getAttributeNS(W, 'fill') ?? shd?.getAttribute('w:fill');
  // turquoise over a deep turquoise fill is how Falcon saves its deep turquoise
  const deep = hl === DEEP_TURQUOISE_UNDER && `#${fill ?? ''}`.toUpperCase() === HIGHLIGHTS.deepTurquoise;
  if (deep) marks.push(M.highlight.create({ color: 'deepTurquoise' }));
  else if (hl && hl !== 'none' && HL_NAMES.has(hl)) marks.push(M.highlight.create({ color: hl }));
  if (!deep && fill && /^[0-9a-f]{6}$/i.test(fill) && fill.toUpperCase() !== 'FFFFFF') marks.push(M.shading.create({ color: `#${fill.toUpperCase()}` }));
  const color = val(kid(rpr, 'color') ?? look.color);
  if (color && /^[0-9a-f]{6}$/i.test(color) && color !== '000000') marks.push(M.color.create({ color: `#${color.toUpperCase()}` }));
  const sz = Number(val(kid(rpr, 'sz') ?? look.sz));
  if (sz) {
    const pt = sz / 2;
    const natural = kind === 'cite' ? 13 : STYLE_PT[paraStyle]; // cite text is 13pt in any paragraph
    if (pt !== natural) marks.push(M.size.create({ pt }));
  }
  const va = val(kid(rpr, 'vertAlign'));
  if (va === 'superscript') marks.push(M.sup.create());
  else if (va === 'subscript') marks.push(M.sub.create());
  return marks;
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/x-emf', wmf: 'image/x-wmf' };
const EMU_PX = 9525; // 914400 EMU per inch, 96 px per inch

function dataUrl(bytes: Uint8Array, mime: string): string {
  // the native encoder is many times faster than building a binary string for btoa (a big file's pictures add up to megabytes)
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (native) return `data:${mime};base64,${native.call(bytes)}`;
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

/** Relationship id → target, for images (embedded file under word/, or an external link). */
function readImageRels(xml: string | undefined, files: Record<string, Uint8Array>): Map<string, string> {
  const map = new Map<string, string>();
  if (!xml) return map;
  for (const r of parseXml(xml).documentElement.children) {
    const id = r.getAttribute('Id'), target = r.getAttribute('Target');
    if (!id || !target || !/\/image$/.test(r.getAttribute('Type') ?? '')) continue;
    if (r.getAttribute('TargetMode') === 'External') { if (/^https?:\/\//i.test(target)) map.set(id, target); continue; }
    // a target is relative to word/ (or absolute from the package root), and can step up with ../
    const parts: string[] = [];
    for (const seg of (target.startsWith('/') ? target.slice(1) : `word/${target}`).split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); }
    const path = parts.join('/');
    const bytes = files[path];
    const mime = MIME[path.split('.').pop()!.toLowerCase()];
    if (bytes && mime) map.set(id, dataUrl(bytes, mime));
  }
  return map;
}

/**
 * A copy of a string that shares no memory with the XML it was read from. Text sliced out of document.xml
 * is a V8 "sliced string" that keeps the whole decoded file (tens of MB) alive for as long as the document
 * is open; flattening a concatenation makes a fresh copy, and the slice then points into that copy.
 */
const own = (s: string) => (s.length < 13 ? s : (' ' + s).slice(1));

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
    const alt = own(descendant(el, 'docPr')?.getAttribute('descr') ?? '');
    // Word's crop, in thousandths of a percent cut from each side
    const rect = descendant(el, 'srcRect');
    const cut = (k: string) => Math.max(0, Math.min(0.99, Number(rect?.getAttribute(k) ?? 0) / 100000)) || 0;
    const crop = rect && ['l', 't', 'r', 'b'].some((k) => cut(k) > 0) && cut('l') + cut('r') < 1 && cut('t') + cut('b') < 1 ? { l: cut('l'), t: cut('t'), r: cut('r'), b: cut('b') } : null;
    return schema.nodes.image.create({ src, alt, crop, width: cx > 0 ? Math.round(cx / EMU_PX) : null, height: cy > 0 ? Math.round(cy / EMU_PX) : null });
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
/** footnotes.xml or endnotes.xml: note id → its element (Word's separator notes left out). */
function readFootnotes(xml: string | undefined, tag = 'footnote'): Footnotes {
  const map: Footnotes = new Map();
  if (!xml) return map;
  for (const f of kids(parseXml(xml).documentElement, tag)) {
    const type = f.getAttributeNS(W, 'type') ?? f.getAttribute('w:type');
    const id = f.getAttributeNS(W, 'id') ?? f.getAttribute('w:id');
    if (id && (!type || type === 'normal')) map.set(id, f);
  }
  return map;
}

const u16 = (d: Uint8Array, i: number) => d[i] | (d[i + 1] << 8);
const u32 = (d: Uint8Array, i: number) => (d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24)) >>> 0;

/** One zip entry inflated by the platform's zlib; null when it doesn't come out at the size the zip records. */
async function inflateNative(raw: Uint8Array, size: number): Promise<Uint8Array | null> {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  w.write(raw as Uint8Array<ArrayBuffer>).catch(() => {});
  w.close().catch(() => {});
  const out = new Uint8Array(size), reader = ds.readable.getReader();
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (n + value.length > size) { reader.cancel().catch(() => {}); return null; }
    out.set(value, n);
    n += value.length;
  }
  return n === size ? out : null;
}

/**
 * The zip's wanted parts, inflated natively: fflate's JS inflate was the biggest single cost of opening a
 * big file (a 30 MB document.xml). Reads the central directory the way fflate's unzipSync does; anything
 * unusual (zip64, another compression method, no DecompressionStream, a size mismatch) goes to unzipSync.
 */
async function unzipParts(data: Uint8Array, want: (name: string) => boolean): Promise<Record<string, Uint8Array>> {
  const viaFflate = () => unzipSync(data, { filter: (f) => want(f.name) });
  if (typeof DecompressionStream === 'undefined') return viaFflate();
  let e = data.length - 22;
  while (e > 0 && data.length - e <= 65558 && u32(data, e) !== 0x06054b50) e--;
  if (e <= 0 || u32(data, e) !== 0x06054b50 || u32(data, e - 20) === 0x07064b50) return viaFflate();
  const parts: [string, Promise<Uint8Array | null>][] = [];
  for (let i = 0, count = u16(data, e + 8), o = u32(data, e + 16); i < count; i++) {
    if (o + 46 > data.length || u32(data, o) !== 0x02014b50) return viaFflate();
    const method = u16(data, o + 10), csize = u32(data, o + 20), size = u32(data, o + 24), nl = u16(data, o + 28), off = u32(data, o + 42);
    const name = strFromU8(data.subarray(o + 46, o + 46 + nl), !(u16(data, o + 8) & 2048));
    o += 46 + nl + u16(data, o + 30) + u16(data, o + 32);
    if (!want(name)) continue;
    if (csize === 0xffffffff || size === 0xffffffff || off === 0xffffffff || (method !== 0 && method !== 8)) return viaFflate();
    const b = off + 30 + u16(data, off + 26) + u16(data, off + 28);
    if (b + csize > data.length) return viaFflate();
    const part = method === 0 ? Promise.resolve(data.slice(b, b + csize)) : inflateNative(data.subarray(b, b + csize), size);
    part.catch(() => {}); // a failure is handled below; this keeps the parts not yet awaited from reporting it as unhandled
    parts.push([name, part]);
  }
  const files: Record<string, Uint8Array> = {};
  try {
    for (const [name, p] of parts) { const bytes = await p; if (!bytes) return viaFflate(); files[name] = bytes; }
  } catch { return viaFflate(); }
  return files;
}

/** Convert a .docx (zip bytes) into a Falcon document. */
export async function docxToDoc(data: Uint8Array): Promise<PMNode> {
  const files = await unzipParts(data, (n) => n === 'word/document.xml' || n === 'word/styles.xml' || n === 'word/_rels/document.xml.rels' || n === 'word/footnotes.xml' || n === 'word/_rels/footnotes.xml.rels' || n === 'word/endnotes.xml' || n === 'word/_rels/endnotes.xml.rels' || n.startsWith('word/media/') || n.startsWith('media/'));
  const docXml = files['word/document.xml'];
  if (!docXml) throw new Error('not a Word document');
  const str = (name: string) => (files[name] ? strFromU8(files[name]) : undefined);
  const styles = readStyles(str('word/styles.xml'));
  // each part numbers its own relationships: the body's, the footnotes' and the endnotes' links differ
  type Rels = { links: Map<string, string>; pics: Map<string, string> };
  const relsOf = (part: string): Rels => ({ links: readLinks(str(`word/_rels/${part}.xml.rels`)), pics: readImageRels(str(`word/_rels/${part}.xml.rels`), files) });
  const bodyRels = relsOf('document');
  // endnotes come in as footnotes (Falcon has one kind of note), so their text is kept
  const noteSets = { footnoteReference: { notes: readFootnotes(str('word/footnotes.xml')), rels: relsOf('footnotes') }, endnoteReference: { notes: readFootnotes(str('word/endnotes.xml'), 'endnote'), rels: relsOf('endnotes') } };
  const cache = new Map<string, CharStyle>();
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
  const readInline = (p: Element, style: ParaStyle, rels: Rels, inNote: boolean, boxes?: PMNode[]): PMNode[] => {
    const pics = rels.pics;
    const inline: PMNode[] = [];
    const readRuns = (parent: Element, link: Mark | null) => {
      for (const c of kids(parent)) {
        const ln = c.localName;
        if (ln === 'r') {
          const marks = runMarks(styles, kid(c, 'rPr'), style, cache);
          if (link) marks.push(link);
          let text = '';
          const flush = () => { if (text) { inline.push(schema.text(own(text), marks)); text = ''; } };
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
              } else if ((tl === 'footnoteReference' || tl === 'endnoteReference') && !inNote) {
                const set = noteSets[tl];
                const note = set.notes.get(t.getAttributeNS(W, 'id') ?? t.getAttribute('w:id') ?? '');
                if (note) { flush(); inline.push(schema.nodes.footnote.create({ content: noteContent(note, set.rels) })); }
              }
            }
          };
          readRun(c);
          flush();
        } else if (ln === 'hyperlink') {
          // links to a web address (through the relationships file); links to a bookmark in the file stay plain text
          const href = rels.links.get(c.getAttributeNS(R, 'id') ?? c.getAttribute('r:id') ?? '');
          readRuns(c, href ? M.link.create({ href }) : link);
        } else if (ln === 'smartTag' || ln === 'ins' || ln === 'moveTo' || ln === 'dir' || ln === 'bdo' || ln === 'fldSimple' || ln === 'customXml' || ln === 'sdtContent') {
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
  const noteContent = (note: Element, rels: Rels) => {
    const out: PMNode[] = [];
    kids(note, 'p').forEach((p, i) => {
      if (i > 0) out.push(schema.nodes.hard_break.create());
      out.push(...readInline(p, 'normal', rels, true).filter((n) => n.type.name !== 'image'));
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
    out.push(schema.nodes.paragraph.create({ style, indent }, readInline(p, style, bodyRels, false, boxes)), ...boxes);
  };

  /** Block content: paragraphs, with content controls opened up and (inside a cell) nested tables flattened. */
  const readBlock = (c: Element, out: PMNode[], flattenTables: boolean) => {
    if (c.localName === 'p') readPara(c, out);
    else if (c.localName === 'tbl') {
      if (flattenTables) { for (const tr of kids(c, 'tr')) for (const tc of kids(tr, 'tc')) readBlocks(tc, out, true); }
      else { const t = readTable(c); if (t) out.push(t); }
    } else if (c.localName === 'sdt') readBlocks(kid(c, 'sdtContent') ?? c, out, flattenTables);
    else if (c.localName === 'customXml') readBlocks(c, out, flattenTables);
  };
  const readBlocks = (el: Element, out: PMNode[], flattenTables: boolean) => { for (const c of kids(el)) readBlock(c, out, flattenTables); };

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
      let covered = false; // a row made only of merged-down cells has no cells of its own, but it is still a row
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
          covered = true;
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
      if (row.length || covered) rows.push(row);
    }
    if (!rows.length) return null;
    const T = schema.nodes;
    // borders: the table's own border lines, or (with none set) whether a table style gives it some
    const tblPr = kid(tbl, 'tblPr'), lines = kid(tblPr, 'tblBorders');
    const drawn = (el: Element | undefined) => kids(el).some((b) => !['none', 'nil'].includes(val(b) ?? 'none'));
    // lines set on the cells themselves count too
    const borders = (lines ? drawn(lines) : !!val(kid(tblPr, 'tblStyle'))) || tbl.getElementsByTagNameNS(W, 'tcBorders').some(drawn);
    return T.table.create({ borders }, rows.map((r) => T.table_row.create(null, r.map((c) => (c.header ? T.table_header : T.table_cell).create(c.attrs, c.paras)))));
  };

  // the body is read block by block as the parser finishes each one (the document's first <w:body>, as before)
  const blocks: PMNode[] = [];
  const xml = strFromU8(docXml);
  delete files['word/document.xml']; // the bytes aren't needed once decoded (and docXml goes out of use here)
  parseXml(xml, (el, up) => {
    if (up.length !== 3 || up[1] !== up[0].children[0] || up[2] !== kid(up[1], 'body')) return false;
    readBlock(el, blocks, false);
    return true;
  });
  if (!blocks.length) blocks.push(schema.nodes.paragraph.create());
  return schema.node('doc', null, blocks);
}
