import { redo as historyRedo, undo as historyUndo } from 'prosemirror-history';
import type { Command, EditorState, Transaction } from 'prosemirror-state';

/**
 * What live co-editing (collab/live-doc.ts) plugs into the editor. That module and the CRDT under it load only when a
 * session starts, so the editor reaches them through here instead of importing them.
 */
export const liveHooks: {
  undo?: Command;
  redo?: Command;
  /** Rewrite a transaction before it's applied (see narrowLoroReplace). */
  narrow?: (state: EditorState, tr: Transaction) => Transaction;
  /** How many changes this person has made to a live doc (others' don't count), or undefined for a plain doc. */
  mine?: (state: EditorState) => number | undefined;
} = {};

/** A doc as an edit left it, to check later that nothing has been done since: in a live doc, nothing by this person. */
export type Mark = { doc: EditorState['doc']; mine: number | undefined };
export const markOf = (s: EditorState): Mark => ({ doc: s.doc, mine: isLive(s) ? liveHooks.mine?.(s) : undefined });
/** Nothing done to `s` since `m`. In a live doc others' edits don't count: its undo takes back only this person's. */
export const untouched = (s: EditorState, m: Mark) => (m.mine !== undefined && isLive(s) ? liveHooks.mine?.(s) === m.mine : s.doc === m.doc);

/** A live doc has no prosemirror-history: its undo is Loro's, which takes back only this person's edits. */
const isLive = (s: EditorState) => s.plugins.some((p) => (p as unknown as { key: string }).key.startsWith('loro-undo$'));

export const undo: Command = (state, dispatch) => (isLive(state) ? liveHooks.undo?.(state, dispatch) ?? false : historyUndo(state, dispatch));
export const redo: Command = (state, dispatch) => (isLive(state) ? liveHooks.redo?.(state, dispatch) ?? false : historyRedo(state, dispatch));
