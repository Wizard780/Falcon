import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { isReading } from './read';
import { P, pref } from './prefs';

const OPENS_AFTER = /[\s{[(<'"‘“—–]/;
/** The curl a typed quote takes after `before` ('' at the start of a paragraph): opening after a space, bracket or dash, else closing. */
function curl(quote: string, before: string): string {
  const open = before === '' || OPENS_AFTER.test(before);
  return quote === '"' ? (open ? '“' : '”') : open ? '‘' : '’';
}

type Undo = { from: number; to: number; curled: string; straight: string };
const key = new PluginKey<{ undo: Undo | null }>('falcon-smart-quotes');

/**
 * Smart quotes, as in CardMirror: a typed ' or " curls by what's before it, and Backspace right after puts the straight one back.
 * A space then curls a straight quote left before the caret. A digit or space after an opening ‘ flips it to ’: a dropped
 * century (Orth ’10) or a quote that opens nothing. That flip also covers the ones the Mac curls, or Word's on a pasted doc.
 */
export const smartQuotesPlugin = new Plugin<{ undo: Undo | null }>({
  key,
  state: {
    init: () => ({ undo: null }),
    apply(tr, old) {
      const undo = tr.getMeta(key) as Undo | undefined;
      if (undo) return { undo };
      return old.undo && (tr.docChanged || tr.selectionSet) ? { undo: null } : old;
    },
  },
  props: {
    handleTextInput(view, from, to, text) {
      const { state } = view;
      if (isReading(state)) return false;
      const $from = state.doc.resolve(from);
      const before = $from.parentOffset ? state.doc.textBetween(from - 1, from, undefined, '\ufffc') : '';
      if ((text === "'" || text === '"') && pref(P.smartQuotes)) {
        const curled = curl(text, before);
        const tr = state.tr.insertText(curled, from, to);
        tr.setSelection(TextSelection.create(tr.doc, from + 1)).setMeta(key, { from, to: from + 1, curled, straight: text });
        view.dispatch(tr.scrollIntoView());
        return true;
      }
      if (!before) return false;
      // keeps the quote's own marks
      const swap = (quote: string) => {
        const stored = state.storedMarks;
        const tr = state.tr.insertText(quote, from - 1, from);
        if (stored) tr.setStoredMarks(stored);
        view.dispatch(tr.insertText(text, from, to).scrollIntoView());
        return true;
      };
      if (text === ' ' && pref(P.smartQuotes) && (before === "'" || before === '"')) return swap(before === '"' ? '”' : '’');
      if (/^[\d ]$/.test(text) && before === '‘') return swap('’');
      return false;
    },
    handleKeyDown(view, e) {
      if (e.key !== 'Backspace' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
      const undo = key.getState(view.state)?.undo;
      const sel = view.state.selection;
      if (!undo || !sel.empty || sel.from !== undo.to || view.state.doc.textBetween(undo.from, undo.to) !== undo.curled) return false;
      view.dispatch(view.state.tr.insertText(undo.straight, undo.from, undo.to).scrollIntoView());
      return true;
    },
  },
});
