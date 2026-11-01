import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

type Match = { from: number; to: number };
type FindState = { query: string; matches: Match[]; index: number; decos: DecorationSet };

export const findKey = new PluginKey<FindState>('find');

// case and curly-vs-straight quotes don't matter
const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

function search(doc: PMNode, query: string): Match[] {
  const q = norm(query);
  if (!q) return [];
  const out: Match[] = [];
  doc.forEach((para, offset) => {
    const text = norm(para.textBetween(0, para.content.size, undefined, '￼'));
    for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) out.push({ from: offset + 1 + i, to: offset + 1 + i + q.length });
  });
  return out;
}

function build(doc: PMNode, query: string, index: number): FindState {
  const matches = search(doc, query);
  const i = matches.length ? Math.min(Math.max(index, 0), matches.length - 1) : -1;
  const decos = DecorationSet.create(doc, matches.map((m, k) => Decoration.inline(m.from, m.to, { class: k === i ? 'f-find f-find-cur' : 'f-find' })));
  return { query, matches, index: i, decos };
}

export const findPlugin = new Plugin<FindState>({
  key: findKey,
  state: {
    init: () => ({ query: '', matches: [], index: -1, decos: DecorationSet.empty }),
    apply(tr: Transaction, prev: FindState) {
      const meta = tr.getMeta(findKey) as { query?: string; index?: number } | undefined;
      if (meta) return build(tr.doc, meta.query ?? prev.query, meta.index ?? prev.index);
      if (tr.docChanged && prev.query) return build(tr.doc, prev.query, prev.index);
      return prev;
    },
  },
  props: { decorations: (state) => findKey.getState(state)?.decos },
});

/** Set the query (index = first match at or after the cursor) and select that match. */
export function setQuery(view: EditorView, query: string) {
  const from = view.state.selection.from;
  const matches = search(view.state.doc, query);
  const idx = Math.max(0, matches.findIndex((m) => m.from >= from));
  view.dispatch(view.state.tr.setMeta(findKey, { query, index: idx }));
  reveal(view);
}

export function step(view: EditorView, dir: 1 | -1) {
  const st = findKey.getState(view.state);
  if (!st || !st.matches.length) return;
  const n = st.matches.length;
  view.dispatch(view.state.tr.setMeta(findKey, { index: (st.index + dir + n) % n }));
  reveal(view);
}

function reveal(view: EditorView) {
  const st = findKey.getState(view.state)!;
  const m = st.matches[st.index];
  if (!m) return;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to)).scrollIntoView());
}

export function clearFind(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(findKey, { query: '', index: -1 }));
}

export const findInfo = (state: EditorState) => findKey.getState(state);
