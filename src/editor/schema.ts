import { Schema, type MarkSpec, type NodeSpec } from 'prosemirror-model';

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

const TAG_FOR: Record<ParaStyle, string> = {
  pocket: 'h1', hat: 'h2', block: 'h3', tag: 'h4', analytic: 'p', undertag: 'p', normal: 'p',
};

const paragraph: NodeSpec = {
  content: 'inline*',
  group: 'block',
  attrs: { style: { default: 'normal' }, indent: { default: 0 } },
  parseDOM: [
    { tag: 'h1', attrs: { style: 'pocket' } },
    { tag: 'h2', attrs: { style: 'hat' } },
    { tag: 'h3', attrs: { style: 'block' } },
    { tag: 'h4', attrs: { style: 'tag' } },
    { tag: 'h5', attrs: { style: 'tag' } },
    { tag: 'h6', attrs: { style: 'tag' } },
    {
      tag: 'p',
      getAttrs: (el) => {
        const s = (el as HTMLElement).dataset.style;
        return { style: s && (PARA_STYLES as readonly string[]).includes(s) ? s : 'normal', indent: Number((el as HTMLElement).dataset.indent) || 0 };
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

const color = (s: string | null) => (s && /^[#a-zA-Z0-9(),. %]+$/.test(s) ? s : null);

const marks: Record<string, MarkSpec> = {
  // Character styles (Verbatim): cite, underline, emphasis. Underline and emphasis replace each other.
  cite: {
    parseDOM: [{ tag: 'span.f-cite' }],
    toDOM: () => ['span', { class: 'f-cite' }, 0],
  },
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
      { tag: 'span.f-highlight', getAttrs: (el) => ({ color: (el as HTMLElement).dataset.color || 'yellow' }) },
      { tag: 'mark', getAttrs: () => ({ color: 'yellow' }) },
    ],
    toDOM: (m) => ['span', { class: 'f-highlight', 'data-color': m.attrs.color, style: `background-color:${highlightCss(m.attrs.color)}` }, 0],
  },
  // Background color ("shading"). Looks like a highlight, but bulk highlight commands ignore it.
  shading: {
    attrs: { color: { default: '#D9D9D9' } },
    parseDOM: [{ tag: 'span.f-shading', getAttrs: (el) => ({ color: color((el as HTMLElement).dataset.color ?? null) || '#D9D9D9' }) }],
    toDOM: (m) => ['span', { class: 'f-shading', 'data-color': m.attrs.color, style: `background-color:${m.attrs.color}` }, 0],
  },
  color: {
    attrs: { color: {} },
    parseDOM: [{ tag: 'span.f-color', getAttrs: (el) => ({ color: (el as HTMLElement).dataset.color }) }],
    toDOM: (m) => ['span', { class: 'f-color', 'data-color': m.attrs.color, style: `color:${m.attrs.color}` }, 0],
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
  size: {
    attrs: { pt: {} },
    parseDOM: [{ tag: 'span.f-size', getAttrs: (el) => ({ pt: Number((el as HTMLElement).dataset.pt) || 11 }) }],
    toDOM: (m) => ['span', { class: 'f-size', 'data-pt': String(m.attrs.pt), style: `font-size:${m.attrs.pt}pt` }, 0],
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
    // only web and mail addresses become a live href; anything else (javascript:, file:) is kept but inert
    toDOM: (m) => ['a', { class: 'f-link', 'data-href': m.attrs.href, ...(/^(https?|mailto):/i.test(m.attrs.href) ? { href: m.attrs.href } : {}) }, 0],
  },
  sup: { excludes: 'sup sub', parseDOM: [{ tag: 'sup' }], toDOM: () => ['sup', 0] },
  sub: { excludes: 'sup sub', parseDOM: [{ tag: 'sub' }], toDOM: () => ['sub', 0] },
};

export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph,
    text: { group: 'inline' },
    hard_break: {
      inline: true,
      group: 'inline',
      selectable: false,
      parseDOM: [{ tag: 'br' }],
      toDOM: () => ['br'],
    },
  },
  marks,
});

/** Word's 15 highlight colors (the names .docx uses) and how they render. */
export const HIGHLIGHTS: Record<string, string> = {
  yellow: '#FFFF00', green: '#00FF00', cyan: '#00FFFF', magenta: '#FF00FF', blue: '#0000FF',
  red: '#FF0000', darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080',
  darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#C0C0C0', black: '#000000',
};
export function highlightCss(name: string): string {
  return HIGHLIGHTS[name] ?? (color(name) || '#FFFF00');
}
