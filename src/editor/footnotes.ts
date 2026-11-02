import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, NodeSelection, Plugin, PluginKey, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { AttrStep } from 'prosemirror-transform';
import { footnoteText, noteNodes, schema, type FootnoteContent } from './schema';

const FN = schema.nodes.footnote;
type Note = { pos: number; node: PMNode };

/** Footnotes in document order. */
function notesOf(doc: PMNode): Note[] {
  const out: Note[] = [];
  doc.descendants((node, pos) => {
    if (node.type === FN) out.push({ pos, node });
    return node.isBlock; // inline content can't hold blocks: stop at text level
  });
  return out;
}

/** Whether a transaction added, removed or changed a footnote: only then are the numbers and the list redone. */
const touchesFootnote = (tr: Transaction) => tr.steps.some((step, i) => {
  const doc = tr.docs[i];
  let found = false;
  const hit = (n: PMNode) => { if (n.type === FN) found = true; return !found; };
  if (step instanceof AttrStep) return doc.nodeAt(step.pos)?.type === FN;
  step.getMap().forEach((from, to) => { if (!found && to > from) doc.nodesBetween(from, to, hit); });
  (step as { slice?: { content: { descendants(f: (n: PMNode) => boolean): void } } }).slice?.content.descendants(hit);
  return found;
});

/** Transactions that open a footnote's editor (a click, Insert Footnote, the list). Arrowing onto one doesn't. */
const OPEN = 'footnoteOpen';
type FnState = { decos: DecorationSet; open: boolean };

/** The notes listed under the document, each one clickable to open it. */
function listWidget(notes: Note[]) {
  return (view: EditorView) => {
    const box = document.createElement('div');
    box.className = 'f-notes';
    box.contentEditable = 'false';
    const ol = document.createElement('ol');
    notes.forEach((n, i) => {
      const li = document.createElement('li');
      li.dataset.n = String(i + 1);
      li.textContent = footnoteText(n.node.attrs.content) || ' ';
      li.title = 'Edit this footnote';
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const at = notesOf(view.state.doc)[i];
        if (at) view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at.pos)).setMeta(OPEN, true).scrollIntoView());
      });
      ol.append(li);
    });
    box.append(ol);
    return box;
  };
}

function decorate(doc: PMNode): DecorationSet {
  const notes = notesOf(doc);
  if (!notes.length) return DecorationSet.empty;
  const decos = notes.map((n, i) => Decoration.node(n.pos, n.pos + 1, { 'data-n': String(i + 1) }));
  const key = notes.map((n) => footnoteText(n.node.attrs.content)).join('\u0000');
  decos.push(Decoration.widget(doc.content.size, listWidget(notes), { side: 1, key: `notes:${key}`, ignoreSelection: true, stopEvent: () => true }));
  return DecorationSet.create(doc, decos);
}

const key = new PluginKey<FnState>('footnotes');
/** The number shown on the footnote at `pos` (its place in document order). */
const numberAt = (state: EditorState, pos: number) => key.getState(state)!.decos.find(0, pos + 1).filter((d) => d.to > d.from && d.from <= pos).length;

/** Footnote reference at the cursor (Word's Alt-Mod-F); its editor opens right away. */
export const insertFootnote: Command = (state, dispatch) => {
  if (!state.selection.$from.parent.inlineContent) return false;
  if (!dispatch) return true;
  // the selection ends up just after the new reference
  const tr = state.tr.replaceSelectionWith(FN.create({ content: [] }), false);
  dispatch(tr.setSelection(NodeSelection.create(tr.doc, tr.selection.from - 1)).setMeta(OPEN, true).scrollIntoView());
  return true;
};

/**
 * The footnote editor: a small editor under a selected footnote. What you type there is the note; it saves
 * as you go (Mod-Z there undoes inside the note). Escape or Enter goes back to the text after the reference.
 */
