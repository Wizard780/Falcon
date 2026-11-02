import { chainCommands, deleteSelection, joinBackward, joinForward, selectAll, splitBlockKeepMarks, createParagraphNear, liftEmptyBlock } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { TextSelection, type Command } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import {
  applyEmphasis, clearFormatting, condense, copyPreviousCite, indent, regrow, setParaStyle, shrink,
  toggleBold, toggleCase, toggleCharMark, toggleColorMark, toggleTypingMark, uncondense,
} from './commands';
import { schema } from './schema';
import { activeColors, pastePlainFromClipboard } from './host';
import { moveByHeading, moveByParagraph, moveContainer } from './motion';
import { toggleMarker, toggleRead } from './read';
import { docToolKeys } from './doc-tools';
import { cardToolKeys } from './card-tools';
import { navKeys } from './nav-keys';

const M = schema.marks;
const cardHead = (n: PMNode | null | undefined) => !!n && (n.attrs.style === 'tag' || n.attrs.style === 'analytic');

/**
 * Backspace at a card's edges: never merge body text up into a tag.
 * At the start of a tag, a blank line above is removed; otherwise nothing happens.
 * On an empty line right below a tag, the line is removed.
 */
const backspaceAtCardEdge: Command = (state, dispatch) => {
  const sel = state.selection;
  if (!sel.empty) return false;
  const $c = sel.$from;
  if ($c.parentOffset !== 0 || $c.depth !== 1) return false;
  const idx = $c.index(0);
  if (idx === 0) return false;
  const cur = $c.parent;
  const prev = state.doc.child(idx - 1);
  const prevPos = $c.before(1) - prev.nodeSize;
  if (cardHead(cur)) {
    if (cur.content.size === 0) return false; // empty tag: let it join up and disappear
    if (prev.content.size === 0) {
      if (dispatch) dispatch(state.tr.delete(prevPos, prevPos + prev.nodeSize).scrollIntoView());
      return true;
    }
    return true; // swallow: don't merge a tag into the paragraph above
  }
  if (cardHead(prev)) {
    if (cur.content.size === 0) {
      if (dispatch) {
        const tr = state.tr.delete($c.before(1), $c.after(1));
        dispatch(tr.setSelection(TextSelection.create(tr.doc, prevPos + prev.nodeSize - 1)).scrollIntoView());
      }
      return true;
    }
    return true; // body text never merges into the tag
  }
  return false;
};

/** Delete at the end of a tag: merge with a following tag, drop a following blank line, else nothing. */
const deleteAtCardEdge: Command = (state, dispatch) => {
  const sel = state.selection;
  if (!sel.empty) return false;
  const $c = sel.$from;
  if ($c.depth !== 1 || $c.parentOffset !== $c.parent.content.size) return false;
  const idx = $c.index(0);
  if (idx + 1 >= state.doc.childCount) return false;
  const cur = $c.parent;
  const next = state.doc.child(idx + 1);
  const nextPos = $c.after(1);
  if (cardHead(cur)) {
    if (next.content.size === 0) {
      if (dispatch) dispatch(state.tr.delete(nextPos, nextPos + next.nodeSize));
      return true;
    }
    if (cardHead(next)) return false; // tag + tag merge normally
    return true;
  }
  if (cardHead(next) && cur.content.size > 0) return true; // don't pull a tag into body text
  return false;
};

/** Enter: split, carrying marks (so typing continues underlined); a new line after a heading is body text. */
const enter: Command = chainCommands(createParagraphNear, liftEmptyBlock, (state, dispatch) => {
  const $f = state.selection.$from;
  const atEnd = state.selection.empty && $f.parentOffset === $f.parent.content.size && $f.parent.attrs.style !== 'normal';
  if (!atEnd) return splitBlockKeepMarks(state, dispatch);
  if (!dispatch) return true;
  const pos = $f.after(1);
  const tr = state.tr.insert(pos, schema.nodes.paragraph.create({ style: 'normal', indent: 0 }));
  dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1)).setStoredMarks([]).scrollIntoView());
  return true;
});

const highlight: Command = (state, dispatch) => toggleColorMark(M.highlight, activeColors.highlight)(state, dispatch);
const shading: Command = (state, dispatch) => toggleColorMark(M.shading, activeColors.shading)(state, dispatch);

export const falconKeys: Record<string, Command> = {
  F2: (_s, _d, view) => { if (view) void pastePlainFromClipboard(view); return true; },
  F3: condense('integrity'),
  'Alt-F3': condense('merge'),
  'Mod-Alt-F3': condense('pilcrows'),
  'Mod-Alt-Shift-F3': uncondense,
  'Shift-F3': toggleCase,
  F4: setParaStyle('pocket'),
  F5: setParaStyle('hat'),
  F6: setParaStyle('block'),
  F7: setParaStyle('tag'),
  'Mod-F7': setParaStyle('analytic'),
  'Mod-F8': setParaStyle('undertag'),
  F8: toggleCharMark(M.cite, { skipHeadings: true }),
  'Alt-F8': copyPreviousCite,
  F9: toggleCharMark(M.underline),
  F10: applyEmphasis,
  F11: highlight,
  'Mod-F11': shading,
  F12: clearFormatting,
  'Mod-u': toggleTypingMark(M.underline),
  'Mod-b': toggleBold,
  'Mod-i': toggleTypingMark(M.italic),
  'Mod-8': shrink,
  'Mod-Shift-8': regrow,
  'Mod-Shift-=': toggleTypingMark(M.sup),
  'Mod-z': undo,
  'Mod-Shift-z': redo,
  'Mod-y': redo,
  Tab: indent(1),
  'Shift-Tab': indent(-1),
  Enter: enter,
  Backspace: chainCommands(deleteSelection, backspaceAtCardEdge, joinBackward),
  Delete: chainCommands(deleteSelection, deleteAtCardEdge, joinForward),
  'Mod-a': selectAll,
  'Ctrl-ArrowUp': moveByParagraph(-1, false),
  'Ctrl-ArrowDown': moveByParagraph(1, false),
  'Ctrl-Shift-ArrowUp': moveByParagraph(-1, true),
  'Ctrl-Shift-ArrowDown': moveByParagraph(1, true),
  'Alt-ArrowUp': moveByParagraph(-1, false),
  'Alt-ArrowDown': moveByParagraph(1, false),
  'Alt-Shift-ArrowUp': moveByParagraph(-1, true),
  'Alt-Shift-ArrowDown': moveByParagraph(1, true),
  'Mod-Shift-d': toggleMarker,
  'Mod-Shift-r': toggleRead,
  PageUp: moveByHeading(-1, false),
  PageDown: moveByHeading(1, false),
  'Shift-PageUp': moveByHeading(-1, true),
  'Shift-PageDown': moveByHeading(1, true),
  'Mod-Alt-ArrowUp': moveContainer(-1),
  'Mod-Alt-ArrowDown': moveContainer(1),
  // each feature keeps its own keys in its own file
  ...docToolKeys,
  ...cardToolKeys,
  ...navKeys,
};

export const falconKeymap = () => keymap(falconKeys);
