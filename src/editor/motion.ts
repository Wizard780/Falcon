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
