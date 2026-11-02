import { chainCommands, deleteSelection, joinBackward, joinForward, selectAll, splitBlockKeepMarks, createParagraphNear, liftEmptyBlock } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import { keydownHandler } from 'prosemirror-keymap';
import { Plugin, TextSelection, type Command } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import {
  applyEmphasis, clearFormatting, condense, copyPreviousCite, indent, regrow, setParaStyle, shrink,
  toggleBold, toggleCase, toggleCharMark, toggleColorMark, toggleTypingMark,
} from './commands';
import { schema } from './schema';
import { ENTER_AFTER, P, onPrefs, pref } from './prefs';
import { activeColors, pastePlainFromClipboard } from './host';
import { moveByHeading, moveByParagraph, moveContainer } from './motion';
import { toggleMarker, toggleRead } from './read';
import { DOC_TOOLS } from './doc-tools';
import { CARD_TOOLS } from './card-tools';
import { navBinds, navFixed } from './nav-keys';
import { BINDINGS, bind, bindingOf, isRecording, keyOf, reserve } from './keybinds';

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

/** Enter: split, carrying marks (so typing continues underlined); a new line after a heading is body text,
 *  or the style Settings picks for that heading. */
const enter: Command = chainCommands(createParagraphNear, liftEmptyBlock, (state, dispatch) => {
  const $f = state.selection.$from;
  const atEnd = state.selection.empty && $f.parentOffset === $f.parent.content.size && $f.parent.attrs.style !== 'normal';
  if (!atEnd) return splitBlockKeepMarks(state, dispatch);
  if (!dispatch) return true;
  const pos = $f.after(1);
  const next = ENTER_AFTER[$f.parent.attrs.style];
  const tr = state.tr.insert(pos, schema.nodes.paragraph.create({ style: next ? pref(next) : 'normal', indent: 0 }));
  dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1)).setStoredMarks([]).scrollIntoView());
  return true;
});

const highlight: Command = (state, dispatch) => toggleColorMark(M.highlight, activeColors.highlight)(state, dispatch);
const shading: Command = (state, dispatch) => toggleColorMark(M.shading, activeColors.shading)(state, dispatch);

/** Keys that stay put: typing, undo, and the second keys that move by paragraph. Settings can't take them. */
const FIXED: [key: string, label: string, run: Command][] = [
  ['Mod-u', 'Underline as you type', toggleTypingMark(M.underline)],
  ['Mod-b', 'Bold', toggleBold],
  ['Mod-i', 'Italic', toggleTypingMark(M.italic)],
  ['Mod-Shift-=', 'Superscript', toggleTypingMark(M.sup)],
  ['Mod-z', 'Undo', undo],
  ['Mod-Shift-z', 'Redo', redo],
  ['Mod-y', 'Redo', redo],
  ['Tab', 'Indent', indent(1)],
  ['Shift-Tab', 'Outdent', indent(-1)],
  ['Enter', 'New line', enter],
  ['Backspace', 'Delete back', chainCommands(deleteSelection, backspaceAtCardEdge, joinBackward)],
  ['Delete', 'Delete forward', chainCommands(deleteSelection, deleteAtCardEdge, joinForward)],
  ['Mod-a', 'Select all', selectAll],
  ['Ctrl-ArrowUp', 'Previous paragraph', moveByParagraph(-1, false)],
  ['Ctrl-ArrowDown', 'Next paragraph', moveByParagraph(1, false)],
  ['Ctrl-Shift-ArrowUp', 'Select to the previous paragraph', moveByParagraph(-1, true)],
  ['Ctrl-Shift-ArrowDown', 'Select to the next paragraph', moveByParagraph(1, true)],
  ['Alt-ArrowUp', 'Previous paragraph', moveByParagraph(-1, false)],
  ['Alt-ArrowDown', 'Next paragraph', moveByParagraph(1, false)],
  ['Alt-Shift-ArrowUp', 'Select to the previous paragraph', moveByParagraph(-1, true)],
  ['Alt-Shift-ArrowDown', 'Select to the next paragraph', moveByParagraph(1, true)],
  ['Shift-PageUp', 'Select to the previous heading', moveByHeading(-1, true)],
  ['Shift-PageDown', 'Select to the next heading', moveByHeading(1, true)],
  ...navFixed,
];
reserve(FIXED.map(([k, what]) => [k, what]));

