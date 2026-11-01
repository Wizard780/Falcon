import { strFromU8, unzipSync } from 'fflate';
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { HIGHLIGHTS, schema, type ParaStyle } from '../editor/schema';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
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

/** Convert a .docx (zip bytes) into a Falcon document. */
export async function docxToDoc(data: Uint8Array): Promise<PMNode> {
  const files = unzipSync(data, { filter: (f) => f.name === 'word/document.xml' || f.name === 'word/styles.xml' });
  const docXml = files['word/document.xml'];
  if (!docXml) throw new Error('not a Word document');
  const styles = readStyles(files['word/styles.xml'] ? strFromU8(files['word/styles.xml']) : undefined);
  const body = kid(parseXml(strFromU8(docXml)).documentElement, 'body');
  const paras: PMNode[] = [];
  const cache = new Map<string, CharKind>();
  const pstyleCache = new Map<string, ParaStyle>();

  const readPara = (p: Element) => {
    const ppr = kid(p, 'pPr');
    const ps = val(kid(ppr, 'pStyle'));
    const key = ps ?? '';
    let style = pstyleCache.get(key);
    if (!style || kid(ppr, 'outlineLvl')) {
      style = paraStyleOf(styles, ps, ppr);
      if (!kid(ppr, 'outlineLvl')) pstyleCache.set(key, style);
    }
    const ind = kid(ppr, 'ind');
    const left = Number(ind?.getAttributeNS(W, 'left') ?? ind?.getAttributeNS(W, 'start') ?? ind?.getAttribute('w:left') ?? 0);
    const indent = left > 0 ? Math.min(8, Math.round(left / 720)) : 0;
    const inline: PMNode[] = [];
    const readRuns = (parent: Element) => {
      for (const c of kids(parent)) {
        const ln = c.localName;
        if (ln === 'r') {
          const marks = runMarks(styles, kid(c, 'rPr'), style!, cache);
          let text = '';
          const flush = () => { if (text) { inline.push(schema.text(text, marks)); text = ''; } };
          for (const t of kids(c)) {
            if (t.localName === 't') text += t.textContent ?? '';
            else if (t.localName === 'tab') text += '\t';
            else if (t.localName === 'noBreakHyphen') text += '‑';
            else if (t.localName === 'sym') text += String.fromCharCode(parseInt(t.getAttributeNS(W, 'char') ?? '20', 16));
            else if (t.localName === 'br' || t.localName === 'cr') {
              const type = t.getAttributeNS(W, 'type');
              if (type === 'page' || type === 'column') continue;
              flush();
              inline.push(schema.nodes.hard_break.create());
            }
          }
          flush();
        } else if (ln === 'hyperlink' || ln === 'smartTag' || ln === 'ins' || ln === 'fldSimple' || ln === 'customXml' || ln === 'sdtContent') {
          readRuns(c);
        } else if (ln === 'sdt') {
          readRuns(kid(c, 'sdtContent') ?? c);
        }
      }
    };
    readRuns(p);
    paras.push(schema.nodes.paragraph.create({ style, indent }, inline));
  };

  const walk = (el: Element) => {
    for (const c of kids(el)) {
      if (c.localName === 'p') readPara(c);
      else if (c.localName === 'tbl') {
        // tables are flattened to their paragraphs for now
        for (const tr of kids(c, 'tr')) for (const tc of kids(tr, 'tc')) walk(tc);
      } else if (c.localName === 'sdt') walk(kid(c, 'sdtContent') ?? c);
    }
  };
  walk(body);
  if (!paras.length) paras.push(schema.nodes.paragraph.create());
  return schema.node('doc', null, paras);
}
