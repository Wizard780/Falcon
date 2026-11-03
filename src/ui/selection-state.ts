import type { EditorState } from 'prosemirror-state';
import type { Mark } from 'prosemirror-model';
import type { ParaStyle } from '../editor/schema';
import { readWords } from '../editor/outline';

/** What the toolbar lights up: the paragraph style at the cursor and the marks the selection fully carries. */
export function selectionState(state: EditorState) {
  const { selection } = state;
  const style = selection.$from.parent.attrs.style as ParaStyle;
  let marks: Set<string>;
  let size: number | null = null;
  let selWords = 0;
  let selRead = 0;
  if (selection.empty) {
    const ms: readonly Mark[] = state.storedMarks ?? selection.$from.marks();
    marks = new Set(ms.map((m) => m.type.name));
    size = ms.find((m) => m.type.name === 'size')?.attrs.pt ?? null;
  } else {
    let first = true;
    marks = new Set();
    const sizes = new Set<number | null>();
    state.doc.nodesBetween(selection.from, selection.to, (n) => {
      if (!n.isText) return true;
      const names = new Set(n.marks.map((m) => m.type.name));
      sizes.add(n.marks.find((m) => m.type.name === 'size')?.attrs.pt ?? null);
      if (first) { marks = names; first = false; } else for (const m of marks) if (!names.has(m)) marks.delete(m);
      return false;
    });
    size = sizes.size === 1 ? [...sizes][0] : null;
    selWords = (state.doc.textBetween(selection.from, selection.to, ' ').match(/[\p{L}\p{N}]+/gu) ?? []).length;
    selRead = readWords(state.doc.cut(selection.from, selection.to));
  }
  return { style, marks, size, selWords, selRead };
}
