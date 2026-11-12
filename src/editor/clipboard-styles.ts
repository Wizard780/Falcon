import { DOMSerializer, type Fragment } from 'prosemirror-model';
import { HIGHLIGHTS, schema } from './schema';

/**
 * Inline styles for copied HTML. Falcon's clipboard HTML is its own DOM (f-* classes and data-*),
 * which Gmail, Google Docs and Word have no stylesheet for, so a cite or emphasis would land there as
 * plain text. This writes the look of each class onto the element, in the light palette, so the paste
 * elsewhere looks like Verbatim. Pasting back into Falcon reads only the classes: cleanPastedHTML drops
 * the style on every f-* element, so these never turn into stray bold or underline marks.
 */
const CSS: Record<string, string> = {
  'f-normal': 'font-size:11pt',
  'f-pocket': 'font-size:26pt;font-weight:bold;text-align:center;border:3px solid #333',
  'f-hat': 'font-size:22pt;font-weight:bold;text-align:center;text-decoration:underline double',
  'f-block': 'font-size:16pt;font-weight:bold;text-align:center;text-decoration:underline',
  'f-tag': 'font-size:13pt;font-weight:bold',
  'f-analytic': 'font-size:13pt;font-weight:bold;color:#1f3f8a',
  'f-undertag': 'font-size:11pt;font-style:italic;color:#2a6a3a',
  'f-cite': 'font-size:13pt;font-weight:bold',
  'f-underline': 'text-decoration:underline',
  'f-emphasis': 'font-weight:bold;text-decoration:underline;border:1pt solid #222',
  'f-unbold': 'font-weight:normal',
};

/** Word's highlight names → the HTML color names Word itself writes in mso-highlight (bare background pastes as shading). */
export const MSO_HIGHLIGHT: Record<string, string> = {
  yellow: 'yellow', green: 'lime', cyan: 'aqua', magenta: 'fuchsia', blue: 'blue', red: 'red',
  darkBlue: 'navy', darkCyan: 'teal', darkGreen: 'green', darkMagenta: 'purple', darkRed: 'maroon',
  darkYellow: 'olive', darkGray: 'gray', lightGray: 'silver', black: 'black',
  // deep turquoise isn't a Word highlight: it goes as its background color, which Word pastes as shading
};

/**
 * CardMirror's names for the same styles. Its paste reads only its own classes: without these a tag
 * lands there as a pocket, a highlight as colored text, and an analytic or cite as plain bold.
 */
const CARDMIRROR: Record<string, string> = {
  'f-pocket': 'pmd-pocket', 'f-hat': 'pmd-hat', 'f-block': 'pmd-block', 'f-tag': 'pmd-tag',
  'f-analytic': 'pmd-analytic', 'f-undertag': 'pmd-undertag',
  'f-cite': 'pmd-cite', 'f-underline': 'pmd-underline', 'f-emphasis': 'pmd-emphasis',
};

/**
 * CardMirror reads data-color as a font color, so a highlight or shading also says itself CardMirror's way:
 * one of Word's highlights by name, anything else (deep turquoise, a shading) as a fill.
 */
function cardMirrorFill(el: HTMLElement) {
  const c = el.dataset.color ?? '';
  if (el.classList.contains('f-highlight') && MSO_HIGHLIGHT[c]) { el.classList.add('pmd-highlight'); el.dataset.highlight = c; return; }
  const hex = (HIGHLIGHTS[c] ?? c).replace('#', '');
  if (/^[0-9a-f]{6}$/i.test(hex)) el.dataset.shading = hex.toUpperCase();
}

/** Write the inline look onto every f-* element under root, in place, plus CardMirror's class for it. */
export function freezeStyles(root: ParentNode) {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('span.f-shading'))) cardMirrorFill(el);
  // a font color: CardMirror's data-color is the hex without its # (pasting back into Falcon puts it back)
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('span.f-color'))) if (/^#[0-9a-f]{6}$/i.test(el.dataset.color ?? '')) el.dataset.color = el.dataset.color!.slice(1);
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[class*="f-"]'))) {
    const cls = Array.from(el.classList).find((c) => c in CSS || c === 'f-highlight');
    if (!cls) continue;
    if (CARDMIRROR[cls]) el.classList.add(CARDMIRROR[cls]);
    if (cls === 'f-highlight') cardMirrorFill(el);
    // through the attribute, not el.style: browsers drop properties they don't know, like mso-highlight
    const add = cls === 'f-highlight' ? (MSO_HIGHLIGHT[el.dataset.color ?? ''] ? `mso-highlight:${MSO_HIGHLIGHT[el.dataset.color!]}` : '') : CSS[cls];
    if (!add) continue;
    const own = el.getAttribute('style');
    // toDOM's own inline style (an indent, a highlight color) comes last, so it wins
    el.setAttribute('style', own ? `${add};${own}` : add);
  }
  // tables: cell lines, padding and column widths (Falcon draws these from its stylesheet)
  for (const t of Array.from(root.querySelectorAll<HTMLElement>('table.f-table'))) {
    t.setAttribute('style', 'border-collapse:collapse');
    const line = t.classList.contains('f-noborder') ? 'none' : '1px solid #a3a3a8';
    for (const c of Array.from(t.querySelectorAll<HTMLElement>('td, th'))) {
      const w = Number(c.dataset.colwidth?.split(',')[0]);
      c.setAttribute('style', `border:${line};padding:3px 6px;vertical-align:top${w ? `;width:${w}px` : ''}${c.getAttribute('style') ? `;${c.getAttribute('style')}` : ''}`);
    }
  }
}

/** The editor's clipboard serializer: the schema's DOM plus the inline look. Covers copy, cut and drag. */
class FrozenSerializer extends DOMSerializer {
  private depth = 0;
  serializeFragment(fragment: Fragment, options?: { document?: Document }, target?: HTMLElement | DocumentFragment) {
    // the base class calls this again for each node's content: freeze once, at the top
    this.depth++;
    try {
      const out = super.serializeFragment(fragment, options, target);
      if (this.depth === 1) freezeStyles(out);
      return out;
    } finally { this.depth--; }
  }
}
const base = DOMSerializer.fromSchema(schema);
export const clipboardSerializer = new FrozenSerializer(base.nodes, base.marks);

/** HTML for a fragment, the way the clipboard gets it. */
export function clipboardHTML(fragment: Fragment): string {
  const div = document.createElement('div');
  div.appendChild(clipboardSerializer.serializeFragment(fragment));
  return div.innerHTML;
}
