import { Schema, type MarkSpec, type NodeSpec, type Node as PMNode } from 'prosemirror-model';
import { TableMap, tableNodes } from 'prosemirror-tables';

/**
 * Falcon's document model is flat, like a Word/Verbatim file: a list of paragraphs,
 * each with a paragraph style. A "card" is a tag paragraph plus the normal paragraphs
 * under it, up to the next heading. Card-aware behavior lives in commands and keymaps.
 */
export const PARA_STYLES = ['normal', 'pocket', 'hat', 'block', 'tag', 'analytic', 'undertag'] as const;
export type ParaStyle = (typeof PARA_STYLES)[number];

/** Outline level for each heading style (0 = not a heading). Analytics sit at tag level. */
export const LEVEL: Record<ParaStyle, number> = {
  normal: 0, undertag: 0, pocket: 1, hat: 2, block: 3, tag: 4, analytic: 4,
};

/** A node's outline level: 0 for body paragraphs and for anything that isn't a paragraph (tables). */
export const levelOf = (n: PMNode): number => (n.type.name === 'paragraph' ? LEVEL[n.attrs.style as ParaStyle] ?? 0 : 0);

/** A pasted paragraph's indent: the steps Falcon uses (0-8), whatever the HTML says, so the .docx stays valid. */
const indentOf = (el: HTMLElement) => Math.max(0, Math.min(8, Math.round(Number(el.dataset.indent)) || 0));

const TAG_FOR: Record<ParaStyle, string> = {
  pocket: 'h1', hat: 'h2', block: 'h3', tag: 'h4', analytic: 'p', undertag: 'p', normal: 'p',
};

const paragraph: NodeSpec = {
  content: 'inline*',
  group: 'block',
  attrs: { style: { default: 'normal' }, indent: { default: 0 } },
  parseDOM: [
    // headings keep their indent too: copy and paste, and a card sent by Card sharing, come back through these
    { tag: 'h1', getAttrs: (el) => ({ style: 'pocket', indent: indentOf(el as HTMLElement) }) },
    { tag: 'h2', getAttrs: (el) => ({ style: 'hat', indent: indentOf(el as HTMLElement) }) },
    { tag: 'h3', getAttrs: (el) => ({ style: 'block', indent: indentOf(el as HTMLElement) }) },
    { tag: 'h4', getAttrs: (el) => ({ style: 'tag', indent: indentOf(el as HTMLElement) }) },
    { tag: 'h5', attrs: { style: 'tag' } },
    { tag: 'h6', attrs: { style: 'tag' } },
    {
      tag: 'p',
      getAttrs: (el) => {
        const s = (el as HTMLElement).dataset.style;
        return { style: s && (PARA_STYLES as readonly string[]).includes(s) ? s : 'normal', indent: indentOf(el as HTMLElement) };
      },
    },
  ],
  toDOM: (node) => {
    const style = node.attrs.style as ParaStyle;
    const attrs: Record<string, string> = { class: `f-${style}`, 'data-style': style };
    if (node.attrs.indent) {
      attrs['data-indent'] = String(node.attrs.indent);
      attrs.style = `margin-left:${node.attrs.indent * 0.5}in`;
    }
    return [TAG_FOR[style], attrs, 0];
  },
};

