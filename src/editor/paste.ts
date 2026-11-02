import { HIGHLIGHTS, type ParaStyle } from './schema';
import { P, pref } from './prefs';

/**
 * Turn clipboard HTML into HTML Falcon's schema understands.
 *
 * Falcon's own copies keep their f-* classes; only the inline look written for other apps is dropped.
 * Everything else (Word, Google Docs, Gmail, CardMirror, the web) is rebuilt paragraph by paragraph:
 * each run's bold, underline, box, size and highlight is worked out from its tags, classes and inline
 * styles, then mapped to Verbatim. Underline plus bold or a box is emphasis, bold at 13pt is a cite,
 * and a highlight is kept when it's one of Word's colors. Headings come from h1-h4, never from bold
 * alone: a cite on a line of its own looks just like a tag that lost its heading.
 * With smart paste off, only the paragraphs, bold and italic come through.
 */
export function cleanPastedHTML(html: string, smart = pref(P.smartPaste)): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('style, meta, link, script, title, xml, head').forEach((n) => n.remove());
  // our own copy: the classes say it all, the inline styles were only for other apps
  if (doc.body.querySelector(OWN)) {
    doc.body.querySelectorAll('[class^="f-"], [class*=" f-"]').forEach((el) => el.removeAttribute('style'));
    return doc.body.innerHTML;
  }
  // Word's own shell, not a stray mso- property (Falcon's copies carry mso-highlight for Word)
  const word = smart && /urn:schemas-microsoft-com|mso-style|class="?Mso/.test(html);
  return emit(doc, blocks(doc.body, smart, word), smart);
}

/** Falcon's paragraph classes: every copy of ours has at least one. */
const OWN = ['normal', 'pocket', 'hat', 'block', 'tag', 'analytic', 'undertag'].map((s) => `[class~="f-${s}"]`).join(', ');

type Run = {
  text?: string; br?: boolean;
  bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; box?: boolean; va?: 'sup' | 'sub';
  pt?: number; ptUnit?: boolean; hl?: string; unbold?: boolean;
  /** the size where the bold was set: a cite shrunk to 8pt inside is still a 13pt bold cite */
  boldPt?: number;
  /** a character style named by a class (Word, CardMirror): beats what the inline style implies */
  named?: 'cite' | 'underline' | 'emphasis';
};
type Block = { style: ParaStyle; heading: boolean; runs: Run[] };

const BLOCK_TAGS = /^(P|DIV|H[1-6]|LI|UL|OL|BLOCKQUOTE|PRE|TABLE|TBODY|THEAD|TR|TD|TH|SECTION|ARTICLE|HEADER|FOOTER|DL|DT|DD|FIGURE|ADDRESS)$/;
const HEADING: Record<string, ParaStyle> = { H1: 'pocket', H2: 'hat', H3: 'block', H4: 'tag', H5: 'tag', H6: 'tag' };

function blockStyle(el: HTMLElement, smart: boolean, word: boolean): ParaStyle {
  if (HEADING[el.tagName]) return HEADING[el.tagName];
  if (!smart) return 'normal';
  const cls = (el.getAttribute('class') ?? '').toLowerCase();
  // CardMirror's paragraphs, or Word's Verbatim paragraph styles
  if (el.classList.contains('pmd-analytic') || (word && /analytic/.test(cls))) return 'analytic';
  if (el.classList.contains('pmd-undertag') || (word && /undertag/.test(cls))) return 'undertag';
  return 'normal';
}

