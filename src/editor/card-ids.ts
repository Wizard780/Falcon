import { Plugin, type Transaction } from 'prosemirror-state';
import { Mapping } from 'prosemirror-transform';
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { levelOf } from './schema';

/**
 * Stable card ids. Every top-level heading (pocket, hat, block, tag, analytic) carries a hidden id in its
 * `card` attr. It stays put through typing, moves, cut and paste, and saves: the docx keeps it as a
 * hidden bookmark `_fc_<id>` at the start of the heading, which Word keeps too. A copy of a heading gets
 * a new id, so no two headings share one. Tracking edits, merging changes from disk and pending cards all
 * key on it, and outside tools (Claude's python-docx scripts) address cards by it.
 */
export const BOOKMARK_PREFIX = '_fc_';
/** A pending card's bookmark (pending.ts): `_fcp_<id>` in place of `_fc_<id>`. */
export const PENDING_PREFIX = '_fcp_';

/** For a doc read from a file: the ids that were in the file (bookmarks). The rest were made up on open and can
 *  shift between reads, so a merge matches those cards by content instead (disk-merge.ts). No entry: every id is real. */
export const idsInFile = new WeakMap<PMNode, Set<string>>();

export function newCardId(): string {
  const b = new Uint32Array(2);
  crypto.getRandomValues(b);
  return (b[0].toString(36) + b[1].toString(36)).padStart(8, '0').slice(-8);
}

/** An id made from a heading's style, text and how many identical headings come before it: a file without ids
 *  gets the same ones each time it's read, so a change made to it on disk can be matched card by card. */
function stableId(n: PMNode, nth: number): string {
  const s = `${n.attrs.style}\u0000${n.textContent}\u0000${nth}`;
  const fnv = (seed: number) => { let h = seed; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
  return (fnv(2166136261).toString(36) + fnv(84696351).toString(36)).padStart(8, '0').slice(-8);
}

/** The ids a doc's headings need: [index of the top-level node, new id] for each heading with none or with a repeated one.
 *  `keeper(id)` names the index of the copy that keeps a repeated id (default: the first). `stable` makes the new ids
 *  from the headings themselves (opening a file) instead of at random (editing). */
export function missingIds(doc: PMNode, keeper?: (id: string) => number | null, stable = false): [number, string][] {
  const first = new Map<string, number>();
  const repeated: [number, string][] = [];
  const out: [number, string][] = [];
  const used = new Set<string>();
  doc.forEach((n, _pos, i) => {
    if (!levelOf(n)) return;
    const id: string | null = n.attrs.card;
    if (!id) out.push([i, '']);
    else if (first.has(id)) repeated.push([i, id]);
    else first.set(id, i);
    if (id) used.add(id);
  });
  for (const [i, id] of repeated) {
    const keep = keeper?.(id);
    // the copy the change came from keeps the id; every other copy gets a new one
    if (keep != null && keep === i) { out.push([first.get(id)!, '']); first.set(id, i); } else out.push([i, '']);
  }
  const seen = new Map<string, number>();
  const nth = new Map<number, number>();
  if (stable) doc.forEach((n, _p, i) => { if (levelOf(n)) { const k = `${n.attrs.style}\u0000${n.textContent}`; nth.set(i, seen.get(k) ?? 0); seen.set(k, (seen.get(k) ?? 0) + 1); } });
  for (const o of out) {
    let id = stable ? stableId(doc.child(o[0]), nth.get(o[0])!) : newCardId();
    while (used.has(id)) id = newCardId();
    used.add(id);
    o[1] = id;
  }
  return out;
}

/** `doc` with every heading given an id (the same doc when none was missing). For docs that come in whole: a file, a backup. */
export function withCardIds(doc: PMNode): PMNode {
  const fix = missingIds(doc, undefined, true);
  if (!fix.length) return doc;
  const kids: PMNode[] = [];
  doc.forEach((n) => { kids.push(n); });
  for (const [i, card] of fix) kids[i] = kids[i].type.create({ ...kids[i].attrs, card }, kids[i].content, kids[i].marks);
  return doc.copy(Fragment.from(kids));
}

/** The heading index in `doc` that the heading with `id` in `old` became after `mapping` (null if it's gone). */
function successor(old: PMNode, doc: PMNode, mapping: Mapping, id: string): number | null {
  let from = -1;
  old.forEach((n, pos) => { if (from < 0 && n.attrs.card === id && levelOf(n)) from = pos; });
  if (from < 0) return null;
  // the start of its text: an Enter at the very start leaves the text (and the id) in the second paragraph
  const r = mapping.mapResult(from + 1, 1);
  if (r.deleted) return null;
  const at = Math.min(r.pos, doc.content.size);
  return doc.resolve(at).index(0);
}

/** Gives every new heading an id and every copied one a fresh id, after each change. */
export const cardIdPlugin = new Plugin({
  appendTransaction(trs, oldState, state) {
    if (!trs.some((t) => t.docChanged)) return null;
    const mapping = new Mapping();
    for (const t of trs) mapping.appendMapping(t.mapping);
    const fix = missingIds(state.doc, (id) => successor(oldState.doc, state.doc, mapping, id));
    if (!fix.length) return null;
    const tr: Transaction = state.tr;
    const pos: number[] = [];
    state.doc.forEach((_n, p) => { pos.push(p); });
    for (const [i, id] of fix) tr.setNodeAttribute(pos[i], 'card', id);
    return tr; // joins the change's undo step, so redo brings back the same ids
  },
});