const color = (s: unknown) => (typeof s === 'string' && /^[#a-zA-Z0-9(),. %]+$/.test(s) ? s : null);
/** A font size Word can save (1 to 1638 pt), else 11. */
const ptOf = (v: unknown) => { const n = Number(v); return n >= 1 && n <= 1638 ? n : 11; };

const marks: Record<string, MarkSpec> = {
  // Character styles (Verbatim): cite, underline, emphasis. Underline and emphasis replace each other.
  cite: {
    parseDOM: [{ tag: 'span.f-cite' }],
    toDOM: () => ['span', { class: 'f-cite' }, 0],
  },
  // Font size sits outside highlight, underline and emphasis so their box and background take the text's size (inside cite, whose own size it overrides).
  size: {
    attrs: { pt: {} },
    // Word's range (1 to 1638 pt, in half points): anything else would make Word refuse the saved file
    parseDOM: [{ tag: 'span.f-size', getAttrs: (el) => { const pt = Math.round(Number((el as HTMLElement).dataset.pt) * 2) / 2; return { pt: pt >= 1 && pt <= 1638 ? pt : 11 }; } }],
    // every value that goes into an inline style is checked here too, not only on paste: a doc from a live session or a
    // crafted file sets attrs directly
    toDOM: (m) => ['span', { class: 'f-size', 'data-pt': String(m.attrs.pt), style: `font-size:${ptOf(m.attrs.pt)}pt` }, 0],
  },
  // Underline and emphasis sit outside highlight and shading, so a box stays one box where its highlight starts or stops.
  underline: {
    excludes: 'underline emphasis',
    parseDOM: [{ tag: 'span.f-underline' }, { tag: 'u' }, { style: 'text-decoration-line=underline' }, { style: 'text-decoration=underline' }],
    toDOM: () => ['span', { class: 'f-underline' }, 0],
  },
  emphasis: {
    excludes: 'underline emphasis',
    parseDOM: [{ tag: 'span.f-emphasis' }],
    toDOM: () => ['span', { class: 'f-emphasis' }, 0],
  },
  highlight: {
    attrs: { color: { default: 'yellow' } },
    parseDOM: [
      // only the colors a .docx can carry (Word refuses a file with any other name)
      { tag: 'span.f-highlight', getAttrs: (el) => { const c = (el as HTMLElement).dataset.color ?? ''; return { color: Object.hasOwn(HIGHLIGHTS, c) ? c : 'yellow' }; } },
      { tag: 'mark', getAttrs: () => ({ color: 'yellow' }) },
    ],
    toDOM: (m) => ['span', { class: 'f-highlight', 'data-color': m.attrs.color, style: `background-color:${highlightCss(m.attrs.color)}` }, 0],
  },
  // Background color ("shading"). Looks like a highlight, but bulk highlight commands ignore it.
  shading: {
    attrs: { color: { default: '#D9D9D9' } },
    parseDOM: [{ tag: 'span.f-shading', getAttrs: (el) => ({ color: color((el as HTMLElement).dataset.color ?? null) || '#D9D9D9' }) }],
    toDOM: (m) => ['span', { class: 'f-shading', 'data-color': m.attrs.color, style: `background-color:${color(m.attrs.color) ?? '#D9D9D9'}` }, 0],
  },
  color: {
    attrs: { color: {} },
    // sanitized: the value goes into an inline style
    parseDOM: [{ tag: 'span.f-color', getAttrs: (el) => { const c = color((el as HTMLElement).dataset.color ?? null); return c ? { color: c } : false; } }],
    toDOM: (m) => ['span', { class: 'f-color', 'data-color': m.attrs.color, style: `color:${color(m.attrs.color) ?? 'inherit'}` }, 0],
  },
  bold: {
    parseDOM: [{ tag: 'strong' }, { tag: 'b', getAttrs: (el) => (el as HTMLElement).style.fontWeight !== 'normal' && null }, { style: 'font-weight=bold' }, { style: 'font-weight=700' }],
    toDOM: () => ['strong', 0],
  },
  /** Bold toggled off inside a style that is bold by default (tags, cites, headings). */
  unbold: {
    parseDOM: [{ tag: 'span.f-unbold' }],
    toDOM: () => ['span', { class: 'f-unbold' }, 0],
  },
  italic: {
    parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
    toDOM: () => ['em', 0],
  },
  strike: {
    parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration-line=line-through' }],
    toDOM: () => ['s', 0],
  },
  // A hyperlink. Only our own links parse from HTML (copy/paste inside Falcon): links in pasted web text stay plain.
  link: {
    attrs: { href: {} },
    inclusive: false,
    parseDOM: [{ tag: 'a.f-link[data-href]', getAttrs: (el) => ({ href: (el as HTMLElement).dataset.href }) }],
    // only web addresses become a live href; anything else (mailto:, javascript:, file:) is kept but inert
    toDOM: (m) => ['a', { class: 'f-link', 'data-href': m.attrs.href, ...(/^https?:/i.test(m.attrs.href) ? { href: m.attrs.href } : {}) }, 0],
  },
  sup: { excludes: 'sup sub', parseDOM: [{ tag: 'sup' }], toDOM: () => ['sup', 0] },
  sub: { excludes: 'sup sub', parseDOM: [{ tag: 'sub' }], toDOM: () => ['sub', 0] },
};

/** Image sources the editor keeps: embedded pictures, and web pictures it couldn't fetch (saved as linked pictures). */
export const imageSrc = (s: string | null) => (s && /^(data:image\/[\w.+-]+;base64,|https?:\/\/)/i.test(s) ? s : null);
const num = (v: string | null | undefined) => { const n = Math.round(Number(v)); return n > 0 ? n : null; };

/**
 * A picture, inline in its paragraph like Word's "in line with text". `width`/`height` are CSS pixels
 * (null: the picture's own size); the corner handle changes them together, so the shape never stretches.
 */
const image: NodeSpec = {
  inline: true,
  group: 'inline',
  draggable: true,
  // crop: Word's crop of the picture, as fractions cut from each side ({ l, t, r, b }), or null
  attrs: { src: {}, width: { default: null }, height: { default: null }, alt: { default: '' }, crop: { default: null } },
  leafText: () => '\ufffc',
  parseDOM: [{
    tag: 'img[src]',
    getAttrs: (el) => {
      const e = el as HTMLImageElement;
      const src = imageSrc(e.getAttribute('src'));
      if (!src) return false;
      const w = num(e.getAttribute('width')) ?? num(e.style.width.replace(/px$/, '')), h = num(e.getAttribute('height')) ?? num(e.style.height.replace(/px$/, ''));
      // Word's crop, carried through copy and paste: "l,t,r,b" fractions
      const c = (e.dataset.crop ?? '').split(',').map(Number);
      const crop = c.length === 4 && c.every((x) => x >= 0 && x < 1) && c[0] + c[2] < 1 && c[1] + c[3] < 1 && c.some((x) => x > 0) ? { l: c[0], t: c[1], r: c[2], b: c[3] } : null;
      return { src, width: w, height: w && h ? h : null, alt: e.getAttribute('alt') ?? '', crop };
    },
  }],
  toDOM: (n) => ['img', { class: 'f-image', src: n.attrs.src, alt: n.attrs.alt, ...(n.attrs.width ? { width: String(n.attrs.width) } : {}), ...(n.attrs.width && n.attrs.height ? { height: String(n.attrs.height) } : {}), ...(n.attrs.crop ? { 'data-crop': ['l', 't', 'r', 'b'].map((k) => n.attrs.crop[k]).join(',') } : {}) }],
};

/** Plain text of a footnote's content (stored as ProseMirror JSON for text and hard breaks). */
export type FootnoteContent = { type: string; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] }[];
export const footnoteText = (c: FootnoteContent) => (Array.isArray(c) ? c : []).map((n) => (n?.type === 'hard_break' ? '\n' : n?.text ?? '')).join('');
/** A footnote's content as nodes, keeping only text and line breaks that parse (pasted HTML can carry anything). */
export function noteNodes(c: unknown): PMNode[] {
  if (!Array.isArray(c)) return [];
  const out: PMNode[] = [];
  for (const j of c) {
    try { const n = schema.nodeFromJSON(j); if (n.isText || n.type.name === 'hard_break') out.push(n); } catch { /* dropped */ }
  }
  return out;
}

/**
 * A footnote reference. It's one character in the text (a number the editor draws); the note itself rides
 * along as `content`, so cutting, pasting and undo carry it whole. Its own little editor opens on click.
 */
const footnote: NodeSpec = {
  inline: true,
  group: 'inline',
  atom: true,
  attrs: { content: { default: [] } },
  leafText: () => '\ufffc',
  parseDOM: [{
    tag: 'sup.f-footnote',
    priority: 60, // ahead of the superscript mark's plain <sup> rule
    getAttrs: (el) => {
      try { return { content: noteNodes(JSON.parse((el as HTMLElement).dataset.content ?? '[]')).map((n) => n.toJSON()) }; } catch { return { content: [] }; }
    },
  }],
  toDOM: (n) => ['sup', { class: 'f-footnote', 'data-content': JSON.stringify(n.attrs.content), title: footnoteText(n.attrs.content) }],
};

const cssColor = (s: string | null) => (s && /^#[0-9a-f]{6}$/i.test(s) ? s.toUpperCase() : null);
const tables = tableNodes({
  tableGroup: 'block',
  cellContent: 'paragraph+',
  cellAttributes: {
    background: {
      default: null,
      getFromDOM: (dom) => cssColor(dom.dataset.bg ?? null),
      setDOMAttr: (value, attrs) => { const c = cssColor(value as string | null); if (c) { attrs['data-bg'] = c; attrs.style = `${attrs.style ?? ''}background-color:${c};`; } },
    },
  },
});
// borders: false for a table Word draws without lines (a layout table); Falcon shows faint guides there
tables.table.attrs = { borders: { default: true } };
tables.table.parseDOM = [{ tag: 'table', getAttrs: (el) => ({ borders: (el as HTMLElement).dataset.borders !== 'none' }) }];
tables.table.toDOM = (n) => ['table', { class: n.attrs.borders ? 'f-table' : 'f-table f-noborder', ...(n.attrs.borders ? {} : { 'data-borders': 'none' }) }, ['tbody', 0]];

/** Each column's width in a table, from the first cell that sets one (null where none does). */
export function colWidths(table: PMNode): (number | null)[] {
  const map = TableMap.get(table);
  const out: (number | null)[] = Array(map.width).fill(null);
  map.map.forEach((pos, i) => {
    const col = i % map.width, left = map.colCount(pos), cw: number[] | null = table.nodeAt(pos)!.attrs.colwidth;
    if (out[col] === null && cw?.[col - left]) out[col] = cw[col - left];
  });
  return out;
}

export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph,
    ...tables,
    text: { group: 'inline' },
    hard_break: {
      inline: true,
      group: 'inline',
      selectable: false,
      parseDOM: [{ tag: 'br' }],
      toDOM: () => ['br'],
    },
    image,
    footnote,
  },
  marks,
});

