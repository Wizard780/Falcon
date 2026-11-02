import type { Command, EditorState } from 'prosemirror-state';
import { schema } from './schema';
import { selectionState } from '../ui/selection-state';

const STYLE_PT: Record<string, number> = { pocket: 26, hat: 22, block: 16, tag: 13, analytic: 13 };

/** The size the font box shows: the selection's own size, else what its style or cite draws at. */
export function fontSizeOf(sel: ReturnType<typeof selectionState> | null): number | null {
  return sel?.size ?? (sel?.marks.has('cite') ? 13 : STYLE_PT[sel?.style ?? ''] ?? null);
}
export const fontSizeAt = (state: EditorState) => fontSizeOf(selectionState(state)) ?? 11;

/** Set the selection's size; with nothing selected it applies to what you type next. */
export const setFontSize = (pt: number): Command => (state, dispatch) => {
  const { from, to, empty } = state.selection;
  const mark = schema.marks.size.create({ pt: Math.max(4, Math.min(72, pt)) });
  dispatch?.(empty ? state.tr.addStoredMark(mark) : state.tr.addMark(from, to, mark));
  return true;
};
