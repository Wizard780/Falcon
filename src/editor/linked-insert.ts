/** Cards other apps send in over the bridge (Nimbus, ebb): their HTML read the way a paste is, so CardMirror's
 *  card HTML, Word's and plain text all come out as the same cards a Cmd-V would make. */
import { DOMParser, Fragment, type Node as PMNode } from 'prosemirror-model';
import { cleanPastedHTML } from './paste';
import { schema } from './schema';

/** The paragraphs an insert carries: its HTML when it has some, else its text, a line per paragraph. */
export function insertContent(html: unknown, text: unknown): Fragment | null {
  let paras: PMNode[] = [];
  if (typeof html === 'string' && html.trim()) {
    const box = document.createElement('div');
    box.innerHTML = cleanPastedHTML(html);
    const doc = DOMParser.fromSchema(schema).parse(box);
    doc.forEach((n) => { paras.push(n); });
  } else if (typeof text === 'string' && text.trim()) {
    paras = text.replace(/\r\n?/g, '\n').split('\n').map((l) => schema.node('paragraph', { style: 'normal' }, l ? [schema.text(l)] : []));
  }
  // the parser's own empty filler line isn't part of the card
  while (paras.length && !paras[paras.length - 1].content.size && paras.length > 1) paras.pop();
  return paras.some((p) => p.content.size || p.type !== schema.nodes.paragraph) ? Fragment.from(paras) : null;
}

/** The first line of what came in, short, for the "Nimbus sent …" note. */
export function insertLabel(content: Fragment): string {
  let t = '';
  content.forEach((n) => { if (!t && n.textContent.trim()) t = n.textContent.trim().replace(/\s+/g, ' '); });
  return t.length > 40 ? `${t.slice(0, 39).trimEnd()}…` : t;
}