/** The highlight colors and how they render, in CardMirror's order: Word's 15 (the names .docx uses) plus Falcon's deep turquoise (Turquoise a step deeper, so it shows on white). */
export const HIGHLIGHTS: Record<string, string> = {
  yellow: '#FFFF00', green: '#00FF00', cyan: '#00FFFF', deepTurquoise: '#00DAFF', magenta: '#FF00FF', blue: '#0000FF',
  red: '#FF0000', darkYellow: '#808000', darkGreen: '#008000', darkCyan: '#008080', darkMagenta: '#800080',
  darkBlue: '#000080', darkRed: '#800000', lightGray: '#C0C0C0', darkGray: '#808080', black: '#000000',
};
/** Deep turquoise isn't one of Word's: a .docx gets Turquoise with a deep turquoise fill under it, and reading that back gives deep turquoise. */
export const DEEP_TURQUOISE_UNDER = 'cyan';
/** What each highlight color is called, CardMirror's (and Word's) names. */
export const HIGHLIGHT_NAMES: Record<string, string> = {
  yellow: 'Yellow', green: 'Bright Green', cyan: 'Turquoise', deepTurquoise: 'Deep Turquoise', magenta: 'Pink', blue: 'Blue', red: 'Red',
  darkYellow: 'Dark Yellow', darkGreen: 'Dark Green', darkCyan: 'Teal', darkMagenta: 'Violet', darkBlue: 'Dark Blue',
  darkRed: 'Dark Red', lightGray: 'Gray 25%', darkGray: 'Gray 50%', black: 'Black',
};
/** The toolbar's background colors: [color, name]. */
export const SHADES: [string, string][] = [
  ['#D9D9D9', 'Light gray'], ['#BFBFBF', 'Gray'], ['#F2F2F2', 'Faint gray'], ['#FFF2CC', 'Light gold'], ['#FCE4D6', 'Light orange'],
  ['#E2EFDA', 'Light green'], ['#DDEBF7', 'Light blue'], ['#EDE7F6', 'Light purple'], ['#FDE2E4', 'Light pink'], ['#C6E0B4', 'Green'],
  ['#BDD7EE', 'Blue'], ['#F8CBAD', 'Orange'], ['#FFE699', 'Gold'], ['#A9D08E', 'Deep green'], ['#9BC2E6', 'Deep blue'],
];
export function highlightCss(name: string): string {
  return (Object.hasOwn(HIGHLIGHTS, name) ? HIGHLIGHTS[name] : null) ?? (color(name) || '#FFFF00');
}