/** Flatten the body into paragraphs of styled runs. Nested blocks (CardMirror's card divs, lists, tables) each end a paragraph. */
function blocks(body: HTMLElement, smart: boolean, word: boolean): Block[] {
  const out: Block[] = [];
  let cur: Block | null = null;
  const open = (style: ParaStyle = 'normal') => {
    cur = { style, heading: style !== 'normal' && style !== 'undertag', runs: [] };
    out.push(cur);
    return cur;
  };
  const memo = new Map<HTMLElement, Run>();
  const walk = (node: Node, inherit: ParaStyle) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        const text = child.textContent ?? '';
        if (!cur && !/\S/.test(text)) continue; // whitespace between paragraphs
        const b = cur ?? open(inherit), look = resolve(child.parentElement!, smart, word, memo);
        // preformatted text keeps its line breaks
        const lines = child.parentElement!.closest('pre') ? text.split('\n') : [text];
        lines.forEach((line, i) => { if (i) b.runs.push({ br: true }); if (line) b.runs.push({ text: line, ...look }); });
      } else if (child.nodeType === 1) {
        const el = child as HTMLElement;
        if (el.tagName === 'BR') { if (cur) cur.runs.push({ br: true }); else { open(); cur = null; } continue; } // a lone <br> between paragraphs is an empty line
        if (BLOCK_TAGS.test(el.tagName)) {
          cur = null;
          const own = blockStyle(el, smart, word), style = own === 'normal' ? inherit : own;
          // a wrapper (a list, a table row, CardMirror's card div, <h2><div>) makes no paragraph of its own; its style goes to the ones inside
          if (Array.from(el.children).some((c) => BLOCK_TAGS.test(c.tagName))) walk(el, style);
          else {
            const b = open(style);
            walk(el, style);
            if (b.runs[b.runs.length - 1]?.br) b.runs.pop(); // <div><br></div> is an empty line, <p>text<br></p> ends at the text
          }
          cur = null;
        } else walk(el, inherit);
      }
    }
  };
  walk(body, 'normal');
  return out;
}