class NoteEditor {
  dom = document.createElement('div');
  private inner: EditorView | null = null;
  private pos = -1;
  private num = document.createElement('span');
  constructor(private view: EditorView) {
    this.dom.className = 'f-note-pop';
    this.dom.setAttribute('role', 'dialog');
    this.dom.setAttribute('aria-label', 'Footnote');
    this.num.className = 'f-note-num';
    this.dom.append(this.num);
    this.dom.hidden = true;
    document.body.append(this.dom);
    this.onScroll = this.onScroll.bind(this);
    window.addEventListener('scroll', this.onScroll, true);
    this.update();
  }
  private onScroll() { if (!this.dom.hidden) this.place(); }
  private selected(): Note | null {
    const sel = this.view.state.selection;
    return key.getState(this.view.state)?.open && sel instanceof NodeSelection && sel.node.type === FN ? { pos: sel.from, node: sel.node } : null;
  }
  private place() {
    const c = this.view.coordsAtPos(this.pos);
    const w = Math.min(420, window.innerWidth - 24);
    this.dom.style.width = `${w}px`;
    this.dom.style.left = `${Math.max(12, Math.min(c.left - 16, window.innerWidth - w - 12))}px`;
    this.dom.style.top = `${Math.round(c.bottom + 8)}px`;
  }
  private close(back: boolean) {
    this.inner?.destroy();
    this.inner = null;
    this.dom.hidden = true;
    if (back) {
      const after = Math.min(this.pos + 1, this.view.state.doc.content.size);
      this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, after)));
      this.view.focus();
    }
    this.pos = -1;
  }
  private open(note: Note) {
    this.pos = note.pos;
    const content = noteNodes(note.node.attrs.content);
    const doc = schema.node('doc', null, [schema.nodes.paragraph.create(null, content)]);
    const leave: Command = () => { this.close(true); return true; };
    const state = EditorState.create({
      doc,
      plugins: [
        keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo, Escape: leave, Enter: leave, 'Shift-Enter': (s, d) => { d?.(s.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView()); return true; },
          'Mod-b': toggleMark(schema.marks.bold), 'Mod-i': toggleMark(schema.marks.italic), 'Mod-u': toggleMark(schema.marks.underline) }),
        keymap(baseKeymap),
        history(),
      ],
    });
    this.inner = new EditorView(this.dom, {
      state,
      attributes: { class: 'f-note-text', spellcheck: 'false', 'aria-label': 'Footnote text' },
      dispatchTransaction: (tr) => {
        const inner = this.inner!;
        inner.updateState(inner.state.apply(tr));
        if (!tr.docChanged) return;
        const json = this.innerJson();
        const outer = this.view.state;
        if (outer.doc.nodeAt(this.pos)?.type !== FN) return;
        this.view.dispatch(outer.tr.setNodeAttribute(this.pos, 'content', json));
      },
    });
    this.dom.hidden = false;
    this.place();
    this.inner.focus();
    this.inner.dispatch(this.inner.state.tr.setSelection(TextSelection.atEnd(this.inner.state.doc)));
  }
  /** What the little editor holds, as a footnote's content: text and line breaks only. */
  private innerJson(): FootnoteContent {
    const json: FootnoteContent = [];
    // a paste can split the little editor into paragraphs: the note keeps them all, a line break between each
    this.inner?.state.doc.forEach((p, _o, i) => {
      if (i > 0) json.push({ type: 'hard_break' });
      p.forEach((n) => { if (n.isText || n.type.name === 'hard_break') json.push(n.toJSON() as FootnoteContent[number]); });
    });
    return json;
  }
  update() {
    const note = this.selected();
    if (!note) { if (this.inner) this.close(false); return; }
    if (this.inner && note.pos === this.pos) {
      // undo or another change from outside: show what the footnote holds now
      // compared the way the little editor holds it (it merges neighbouring runs with the same marks)
      const want = schema.nodes.paragraph.create(null, noteNodes(note.node.attrs.content)).content.toJSON() ?? [];
      if (JSON.stringify(want) !== JSON.stringify(this.innerJson())) { this.close(false); this.open(note); }
      this.num.textContent = `Footnote ${numberAt(this.view.state, note.pos)}`;
      return;
    }
    if (this.inner) this.close(false);
    this.open(note);
    this.num.textContent = `Footnote ${numberAt(this.view.state, note.pos)}`;
  }
  destroy() {
    window.removeEventListener('scroll', this.onScroll, true);
    this.inner?.destroy();
    this.dom.remove();
  }
}

/** Footnotes: numbered in order, each one opening its own editor, all listed at the end of the document. */
export const footnotePlugin = new Plugin<FnState>({
  key,
  state: {
    init: (_c, state) => ({ decos: decorate(state.doc), open: false }),
    apply(tr, prev, _old, state) {
      const decos = !tr.docChanged ? prev.decos : touchesFootnote(tr) ? decorate(tr.doc) : prev.decos.map(tr.mapping, tr.doc);
      const sel = state.selection;
      const onNote = sel instanceof NodeSelection && sel.node.type === FN;
      // a click selects with ProseMirror's 'pointer' meta; edits from the editor keep it open
      const open = onNote && (!!tr.getMeta(OPEN) || !!tr.getMeta('pointer') || (prev.open && !tr.selectionSet));
      return { decos, open };
    },
  },
  props: { decorations: (state) => key.getState(state)?.decos },
  view: (view) => new NoteEditor(view),
});
