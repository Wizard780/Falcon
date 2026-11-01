import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { LEVEL, schema, type ParaStyle } from './schema';
import { cardAround } from './commands';

/**
 * Read mode: only what gets read aloud stays visible (headings, tags, analytics, cites, highlighted
 * text, and red reading markers), and the keyboard is locked so nothing can be edited by accident.
 */
export const readKey = new PluginKey<{ on: boolean; decos: DecorationSet }>('read');

const MARKER_COLOR = '#FF0000';
const isMarker = (marks: readonly { type: { name: string }; attrs: Record<string, unknown> }[]) =>
  marks.some((m) => m.type.name === 'color' && String(m.attrs.color).toUpperCase() === MARKER_COLOR);
const isRead = (n: PMNode) => n.marks.some((m) => m.type.name === 'highlight' || m.type.name === 'cite') || isMarker(n.marks);

/**
 * Every text run gets a class: f-read-shown, or f-read-hidden (plus f-read-gap when it sits between two
 * shown runs, so the reader sees one space instead of glued words). After a card's first shown paragraph
 * (its cite), shown paragraphs get f-read-flow and run together the way CardMirror's read mode does.
 */
function hideUnread(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  let inCard = false, cardHasShown = false;
  doc.forEach((para, pos) => {
    const level = LEVEL[para.attrs.style as ParaStyle];
    if (level > 0) { inCard = level === 4; cardHasShown = false; return; }
    const shown: boolean[] = [];
    para.forEach((n) => shown.push(n.isText && inCard && para.attrs.style !== 'undertag' && isRead(n)));
    if (!shown.some(Boolean)) { decos.push(Decoration.node(pos, pos + para.nodeSize, { class: 'f-read-hidden' })); return; }
    if (cardHasShown) decos.push(Decoration.node(pos, pos + para.nodeSize, { class: 'f-read-flow' }));
    cardHasShown = true;
    const lastShown = shown.lastIndexOf(true);
    para.forEach((n, off, i) => {
      const from = pos + 1 + off, to = from + n.nodeSize;
      if (shown[i]) decos.push(Decoration.inline(from, to, { class: 'f-read-shown' }));
      else decos.push(Decoration.inline(from, to, { class: i > 0 && shown[i - 1] && i < lastShown ? 'f-read-hidden f-read-gap' : 'f-read-hidden' }));
    });
  });
  return DecorationSet.create(doc, decos);
}

export const readPlugin = new Plugin<{ on: boolean; decos: DecorationSet }>({
  key: readKey,
  state: {
    init: () => ({ on: false, decos: DecorationSet.empty }),
    apply(tr, prev) {
      const meta = tr.getMeta(readKey) as boolean | undefined;
      const on = meta ?? prev.on;
      if (!on) return { on, decos: DecorationSet.empty };
      if (meta !== undefined || tr.docChanged) return { on, decos: hideUnread(tr.doc) };
      return prev;
    },
  },
  props: {
    decorations: (state) => readKey.getState(state)?.decos,
    attributes: (state): Record<string, string> => (readKey.getState(state)?.on ? { class: 'f-read' } : {}),
    // the keyboard is locked: reading, moving, copying and finding still work; typing does nothing
    handleKeyDown(view, ev) {
      if (!readKey.getState(view.state)?.on) return false;
      const mod = ev.metaKey || ev.ctrlKey;
      if (ev.key === ' ' || ev.key === 'Enter') { toggleMarker(view.state, view.dispatch); return true; }
      if (mod && ev.shiftKey && ev.key.toLowerCase() === 'd') return false; // handled by the keymap
      if (/^(Arrow|Page|Home|End|Escape|Shift|Control|Alt|Meta)/.test(ev.key)) return false;
      if (mod && /^[acf]$/i.test(ev.key)) return false;
      return true;
    },
    handleTextInput: (view) => !!readKey.getState(view.state)?.on,
    handlePaste: (view) => !!readKey.getState(view.state)?.on,
    handleDrop: (view) => !!readKey.getState(view.state)?.on,
  },
});

export const isReading = (state: EditorState) => !!readKey.getState(state)?.on;

export const toggleRead: Command = (state, dispatch) => {
  if (dispatch) dispatch(state.tr.setMeta(readKey, !isReading(state)).setMeta('addToHistory', false));
  return true;
};

/**
 * Mod-Shift-D (and Space/Enter in read mode): drop a red "Marked h:mm" at the cursor, replacing any
 * other marker in the card; on an existing marker, remove it.
 */
export const toggleMarker: Command = (state, dispatch) => {
  const doc = state.doc;
  const $c = state.selection.$from;
  if ($c.depth < 1) return false;
  // markers in this card (or this paragraph when it's not in a card)
  const card = cardAround(doc, $c.pos);
  let from = $c.before(1), to = $c.after(1);
  if (card) {
    let p = 0;
    for (let i = 0; i < card.end; i++) { if (i === card.head) from = p; p += doc.child(i).nodeSize; }
    to = p;
  }
  const markers: { from: number; to: number }[] = [];
  doc.nodesBetween(from, to, (n, pos) => {
    if (n.isText && isMarker(n.marks) && /^ ?Marked \d{1,2}:\d{2} ?$/.test(n.text!)) markers.push({ from: pos, to: pos + n.nodeSize });
    return true;
  });
  const onMarker = markers.some((m) => $c.pos >= m.from && $c.pos <= m.to);
  if (!dispatch) return true;
  const tr = state.tr;
  for (const m of [...markers].sort((a, b) => b.from - a.from)) tr.delete(m.from, m.to);
  if (!onMarker) {
    const now = new Date();
    const text = ` Marked ${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')} `;
    const at = tr.mapping.map($c.pos);
    tr.insert(at, schema.text(text, [schema.marks.color.create({ color: MARKER_COLOR })]));
    tr.setSelection(TextSelection.create(tr.doc, at + text.length)).setStoredMarks([]);
  }
  dispatch(tr.scrollIntoView());
  return true;
};
