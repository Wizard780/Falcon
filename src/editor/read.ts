import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, Selection, TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { LEVEL, levelOf, schema, type ParaStyle } from './schema';
import { cardAround } from './commands';
import { P, PREFS_META, pref } from './prefs';
import { keyOf, pressed } from './keybinds';

/**
 * Read mode: only what gets read aloud stays visible (headings, tags, analytics, cites, highlighted
 * text, and red reading markers), and the keyboard is locked so nothing can be edited by accident.
 */
export const readKey = new PluginKey<{ on: boolean; decos: DecorationSet }>('read');

// markers are red unless Settings picks another color; red ones still count after a change
export const isMarker = (marks: readonly { type: { name: string }; attrs: Record<string, unknown> }[]) =>
  marks.some((m) => {
    if (m.type.name !== 'color') return false;
    const c = String(m.attrs.color).toUpperCase();
    return c === '#FF0000' || c === pref(P.markerColor).toUpperCase();
  });
const MARKER_TEXT = /^ ?Marked( \d{1,2}:\d{2})? ?$/;
/** Read mode shows red text (as it always has) and markers in the color Settings picks, but not other text in that color. */
const shownMarker = (n: PMNode) => n.marks.some((m) => m.type.name === 'color' && String(m.attrs.color).toUpperCase() === '#FF0000') || (isMarker(n.marks) && MARKER_TEXT.test(n.text ?? ''));

/** What read mode shows of one paragraph: a flag per child node, and whether it runs into the shown paragraph above. */
export type ReadPara = { heading: boolean; shown: boolean[]; flow: boolean };

/**
 * The read-mode view of the doc, one entry per paragraph. Headings show whole. In a card, cites,
 * highlighted text and red reading markers show; the rest hides. After a card's first shown paragraph
 * (its cite), shown paragraphs flow together the way CardMirror's read mode does, unless Settings keeps
 * paragraphs apart. Settings can also show undertags, whole cites and background color.
 * The on-screen read mode and the Read Doc export both come from this, so they never disagree.
 */
export function readView(doc: PMNode): ReadPara[] {
  const out: ReadPara[] = [];
  const keepParas = pref(P.readParas), wholeCite = pref(P.readWholeCite), undertags = pref(P.readUndertags), shading = pref(P.readShading);
  const isRead = (n: PMNode) => n.marks.some((m) => m.type.name === 'highlight' || m.type.name === 'cite' || (shading && m.type.name === 'shading')) || shownMarker(n);
  let inCard = false, cardHasShown = false;
  doc.forEach((para) => {
    // a table shows whole, like a heading, and doesn't change which card the text after it belongs to
    if (!para.isTextblock) { out.push({ heading: true, shown: [], flow: false }); return; }
    const level = levelOf(para);
    if (level > 0) { inCard = level === 4; cardHasShown = false; out.push({ heading: true, shown: [], flow: false }); return; }
    const shown: boolean[] = [];
    const under = para.attrs.style === 'undertag';
    // the card's cite line, shown whole: the first shown paragraph, when it has cite-marked text
    const cite = wholeCite && !cardHasShown && !under && para.content.content.some((n) => n.marks.some((m) => m.type.name === 'cite'));
    para.forEach((n) => shown.push(n.isText && inCard && (under ? undertags : cite || isRead(n))));
    const any = shown.some(Boolean);
    out.push({ heading: false, shown, flow: any && cardHasShown && !keepParas });
    if (any && !under) cardHasShown = true;
  });
  return out;
}

/**
 * Every text run gets a class: f-read-shown, or f-read-hidden (plus f-read-gap when it sits between two
 * shown runs, so the reader sees one space instead of glued words); flowing paragraphs get f-read-flow.
 */
function hideUnread(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  const view = readView(doc);
  doc.forEach((para, pos, idx) => {
    const { heading, shown, flow } = view[idx];
    if (heading) return;
    if (!shown.some(Boolean)) { decos.push(Decoration.node(pos, pos + para.nodeSize, { class: 'f-read-hidden' })); return; }
    if (flow) decos.push(Decoration.node(pos, pos + para.nodeSize, { class: 'f-read-flow' }));
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
      if (meta !== undefined || tr.docChanged || tr.getMeta(PREFS_META)) return { on, decos: hideUnread(tr.doc) };
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
      if (pressed(ev, keyOf('read')) || pressed(ev, keyOf('marker'))) return false; // read mode and marker, at the keys Settings has: handled by the keymap
      if (/^(Arrow|Page|Home|End|Escape|Shift|Control|Alt|Meta)/.test(ev.key)) return false;
      if (mod && /^[ac]$/i.test(ev.key)) return false; // select all, copy (Find is the app's: it never gets here)
      return true;
    },
    handleTextInput: (view) => !!readKey.getState(view.state)?.on,
    handlePaste: (view) => !!readKey.getState(view.state)?.on,
    handleDrop: (view) => !!readKey.getState(view.state)?.on,
  },
});

export const isReading = (state: EditorState) => !!readKey.getState(state)?.on;

export const toggleRead: Command = (state, dispatch) => {
  if (!dispatch) return true;
  const tr = state.tr.setMeta(readKey, !isReading(state)).setMeta('addToHistory', false);
  // "Jump to the top": the cursor goes to the start and the page scrolls there
  if (pref(P.readTop)) tr.setSelection(Selection.atStart(state.doc)).scrollIntoView();
  dispatch(tr);
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
    if (n.isText && isMarker(n.marks) && MARKER_TEXT.test(n.text!)) markers.push({ from: pos, to: pos + n.nodeSize });
    return true;
  });
  const onMarker = markers.some((m) => $c.pos >= m.from && $c.pos <= m.to);
  if (!dispatch) return true;
  const tr = state.tr;
  for (const m of [...markers].sort((a, b) => b.from - a.from)) tr.delete(m.from, m.to);
  if (!onMarker) {
    const now = new Date();
    const text = pref(P.markerTime) ? ` Marked ${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')} ` : ' Marked ';
    const at = tr.mapping.map($c.pos);
    tr.insert(at, schema.text(text, [schema.marks.color.create({ color: pref(P.markerColor) })]));
    tr.setSelection(TextSelection.create(tr.doc, at + text.length)).setStoredMarks([]);
  }
  dispatch(tr.scrollIntoView());
  return true;
};
