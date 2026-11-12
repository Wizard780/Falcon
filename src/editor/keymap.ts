import { chainCommands, deleteSelection, joinBackward, joinForward, selectAll, splitBlockKeepMarks, createParagraphNear, liftEmptyBlock } from 'prosemirror-commands';
import { undo } from 'prosemirror-history';
import { keydownHandler } from 'prosemirror-keymap';
import { Plugin, TextSelection, type Command } from 'prosemirror-state';
import {
  applyEmphasis, clearFormatting, condenseBySettings, copyPreviousCite, indent, isCardHead, regrow, setParaStyle, shrink,
  toggleBold, toggleCase, toggleCharMark, toggleColorMark, toggleTypingMark,
} from './commands';
import { schema } from './schema';
import type { Node as PMNode } from 'prosemirror-model';
import { ENTER_AFTER, onPrefs, pref } from './prefs';
import { activeColors, pastePlainFromClipboard } from './host';
import { moveByHeading, moveByParagraph, moveContainer } from './motion';
import { toggleMarker, toggleRead } from './read';
import { linkBack } from './card-links';
import { DOC_TOOLS } from './doc-tools';
import { CARD_TOOLS } from './card-tools';
import { compareText } from './doc-tools/compare';
import { navBinds, navFixed } from './nav-keys';
import { BINDINGS, bind, bindingOf, isRecording, keyOf, reserve } from './keybinds';
import { deleteWholeLines } from './line-edits';
import { redoOrRepeat, repeatable } from './repeat';

const M = schema.marks;

// a line with nothing but spaces counts as blank, same as an empty one
const blank = (n: PMNode) => n.isTextblock && !/\S/.test(n.textContent);

/**
 * Backspace at a card's edges, the way CardMirror does it: body text never merges up into a tag.
 * At the start of a tag: a blank tag goes away, a blank line above goes away, and a tag right under another
 * tag (a card with nothing in it yet) joins it. Otherwise nothing happens.
 * An analytic is just text, so it joins the line above.
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
  if (isCardHead(cur)) {
    if (cur.content.size === 0) return false; // empty tag: let it join up and disappear
    if (blank(cur) && prev.isTextblock) {
      if (dispatch) {
        const tr = state.tr.delete($c.before(1), $c.after(1));
        dispatch(tr.setSelection(TextSelection.create(tr.doc, prevPos + prev.nodeSize - 1)).scrollIntoView());
      }
      return true;
    }
    if (blank(prev)) {
      if (dispatch) dispatch(state.tr.delete(prevPos, prevPos + prev.nodeSize).scrollIntoView());
      return true;
    }
    if (prev.attrs.style === cur.attrs.style && cur.attrs.style === 'tag') return false; // tag under a bare tag: join them
    // swallow: don't merge a tag into the paragraph above. An analytic joins a line, but under a table or other
    // block that isn't a line it stays put (the editor's own Backspace would select the table, and a second one delete it)
    return cur.attrs.style !== 'analytic' || !prev.isTextblock;
  }
  if (isCardHead(prev)) {
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

/**
 * Delete at the end of a tag: drop a blank line after it, or join a tag or analytic right under it, else nothing.
 * At the end of any other line, a blank tag after it goes away, and a real one isn't pulled up into the text.
 */
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
  const dropNext = () => { if (dispatch) dispatch(state.tr.delete(nextPos, nextPos + next.nodeSize)); return true; };
  if (isCardHead(cur)) {
    if (blank(next)) return dropNext();
    // the mirror of Backspace: what Backspace at the start of the next line would join, Delete joins too
    if (next.attrs.style === 'analytic' || (next.attrs.style === 'tag' && cur.attrs.style === 'tag')) return false;
    return true;
  }
  if (next.attrs.style === 'tag' && cur.content.size > 0) return blank(next) ? dropNext() : true; // don't pull a tag into body text
  return false;
};

/** Enter: split, carrying marks (so typing continues underlined); a new line after a heading is body text,
 *  or the style Settings picks for that heading. */
const enter: Command = chainCommands(createParagraphNear, liftEmptyBlock, (state, dispatch) => {
  const $f = state.selection.$from;
  // (a heading-styled line in a table cell splits like any line: the new line stays in the cell)
  const atEnd = state.selection.empty && $f.depth === 1 && $f.parentOffset === $f.parent.content.size && $f.parent.attrs.style !== 'normal';
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
  ['Mod-Shift-z', 'Redo', redoOrRepeat],
  ['Mod-y', 'Redo', redoOrRepeat],
  ['Tab', 'Indent', repeatable(indent(1))],
  ['Shift-Tab', 'Outdent', repeatable(indent(-1))],
  ['Enter', 'New line', repeatable(enter)],
  ['Backspace', 'Delete back', repeatable(chainCommands(deleteWholeLines, deleteSelection, backspaceAtCardEdge, joinBackward))],
  ['Delete', 'Delete forward', repeatable(chainCommands(deleteWholeLines, deleteSelection, deleteAtCardEdge, joinForward))],
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
/** The fixed keys as commands, for the command center. */
export const fixedCommands = FIXED.map(([key, label, run]) => ({ key, label, run }));

// the commands Settings can rebind, in the order Settings lists them (App and Files come first, from keybinds.ts)
// the formatting keys are what Redo can repeat (F2 reads the clipboard, so it's left out)
const repeats = <T extends { id: string; run: Command }>(list: T[]) => list.map((b) => (b.id === 'pastePlain' ? b : { ...b, run: repeatable(b.run) }));
bind('Cutting', repeats([
  { id: 'pastePlain', label: 'Paste as plain text', key: 'F2', run: (_s, _d, view) => { if (view) void pastePlainFromClipboard(view); return true; } },
  // F3 runs the condense Settings picks; Alt-F3 and Mod-Alt-F3 always merge (Card tools)
  { id: 'condense', label: 'Condense paragraph', key: 'F3', run: condenseBySettings },
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
]));
bind('Moving around', [
  { id: 'prevHeading', label: 'Previous heading', key: 'PageUp', run: moveByHeading(-1, false) },
  { id: 'nextHeading', label: 'Next heading', key: 'PageDown', run: moveByHeading(1, false) },
  { id: 'cardUp', label: 'Move card up', key: 'Mod-Alt-ArrowUp', run: moveContainer(-1) },
  { id: 'cardDown', label: 'Move card down', key: 'Mod-Alt-ArrowDown', run: moveContainer(1) },
  { id: 'read', label: 'Read mode', key: 'Mod-Shift-r', run: toggleRead },
  { id: 'marker', label: 'Read marker', key: 'Mod-Shift-d', run: toggleMarker },
  { id: 'linkBack', label: 'Back from a card link', key: 'Mod-[', run: linkBack },
  // each feature keeps its own keys in its own file
  ...navBinds,
]);
bind('Doc tools', DOC_TOOLS.flatMap((s) => s.items));
// a command only (command center, or a key you give it): no menu, no dialog
bind('Doc tools', [{ id: 'compareText', label: 'Compare Text', run: compareText }]);
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
