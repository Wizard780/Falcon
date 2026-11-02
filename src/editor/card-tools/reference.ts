import { DOMSerializer, Fragment, type Node as PMNode } from 'prosemirror-model';
import type { Command, EditorState } from 'prosemirror-state';
import { HIGHLIGHTS, schema } from '../schema';
import { readSetting, type SettingSpec } from '../tools';
import { LOCKED } from './edit';
import { bodySelection, posOf } from './scope';

const M = schema.marks;

export const refHeading: SettingSpec = {
  section: 'Card tools', kind: 'toggle', default: true, key: 'falcon.reference.heading',
  label: 'Create Reference adds a heading', hint: 'A <<CITE FOR REFERENCE>> line above the excerpt',
};
export const refShrink: SettingSpec = {
  section: 'Card tools', kind: 'choice', default: '3', key: 'falcon.reference.shrink',
  label: 'Create Reference makes the text smaller by',
  options: [['0', 'Nothing'], ['1', '1 pt'], ['2', '2 pt'], ['3', '3 pt'], ['4', '4 pt']],
};
export const refHighlights: SettingSpec = {
  section: 'Card tools', kind: 'choice', default: 'shading', key: 'falcon.reference.highlights',
  label: 'In a reference, highlights become',
  options: [['shading', 'Gray background'], ['convert', 'Background in the same color'], ['keep', 'Highlights'], ['remove', 'Nothing']],
};

/** The cite-marked words of the card's cite line, like "SMITH 24". */
function citeText(line: PMNode | null): string {
  let out = '', gap = false;
  line?.forEach((n) => {
    if (!n.isText) return;
    if (!M.cite.isInSet(n.marks)) { gap = !!out; return; }
    out += (gap ? ' ' : '') + n.text;
    gap = false;
  });
  return out.replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * The "for reference" excerpt of the selected card text: a <<CITE FOR REFERENCE>> line, then the text
 * smaller and with its highlights turned into a quiet gray background, so it can be pasted as context
 * nobody mistakes for read evidence. Null when the selection isn't body text inside one card.
 */
export function referenceNodes(state: EditorState): PMNode[] | null {
  const b = bodySelection(state);
  if (!b) return null;
  const { doc, selection: sel } = state;
  const by = Number(readSetting(refShrink));
  const hl = readSetting(refHighlights) as string;
  const out: PMNode[] = [];
  if (readSetting(refHeading)) {
    const cite = citeText(b.card.cite === null ? null : doc.child(b.card.cite));
    out.push(schema.nodes.paragraph.create(null, schema.text(`<<${cite ? `${cite} ` : ''}FOR REFERENCE>>`)));
  }
  for (let i = b.first; i <= b.last; i++) {
    const p = doc.child(i), start = posOf(doc, i) + 1;
    const runs: PMNode[] = [];
    p.content.cut(Math.max(0, sel.from - start), Math.min(p.content.size, sel.to - start)).forEach((n) => {
      if (!n.isText) { runs.push(n); return; }
      let marks = n.marks;
      const h = M.highlight.isInSet(marks);
      if (h && hl !== 'keep') {
        marks = M.highlight.removeFromSet(marks);
        const color = hl === 'shading' ? LOCKED : hl === 'convert' ? HIGHLIGHTS[h.attrs.color] ?? HIGHLIGHTS.yellow : null;
        if (color && !M.shading.isInSet(marks)) marks = M.shading.create({ color }).addToSet(marks);
      }
      if (by) {
        const pt = M.size.isInSet(marks)?.attrs.pt ?? (M.cite.isInSet(marks) ? 13 : 11);
        marks = M.size.create({ pt: Math.max(1, pt - by) }).addToSet(marks);
      }
      runs.push(n.mark(marks));
    });
    out.push(p.copy(Fragment.fromArray(runs)));
  }
  return out;
}

/** HTML for the clipboard: Falcon's own markup (so it pastes back exactly), with inline styles for Word. */
export function referenceHTML(nodes: PMNode[]): string {
  const div = document.createElement('div');
  div.append(DOMSerializer.fromSchema(schema).serializeFragment(Fragment.fromArray(nodes)));
  const add = (sel: string, css: string) => div.querySelectorAll<HTMLElement>(sel).forEach((el) => { el.style.cssText += css; });
  add('.f-underline, .f-emphasis', 'text-decoration:underline;');
  add('.f-emphasis, .f-cite', 'font-weight:bold;');
  add('.f-emphasis', 'border:1px solid windowtext;');
  return div.innerHTML;
}

/** Create Reference: copy the excerpt to the clipboard as rich text, with plain text alongside. */
export const createReference: Command = (state, dispatch) => {
  const nodes = referenceNodes(state);
  if (!nodes) return false;
  if (!dispatch) return true;
  const html = referenceHTML(nodes), plain = nodes.map((n) => n.textContent).join('\n\n');
  const blob = (s: string, type: string) => new Blob([s], { type });
  // a promise chain, so a missing clipboard API (an old webview) fails quietly too
  void Promise.resolve()
    .then(() => navigator.clipboard.write([new ClipboardItem({ 'text/html': blob(html, 'text/html'), 'text/plain': blob(plain, 'text/plain') })]))
    .catch(() => navigator.clipboard.writeText(plain))
    .catch(() => {});
  return true;
};
