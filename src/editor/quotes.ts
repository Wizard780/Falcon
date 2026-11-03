import { Plugin } from 'prosemirror-state';

/**
 * Smart quotes (the Mac's, or Word's on a pasted doc) curl a ' typed after a space into an opening ‘.
 * Before a digit it's a dropped century (Orth ’10) and before a space it opens nothing, so either
 * flips it to ’ as the next character goes in.
 */
export const yearQuotePlugin = new Plugin({
  props: {
    handleTextInput(view, from, to, text) {
      const { state } = view;
      if (!/^[\d ]$/.test(text) || state.doc.resolve(from).parentOffset < 1) return false;
      if (state.doc.textBetween(from - 1, from) !== '‘') return false;
      const stored = state.storedMarks;
      const tr = state.tr.insertText('’', from - 1, from); // keeps the quote's own marks
      if (stored) tr.setStoredMarks(stored);
      view.dispatch(tr.insertText(text, from, to).scrollIntoView());
      return true;
    },
  },
});