// the commands Settings can rebind, in the order Settings lists them (App and Files come first, from keybinds.ts)
bind('Cutting', [
  { id: 'pastePlain', label: 'Paste as plain text', key: 'F2', run: (_s, _d, view) => { if (view) void pastePlainFromClipboard(view); return true; } },
  // F3 runs the condense Settings picks; Alt-F3 and Mod-Alt-F3 always merge (Card tools)
  { id: 'condense', label: 'Condense paragraph', key: 'F3', run: (state, dispatch) => condense(pref(P.condense))(state, dispatch) },
  { id: 'changeCase', label: 'Change case', key: 'Shift-F3', run: toggleCase },
  { id: 'pocket', label: 'Pocket', key: 'F4', run: setParaStyle('pocket') },
  { id: 'hat', label: 'Hat', key: 'F5', run: setParaStyle('hat') },
  { id: 'block', label: 'Block', key: 'F6', run: setParaStyle('block') },
  { id: 'tag', label: 'Tag', key: 'F7', run: setParaStyle('tag') },
  { id: 'analytic', label: 'Analytic', key: 'Mod-F7', run: setParaStyle('analytic') },
  { id: 'undertag', label: 'Undertag', key: 'Mod-F8', run: setParaStyle('undertag') },
  { id: 'cite', label: 'Cite', key: 'F8', run: toggleCharMark(M.cite, { skipHeadings: true }) },
  { id: 'copyCite', label: 'Copy previous cite', key: 'Alt-F8', run: copyPreviousCite },
  { id: 'underline', label: 'Underline', key: 'F9', run: toggleCharMark(M.underline) },
  { id: 'emphasis', label: 'Emphasis', key: 'F10', run: applyEmphasis },
  { id: 'highlight', label: 'Highlight', key: 'F11', run: highlight },
  { id: 'shading', label: 'Background color', key: 'Mod-F11', run: shading },
  { id: 'clear', label: 'Clear formatting', key: 'F12', run: clearFormatting },
  { id: 'shrink', label: 'Shrink card', key: 'Mod-8', run: shrink },
  { id: 'regrow', label: 'Undo shrink', key: 'Mod-Shift-8', run: regrow },
]);
bind('Moving around', [
  { id: 'prevHeading', label: 'Previous heading', key: 'PageUp', run: moveByHeading(-1, false) },
  { id: 'nextHeading', label: 'Next heading', key: 'PageDown', run: moveByHeading(1, false) },
  { id: 'cardUp', label: 'Move card up', key: 'Mod-Alt-ArrowUp', run: moveContainer(-1) },
  { id: 'cardDown', label: 'Move card down', key: 'Mod-Alt-ArrowDown', run: moveContainer(1) },
  { id: 'read', label: 'Read mode', key: 'Mod-Shift-r', run: toggleRead },
  { id: 'marker', label: 'Read marker', key: 'Mod-Shift-d', run: toggleMarker },
  // each feature keeps its own keys in its own file
  ...navBinds,
]);
bind('Doc tools', DOC_TOOLS.flatMap((s) => s.items));
bind('Card tools', CARD_TOOLS.flatMap((s) => s.items));

/** The command a binding runs (toolbar buttons run the same command their key does). */
export const commandOf = (id: string): Command => bindingOf(id)?.run ?? (() => false);

/** Every key with its default binding: the keymap as it ships (tests and the CardMirror probe use it). */
export const falconKeys: Record<string, Command> = Object.fromEntries([
  ...FIXED.map(([k, , run]) => [k, run]),
  ...BINDINGS.filter((b) => b.run && b.key).map((b) => [b.key, b.run!]),
]);

/** The keymap as Settings has it now: fixed keys plus each binding at its current key. */
export function liveKeys(): Record<string, Command> {
  const m: Record<string, Command> = Object.fromEntries(FIXED.map(([k, , run]) => [k, run]));
  for (const b of BINDINGS) {
    const k = keyOf(b.id);
    if (b.run && k) m[k] = b.run;
  }
  return m;
}
let handler = keydownHandler(liveKeys());
onPrefs(() => { handler = keydownHandler(liveKeys()); });

/** The editor's keymap, following Settings > Keybindings as it changes. */
export const falconKeymap = () => new Plugin({ props: { handleKeyDown: (view, e) => !isRecording() && handler(view, e) } });
