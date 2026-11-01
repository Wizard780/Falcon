import type { Node as PMNode } from 'prosemirror-model';
import { cardAround, isHeading } from './commands';
import { Selection, TextSelection, type Command } from 'prosemirror-state';

/**
 * Word-style paragraph jumps. Up goes to the start of the current paragraph first, then the previous one;
 * Down goes to the start of the next paragraph. With extend, selecting downward stops at paragraph ends.
 */
export function moveByParagraph(dir: -1 | 1, extend: boolean): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    const $head = sel.$head;
    const doc = state.doc;
    if ($head.depth < 1) return false; // select-all
    const idx = $head.index(0);
    let target: number;
    if (dir < 0) {
      const start = $head.start(1);
      if ($head.pos > start) target = start;
      else if (idx > 0) target = doc.resolve($head.before(1) - 1).start(1);
      else target = start;
    } else if (extend) {
      const end = $head.end(1);
      if ($head.pos < end) target = end;
      else if (idx + 1 < doc.childCount) target = doc.resolve($head.after(1) + 1).end(1);
      else target = end;
    } else {
      if (idx + 1 < doc.childCount) target = $head.after(1) + 1;
      else target = $head.end(1);
    }
    if (dispatch) {
      const s = extend ? TextSelection.create(doc, sel.anchor, target) : Selection.near(doc.resolve(target));
      dispatch(state.tr.setSelection(s).scrollIntoView());
    }
    return true;
  };
}


/** PageUp/PageDown: jump to the previous/next heading (pocket, hat, block, tag, analytic). */
export function moveByHeading(dir: -1 | 1, extend: boolean): Command {
  return (state, dispatch) => {
    const doc = state.doc;
    if (state.selection.$head.depth < 1) return false; // select-all
    const idx = state.selection.$head.index(0);
    let target = -1;
    if (dir > 0) {
      for (let i = idx + 1; i < doc.childCount; i++) if (isHeading(doc.child(i))) { target = i; break; }
    } else {
      const atStart = state.selection.$head.parentOffset === 0;
      for (let i = atStart ? idx - 1 : idx; i >= 0; i--) if (isHeading(doc.child(i))) { target = i; break; }
    }
    if (target < 0) return true;
    let pos = 0;
    for (let i = 0; i < target; i++) pos += doc.child(i).nodeSize;
    if (dispatch) {
      const sel = extend ? TextSelection.create(doc, state.selection.anchor, pos + 1) : TextSelection.create(doc, pos + 1);
      dispatch(state.tr.setSelection(sel).scrollIntoView());
    }
    return true;
  };
}

/** Mod-Alt-Up/Down: move the card or heading section at the cursor past its same-level neighbor. */
export function moveContainer(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const doc = state.doc;
    const c = cardAround(doc, state.selection.from);
    if (!c) return false;
    const level = (n: PMNode) => ({ pocket: 1, hat: 2, block: 3, tag: 4, analytic: 4 } as Record<string, number>)[n.attrs.style] ?? 0;
    const myLevel = level(doc.child(c.head));
    const posOf = (i: number) => { let p = 0; for (let k = 0; k < i; k++) p += doc.child(k).nodeSize; return p; };
    let from: number, to: number, insertAt: number;
    if (dir < 0) {
      // previous sibling: the nearest heading above at the same level; a higher-level heading ends the search
      let prev = c.head - 1;
      while (prev >= 0 && !(level(doc.child(prev)) > 0 && level(doc.child(prev)) <= myLevel)) prev--;
      if (prev < 0 || level(doc.child(prev)) < myLevel) return false;
      from = posOf(c.head); to = posOf(c.end); insertAt = posOf(prev);
    } else {
      if (c.end >= doc.childCount) return false;
      const next = cardAround(doc, posOf(c.end) + 1);
      if (!next || level(doc.child(next.head)) < myLevel) return false;
      from = posOf(c.head); to = posOf(c.end); insertAt = posOf(next.end);
    }
    if (!dispatch) return true;
    const slice = doc.slice(from, to);
    const offset = state.selection.from - from;
    const tr = state.tr;
    if (dir < 0) { tr.delete(from, to); tr.insert(insertAt, slice.content); }
    else { tr.insert(insertAt, slice.content); tr.delete(from, to); }
    const newStart = dir < 0 ? insertAt : insertAt - (to - from);
    tr.setSelection(TextSelection.create(tr.doc, Math.min(newStart + offset, tr.doc.content.size - 1)));
    dispatch(tr.scrollIntoView());
    return true;
  };
}
