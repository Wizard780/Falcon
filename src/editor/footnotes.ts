import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, NodeSelection, Plugin, PluginKey, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { footnoteText, schema, type FootnoteContent } from './schema';

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

const hasFootnote = (tr: Transaction) => tr.steps.some((s) => {
  const slice = (s as unknown as { slice?: { content: { descendants(f: (n: PMNode) => boolean | void): void } } }).slice;
  let found = false;
  slice?.content.descendants((n) => { if (n.type === FN) found = true; return !found; });
  return found;
});

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
        if (at) view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at.pos)).scrollIntoView());
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

const key = new PluginKey<DecorationSet>('footnotes');

/** Footnote reference at the cursor (Word's Alt-Mod-F); its editor opens right away. */
export const insertFootnote: Command = (state, dispatch) => {
  if (!state.selection.$from.parent.inlineContent) return false;
  if (!dispatch) return true;
  // the selection ends up just after the new reference
  const tr = state.tr.replaceSelectionWith(FN.create({ content: [] }), false);
  dispatch(tr.setSelection(NodeSelection.create(tr.doc, tr.selection.from - 1)).scrollIntoView());
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
    return sel instanceof NodeSelection && sel.node.type === FN ? { pos: sel.from, node: sel.node } : null;
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
    const content = (note.node.attrs.content as FootnoteContent).map((j) => schema.nodeFromJSON(j));
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
    this.inner?.state.doc.firstChild!.forEach((n) => { if (n.isText || n.type.name === 'hard_break') json.push(n.toJSON() as FootnoteContent[number]); });
    return json;
  }
  update() {
    const note = this.selected();
    if (!note) { if (this.inner) this.close(false); return; }
    if (this.inner && note.pos === this.pos) {
      // undo or another change from outside: show what the footnote holds now
      if (JSON.stringify(note.node.attrs.content) !== JSON.stringify(this.innerJson())) { this.close(false); this.open(note); }
      this.num.textContent = `Footnote ${notesOf(this.view.state.doc).findIndex((n) => n.pos === note.pos) + 1}`;
      return;
    }
    if (this.inner) this.close(false);
    this.open(note);
    this.num.textContent = `Footnote ${notesOf(this.view.state.doc).findIndex((n) => n.pos === note.pos) + 1}`;
  }
  destroy() {
    window.removeEventListener('scroll', this.onScroll, true);
    this.inner?.destroy();
    this.dom.remove();
  }
}

/** Footnotes: numbered in order, each one opening its own editor, all listed at the end of the document. */
export const footnotePlugin = new Plugin<DecorationSet>({
  key,
  state: {
    init: (_c, state) => decorate(state.doc),
    apply(tr, set, old) {
      if (!tr.docChanged) return set;
      // renumber only when a footnote could have come or gone or changed
      const before = set.find().length;
      const mapped = set.map(tr.mapping, tr.doc);
      if (before === 0 && !hasFootnote(tr)) return mapped;
      void old;
      return decorate(tr.doc);
    },
  },
  props: { decorations: (state) => key.getState(state) },
  view: (view) => new NoteEditor(view),
});
