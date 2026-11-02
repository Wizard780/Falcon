import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import { Plugin, Selection, SelectionRange, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import type { Mappable } from 'prosemirror-transform';
import { Decoration, DecorationSet } from 'prosemirror-view';

export type Span = { from: number; to: number };

/**
 * Several separate stretches selected at once (Ctrl/Cmd-click). Formatting commands act on every
 * stretch because they iterate `selection.ranges`. The browser only draws the last stretch, so
 * the others are drawn by the plugin below.
 */
export class MultiSelection extends Selection {
  constructor(ranges: SelectionRange[]) {
    const last = ranges[ranges.length - 1];
    // anchor/head follow the most recent stretch, which is the one the browser shows
    super(last.$from, last.$to, ranges);
  }

  static create(doc: PMNode, spans: Span[]): Selection {
    const clean = normalize(spans.filter((s) => s.to > s.from), doc.content.size);
    if (!clean.length) return TextSelection.create(doc, Math.min(spans[spans.length - 1]?.from ?? 1, doc.content.size));
    if (clean.length === 1) return TextSelection.create(doc, clean[0].from, clean[0].to);
    return new MultiSelection(clean.map((s) => new SelectionRange(doc.resolve(s.from), doc.resolve(s.to))));
  }

  get spans(): Span[] {
    return this.ranges.map((r) => ({ from: r.$from.pos, to: r.$to.pos }));
  }

  map(doc: PMNode, mapping: Mappable): Selection {
    return MultiSelection.create(doc, this.spans.map((s) => ({ from: mapping.map(s.from, 1), to: mapping.map(s.to, -1) })));
  }

  eq(other: Selection): boolean {
    if (!(other instanceof MultiSelection) || other.ranges.length !== this.ranges.length) return false;
    return this.ranges.every((r, i) => r.$from.pos === other.ranges[i].$from.pos && r.$to.pos === other.ranges[i].$to.pos);
  }

  /** Copy/cut: the stretches stitched together in document order, one paragraph each. */
  content(): Slice {
    const doc = this.$anchor.doc;
    const paras: PMNode[] = [];
    for (const s of [...this.spans].sort((a, b) => a.from - b.from)) {
      doc.nodesBetween(s.from, s.to, (node, pos) => {
        if (!node.isTextblock) return true;
        const a = Math.max(s.from, pos + 1) - pos - 1;
        const b = Math.min(s.to, pos + 1 + node.content.size) - pos - 1;
        if (b > a) paras.push(node.copy(node.content.cut(a, b)));
        return false;
      });
    }
    return new Slice(Fragment.from(paras), 0, 0);
  }

  /** Typing or pasting over several stretches: delete them all and put the new content at the last one. */
  replace(tr: Transaction, content = Slice.empty) {
    const spans = [...this.spans].sort((a, b) => b.from - a.from);
    const last = this.spans[this.spans.length - 1];
    for (const s of spans) if (s !== last && !(s.from === last.from && s.to === last.to)) tr.delete(s.from, s.to);
    const from = tr.mapping.map(last.from), to = tr.mapping.map(last.to);
    tr.replaceRange(from, to, content);
    // the cursor goes after the new content, searching back into it when it ends inline, as ProseMirror's own selections do
    let end: PMNode | null = content.content.lastChild, parent: PMNode | null = null;
    for (let i = 0; i < content.openEnd; i++) { parent = end; end = end?.lastChild ?? null; }
    tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(last.to)), (end ? end.isInline : parent?.isTextblock) ? -1 : 1));
  }

  /** Typing, F2, a footnote or a picture: ProseMirror inserts nodes through here, not `replace`. */
  replaceWith(tr: Transaction, node: PMNode) {
    this.replace(tr, new Slice(Fragment.from(node), 0, 0));
  }

  toJSON() {
    return { type: 'falcon-multi', spans: this.spans };
  }

  static fromJSON(doc: PMNode, json: { spans: Span[] }) {
    return MultiSelection.create(doc, json.spans);
  }
}
Selection.jsonID('falcon-multi', MultiSelection);

/** Sorted, merged, clamped spans. */
function normalize(spans: Span[], size: number): Span[] {
  const s = spans.map((x) => ({ from: Math.max(0, Math.min(x.from, size)), to: Math.max(0, Math.min(x.to, size)) })).filter((x) => x.to > x.from);
  s.sort((a, b) => a.from - b.from);
  const out: Span[] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x.from <= last.to) last.to = Math.max(last.to, x.to);
    else out.push({ ...x });
  }
  return out;
}

/** The selection's stretches as plain spans (one for an ordinary selection). */
export function spansOf(sel: Selection): Span[] {
  return sel instanceof MultiSelection ? sel.spans : sel.empty ? [] : [{ from: sel.from, to: sel.to }];
}

/** Draws every stretch of a multi-selection (the browser can only show one). */
export const multiSelectionPlugin = new Plugin({
  props: {
    decorations(state: EditorState) {
      if (!(state.selection instanceof MultiSelection)) return null;
      return DecorationSet.create(state.doc, state.selection.spans.map((s) => Decoration.inline(s.from, s.to, { class: 'f-multisel' })));
    },
    handleKeyDown(view, ev) {
      const sel = view.state.selection;
      if (!(sel instanceof MultiSelection)) return false;
      if (ev.key === 'Escape' || ev.key.startsWith('Arrow') || ev.key === 'Home' || ev.key === 'End') {
        // leaving a multi-selection: collapse onto the last stretch, then let the key move from there
        const last = sel.spans[sel.spans.length - 1];
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, last.from, last.to)));
        return ev.key === 'Escape';
      }
      if (ev.key === 'Backspace' || ev.key === 'Delete') {
        const tr = view.state.tr;
        for (const s of [...sel.spans].sort((a, b) => b.from - a.from)) tr.delete(s.from, s.to);
        view.dispatch(tr.scrollIntoView());
        return true;
      }
      return false;
    },
  },
});
