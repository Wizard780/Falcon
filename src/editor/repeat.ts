import { Plugin, type Command } from 'prosemirror-state';
import type { Slice } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { redo } from './live-hooks'; // a live doc's redo is Loro's
import { P, pref } from './prefs';
import { isReading } from './read';

/**
 * Word's Repeat, as CardMirror does it behind a setting: with nothing left to redo, Redo does your last edit
 * again where the cursor is now. That's what you typed, a paste, Backspace/Delete/Enter/Tab, or a formatting key.
 */
type Last =
  | { kind: 'typing'; text: string; end: number }
  | { kind: 'paste'; slice: Slice }
  | { kind: 'command'; run: Command };

const last = new WeakMap<EditorView, Last>();

/** Wraps a key's command so a successful run becomes the thing Redo repeats. */
export const repeatable = (run: Command): Command => (state, dispatch, view) => {
  const ok = run(state, dispatch, view);
  if (ok && dispatch && view) last.set(view, { kind: 'command', run });
  return ok;
};

/** Redo, or with nothing to redo and the setting on, the last edit again. */
export const redoOrRepeat: Command = (state, dispatch, view) => {
  if (redo(state, dispatch)) return true;
  if (!pref(P.repeatRedo) || !view || isReading(state)) return false;
  const l = last.get(view);
  if (!l) return false;
  if (l.kind === 'command') return l.run(state, dispatch, view);
  if (dispatch) dispatch((l.kind === 'typing' ? state.tr.insertText(l.text) : state.tr.replaceSelection(l.slice)).scrollIntoView());
  return true;
};

/** Keeps track of typing and pastes. Runs first and never handles anything itself. */
export const repeatPlugin = new Plugin({
  props: {
    handleTextInput(view, from, _to, text) {
      const l = last.get(view);
      // still typing where you left off: it's one run of text
      const prev = l?.kind === 'typing' && l.end === from ? l.text : '';
      last.set(view, { kind: 'typing', text: prev + text, end: from + text.length });
      return false;
    },
    handlePaste(view, _e, slice) {
      last.set(view, { kind: 'paste', slice });
      return false;
    },
  },
});