const NAMED: Record<string, string> = {
  yellow: '#FFFF00', lime: '#00FF00', aqua: '#00FFFF', cyan: '#00FFFF', fuchsia: '#FF00FF', magenta: '#FF00FF',
  blue: '#0000FF', red: '#FF0000', navy: '#000080', teal: '#008080', green: '#008000', purple: '#800080',
  maroon: '#800000', olive: '#808000', gray: '#808080', grey: '#808080', silver: '#C0C0C0', black: '#000000',
};
const HL_BY_HEX: Record<string, string> = Object.fromEntries(Object.entries(HIGHLIGHTS).map(([k, v]) => [v, k]));
/** One of Word's 15 highlight colors, from a name, hex or rgb(); anything else (a web page's background) is no highlight. */
export function highlightName(value: string): string | null {
  const v = value.trim().toLowerCase();
  let hex = NAMED[v];
  if (!hex && /^#[0-9a-f]{6}$/.test(v)) hex = v.toUpperCase();
  if (!hex && /^#[0-9a-f]{3}$/.test(v)) hex = `#${v.slice(1).split('').map((c) => c + c).join('')}`.toUpperCase();
  const rgb = v.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
  if (!hex && rgb && (rgb[4] === undefined || Number(rgb[4]) > 0)) hex = `#${rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  if (hex) return HL_BY_HEX[hex] ?? null;
  return Object.keys(HIGHLIGHTS).find((k) => k.toLowerCase() === v) ?? null; // Word's own names: darkBlue, lightGray
}

const PROPS = new Map<string, RegExp>();
const prop = (style: string, name: string) => {
  let re = PROPS.get(name);
  if (!re) PROPS.set(name, (re = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i')));
  return style.match(re)?.[1].trim().toLowerCase();
};

/** What the element itself says about its text. Undefined = it doesn't say; the parent decides. */
function own(el: HTMLElement, smart: boolean, word: boolean): Run {
  const r: Run = {};
  const tag = el.tagName;
  if (tag === 'B' || tag === 'STRONG') r.bold = true;
  if (tag === 'I' || tag === 'EM') r.italic = true;
  if (tag === 'U' && smart) r.underline = true;
  if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') r.strike = true;
  if (tag === 'SUP') r.va = 'sup';
  if (tag === 'SUB') r.va = 'sub';
  if (tag === 'MARK' && smart) r.hl = 'yellow';
  const cls = (el.getAttribute('class') ?? '').toLowerCase();
  const style = el.getAttribute('style') ?? '';
  // a named character style: its inline look is the style's own, so only the highlight is read from it
  if (smart) {
    const cm = el.classList;
    if (cm.contains('pmd-cite')) r.named = 'cite';
    else if (cm.contains('pmd-emphasis')) r.named = 'emphasis';
    else if (cm.contains('pmd-underline')) r.named = 'underline';
    else if (word && /emphasis/.test(cls)) r.named = 'emphasis';
    else if (word && /underline/.test(cls)) r.named = 'underline';
    else if (word && /cite|13pt/.test(cls)) r.named = 'cite';
    const name = el.getAttribute('data-highlight');
    if (cm.contains('pmd-highlight') && name && name in HIGHLIGHTS) r.hl = name;
    const hp = Number(el.getAttribute('data-half-points'));
    if (hp) { r.pt = hp / 2; r.ptUnit = true; }
    if (el.hasAttribute('data-bold-off')) r.unbold = true;
  }
  const hl = prop(style, 'mso-highlight') ?? prop(style, 'background-color') ?? prop(style, 'background');
  if (smart && hl && r.hl === undefined) { const n = highlightName(hl.match(/rgba?\([^)]*\)|\S+/)![0]); if (n) r.hl = n; }
  if (r.named || /\bpmd-/.test(cls)) return r;
  const fw = prop(style, 'font-weight');
  if (fw) r.bold = /bold|bolder/.test(fw) || Number(fw) >= 600;
  const fs = prop(style, 'font-style');
  if (fs) r.italic = fs.startsWith('italic') || fs.startsWith('oblique');
  const td = [prop(style, 'text-decoration'), prop(style, 'text-decoration-line')].filter(Boolean).join(' ');
  if (smart && /underline/.test(td)) r.underline = true;
  if (/line-through/.test(td)) r.strike = true;
  const border = prop(style, 'border');
  // a box around a run, not a bordered table cell or card div
  if (smart && border && !BLOCK_TAGS.test(tag) && !/none|hidden|^0(px|pt)?\b/.test(border)) r.box = true;
  const size = prop(style, 'font-size')?.match(/^([\d.]+)(pt|px)$/);
  if (size && r.pt === undefined) { r.pt = size[2] === 'px' ? Number(size[1]) * 0.75 : Number(size[1]); r.ptUnit = size[2] === 'pt'; }
  const va = prop(style, 'vertical-align');
  if (va === 'super') r.va = 'sup';
  if (va === 'sub') r.va = 'sub';
  return r;
}

/** A text run's look: each property from the nearest element that sets it, like CSS inheritance. */
function resolve(from: HTMLElement, smart: boolean, word: boolean, memo: Map<HTMLElement, Run>): Run {
  const r: Run = {};
  let boldSeen = false;
  for (let el: HTMLElement | null = from; el && el.tagName !== 'BODY'; el = el.parentElement) {
    let o = memo.get(el);
    if (!o) memo.set(el, (o = own(el, smart, word)));
    if (r.bold === undefined && o.bold) boldSeen = true;
    if (boldSeen && r.boldPt === undefined && o.pt !== undefined) r.boldPt = o.pt;
    for (const k of Object.keys(o) as (keyof Run)[]) if (r[k] === undefined) (r as Record<string, unknown>)[k] = o[k];
  }
  return r;
}

function emit(doc: Document, list: Block[], smart: boolean): string {
  const root = doc.createElement('div');
  for (const b of list) {
    const p = doc.createElement('p');
    if (b.style !== 'normal') p.dataset.style = b.style;
    for (const r of b.runs) {
      if (r.br) { p.append(doc.createElement('br')); continue; }
      let node: Node = doc.createTextNode(r.text!);
      const wrap = (tag: string, cls?: string, data?: Record<string, string>) => {
        const el = doc.createElement(tag);
        if (cls) el.className = cls;
        if (data) Object.assign(el.dataset, data);
        el.append(node);
        node = el;
      };
      if (r.italic) wrap('em');
      if (r.strike) wrap('s');
      if (r.va) wrap(r.va);
      if (!smart) { if (r.bold && !b.heading) wrap('strong'); p.append(node); continue; }
      const char = charStyle(r, b);
      if (r.bold && !char && !b.heading) wrap('strong');
      if (r.unbold && (char === 'cite' || b.heading)) wrap('span', 'f-unbold');
      // a shrunk run (card text condensed to 8pt) keeps its size; a page's own font sizes don't count
      if (r.pt && r.ptUnit && r.pt < 10.5 && b.style === 'normal') wrap('span', 'f-size', { pt: String(Math.round(r.pt * 2) / 2) });
      if (r.hl) wrap('span', 'f-highlight', { color: r.hl });
      if (char) wrap('span', `f-${char}`);
      p.append(node);
    }
    root.append(p);
  }
  return root.innerHTML;
}

/** Verbatim's character style for a run: the named one, or what bold, underline, box and size add up to. */
function charStyle(r: Run, b: Block): Run['named'] {
  if (r.named) return r.named;
  if (b.heading) return undefined; // a heading is bold (and a block underlined) already
  if (r.underline && (r.bold || r.box)) return 'emphasis';
  if (r.underline) return 'underline';
  if (r.bold && (r.boldPt ?? r.pt ?? 0) >= 12.5) return 'cite';
  return undefined;
}
