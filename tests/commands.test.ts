import { describe, expect, it } from 'vitest';
import { Fragment, Slice } from 'prosemirror-model';
import { GapCursor } from 'prosemirror-gapcursor';
import { Selection, type EditorState } from 'prosemirror-state';
import { falconKeys as K } from '../src/editor/keymap';
import { insertPlainText } from '../src/editor/commands';
import { createState, createView } from '../src/editor/editor';
import { schema, type ParaStyle } from '../src/editor/schema';
import { MultiSelection } from '../src/editor/multi';
import { at, caret, make, map, run, select } from './helpers';

const BODY = 'The rapid expansion of AI has pushed utilities to their limits.';
const card = () => make([['tag', 'Grid tag here'], ['normal', 'Smith 24, Professor at MIT'], ['normal', BODY]]);
const body = (s: ReturnType<typeof card>) => map(s).split('\n')[2];

describe('underline (F9)', () => {
  it('underlines the word at the cursor when nothing is selected', () => {
    expect(body(run(caret(card(), 'expansion', 3), K.F9))).toBe('normal: The rapid [expansion]{underline} of AI has pushed utilities to their limits.');
  });
  it('toggles off when all of the selection is underlined', () => {
    let s = run(select(card(), 'pushed utilities'), K.F9);
    s = run(s, K.F9);
    expect(body(s)).toBe(`normal: ${BODY}`);
  });
  it('extends to the whole selection when only part is underlined', () => {
    let s = run(select(card(), 'pushed utilities'), K.F9);
    s = run(select(s, 'utilities to their'), K.F9);
    expect(body(s)).toBe('normal: The rapid expansion of AI has [pushed utilities to their]{underline} limits.');
  });
  it('never underlines the spaces at the edges of the selection', () => {
    expect(body(run(select(card(), 'pushed utilities '), K.F9))).toBe('normal: The rapid expansion of AI has [pushed utilities]{underline} to their limits.');
  });
  it('replaces emphasis, taking the boxed spaces next to it', () => {
    let s = run(select(card(), 'pushed utilities to'), K.F10);
    s = run(select(s, 'utilities'), K.F9);
    expect(body(s)).toBe('normal: The rapid expansion of AI has [pushed]{emphasis}[ utilities ]{underline}[to]{emphasis} their limits.');
  });
});

describe('emphasis (F10)', () => {
  it('is apply-only and replaces underline', () => {
    let s = run(select(card(), 'pushed utilities to'), K.F9);
    s = run(select(s, 'utilities'), K.F10);
    s = run(s, K.F10);
    expect(body(s)).toBe('normal: The rapid expansion of AI has [pushed ]{underline}[utilities]{emphasis}[ to]{underline} their limits.');
  });
});

describe('highlight (F11) and clear (F12)', () => {
  it('does nothing with no selection', () => {
    expect(body(run(caret(card(), 'pushed', 2), K.F11))).toBe(`normal: ${BODY}`);
  });
  it('toggles, and F12 keeps it while clearing underline', () => {
    let s = run(select(card(), 'pushed utilities'), K.F9);
    s = run(s, K.F11);
    expect(body(s)).toBe('normal: The rapid expansion of AI has [pushed utilities]{highlight:yellow+underline} to their limits.');
    s = run(select(s, 'rapid', 'limits'), K.F12);
    expect(body(s)).toBe('normal: The rapid expansion of AI has [pushed utilities]{highlight:yellow} to their limits.');
    s = run(select(s, 'pushed utilities'), K.F11);
    expect(body(s)).toBe(`normal: ${BODY}`);
  });
});

describe('cite (F8)', () => {
  it('skips heading text in a mixed selection', () => {
    const s = run(select(card(), 'tag here', 'Smith'), K.F8);
    expect(map(s).split('\n').slice(0, 2)).toEqual(['tag: Grid tag here', 'normal: [Smith]{cite} 24, Professor at MIT']);
  });
});

describe('card edges', () => {
  it('Enter at the end of a tag starts body text', () => {
    const s = run(caret(card(), 'here', 4), K.Enter);
    expect(map(s).split('\n').slice(0, 2)).toEqual(['tag: Grid tag here', 'normal: ']);
  });
  it('Enter in the middle of a tag splits it into two tags', () => {
    const s = run(caret(make([['tag', 'Tag one two']]), 'two'), K.Enter);
    expect(map(s)).toBe('tag: Tag one \ntag: two');
  });
  it('Backspace at the start of the first body line does not merge into the tag', () => {
    const s = run(caret(card(), 'Smith'), K.Backspace);
    expect(map(s)).toBe(map(card()));
  });
  it('Backspace at the start of a tag removes a blank line above, else nothing', () => {
    const s0 = make([['normal', 'para'], ['normal', ''], ['tag', 'Tag one']]);
    const s1 = run(caret(s0, 'Tag'), K.Backspace);
    expect(map(s1)).toBe('normal: para\ntag: Tag one');
    expect(map(run(caret(s1, 'Tag'), K.Backspace))).toBe('normal: para\ntag: Tag one');
  });
  it('Backspace on an empty line under a tag removes it', () => {
    const s = make([['tag', 'Tag'], ['normal', '']]);
    const after = run(s.apply(s.tr.setSelection(Selection.atEnd(s.doc))), K.Backspace);
    expect(map(after)).toBe('tag: Tag');
  });
});

describe('structure keys', () => {
  it('F6 in a body line converts it to a block', () => {
    expect(map(run(caret(card(), 'rapid'), K.F6)).split('\n')[2]).toBe(`block: ${BODY}`);
  });
});

describe('shrink, case, condense', () => {
  it('Mod-8 shrinks unread text in the card, then cycles smaller', () => {
    let s = run(select(card(), 'pushed utilities'), K.F9);
    s = run(caret(s, 'rapid'), K['Mod-8']);
    expect(body(s)).toBe('normal: [The rapid expansion of AI has ]{size:8pt}[pushed utilities]{underline}[ to their limits.]{size:8pt}');
    s = run(s, K['Mod-8']);
    expect(body(s)).toContain('{size:7pt}');
  });
  it('Shift-F3 cycles lower → UPPER → Title → lower', () => {
    let s = run(select(card(), 'rapid expansion'), K['Shift-F3']);
    expect(body(s)).toContain('RAPID EXPANSION');
    s = run(s, K['Shift-F3']);
    expect(body(s)).toContain('Rapid Expansion');
    s = run(s, K['Shift-F3']);
    expect(body(s)).toContain('rapid expansion');
  });
  it('F3 with integrity keeps paragraphs and collapses spaces; Alt-F3 merges', () => {
    const s0 = make([['tag', 'Tag'], ['normal', 'cite'], ['normal', 'one   two'], ['normal', 'three']]);
    expect(map(run(caret(s0, 'three', 1), K.F3))).toBe('tag: Tag\nnormal: cite\nnormal: one two\nnormal: three');
    expect(map(run(select(s0, 'one', 'three'), K['Alt-F3']))).toBe('tag: Tag\nnormal: cite\nnormal: one two three');
  });
});

describe('the cite line, for condense and Alt-F8', () => {
  it('condense leaves the cite alone after an undertag or a blank line, and keeps it in a one-paragraph card', () => {
    const under = make([['tag', 'Tag'], ['undertag', 'my note'], ['normal', 'Smith 24'], ['normal', 'one'], ['normal', 'two']]);
    expect(map(run(caret(under, 'two', 1), K['Alt-F3']))).toBe('tag: Tag\nundertag: my note\nnormal: Smith 24\nnormal: one two');
    const blank = make([['tag', 'Tag'], ['normal', ''], ['normal', 'Smith 24'], ['normal', 'one'], ['normal', 'two']]);
    expect(map(run(caret(blank, 'two', 1), K['Alt-F3']))).toBe('tag: Tag\nnormal: \nnormal: Smith 24\nnormal: one two');
    expect(map(run(caret(make([['tag', 'Tag'], ['normal', 'one   two']]), 'two'), K.F3))).toBe('tag: Tag\nnormal: one two');
  });
  it('condense merges an analytic\'s body, which has no cite line', () => {
    const s0 = make([['analytic', 'An'], ['normal', 'one'], ['normal', 'two']]);
    expect(map(run(caret(s0, 'two', 1), K['Alt-F3']))).toBe('analytic: An\nnormal: one two');
  });
  it('Alt-F8 copies the cite, not the undertag above it', () => {
    const s0 = make([['tag', 'Prev'], ['undertag', 'my note'], ['normal', 'Smith 24'], ['normal', 'body'], ['tag', 'New'], ['normal', '']]);
    const s = run(s0.apply(s0.tr.setSelection(Selection.atEnd(s0.doc))), K['Alt-F8']);
    expect(map(s).split('\n').slice(4)).toEqual(['tag: New', 'normal: Smith 24']);
  });
});

describe('multi-selection', () => {
  it('typing, F2 and paste all land at the last stretch, with the cursor after them', () => {
    let s0 = make([['normal', 'one two three four']]);
    s0 = s0.apply(s0.tr.setSelection(MultiSelection.create(s0.doc, [{ from: at(s0, 'two'), to: at(s0, 'two', 3) }, { from: at(s0, 'four'), to: at(s0, 'four', 4) }])));
    const view = createView(document.createElement('div'), () => {}, s0.doc);
    view.dispatch(view.state.tr.setSelection(MultiSelection.create(view.state.doc, (s0.selection as MultiSelection).spans)));
    view.dom.dispatchEvent(new KeyboardEvent('keypress', { charCode: 'Z'.charCodeAt(0), bubbles: true, cancelable: true }));
    const typed = view.state;
    const f2 = run(s0, insertPlainText('Z'));
    const pasted = s0.apply(s0.tr.replaceSelection(new Slice(Fragment.from(s0.schema.node('paragraph', null, [s0.schema.text('Z')])), 1, 1)));
    for (const s of [typed, f2, pasted]) {
      expect(map(s)).toBe('normal: one  three Z');
      expect([s.selection.empty, s.selection.from]).toEqual([true, at(s, 'Z', 1)]);
    }
  });
});

describe('moving around and moving cards', () => {
  const doc = () => make([['block', 'Block'], ['tag', 'Card A'], ['normal', 'a body'], ['tag', 'Card B'], ['normal', 'b body'], ['tag', 'Card C']]);
  it('Mod-Alt-Down moves the card below its neighbor, cursor along', () => {
    const s = run(caret(doc(), 'a body', 2), K['Mod-Alt-ArrowDown']);
    expect(map(s)).toBe('block: Block\ntag: Card B\nnormal: b body\ntag: Card A\nnormal: a body\ntag: Card C');
    expect(s.selection.$from.parent.textContent).toBe('a body');
  });
  it('Mod-Alt-Up moves it back', () => {
    const s = run(caret(doc(), 'b body'), K['Mod-Alt-ArrowUp']);
    expect(map(s)).toBe('block: Block\ntag: Card B\nnormal: b body\ntag: Card A\nnormal: a body\ntag: Card C');
  });
  it('a card does not move above its block', () => {
    const s = run(caret(doc(), 'Card A'), K['Mod-Alt-ArrowUp']);
    expect(map(s)).toBe(map(doc()));
  });
  describe('next to a table', () => {
    const p = (t: string, style: ParaStyle = 'normal') => schema.node('paragraph', { style }, [schema.text(t)]);
    const table = () => schema.node('table', null, [schema.node('table_row', null, ['c1', 'c2'].map((t) => schema.node('table_cell', null, [p(t)])))]);
    const where = (s: EditorState) => [s.selection.$head.parent.isTextblock, s.selection.$head.parent.textContent, s.selection.$head.parentOffset];
    it('selecting by paragraph into a table stops in its cell text', () => {
      const s0 = createState(schema.node('doc', null, [p('above'), table(), p('below')]));
      for (const key of ['Ctrl-Shift-ArrowDown', 'Alt-Shift-ArrowDown']) {
        const s = run(caret(s0, 'above', 5), K[key]);
        expect(s.selection.anchor).toBe(at(s0, 'above', 5));
        expect(where(s)).toEqual([true, 'c2', 2]);
      }
      // (from the very start of a line, prosemirror-tables would trim a selection ending there to the cell)
      for (const key of ['Ctrl-Shift-ArrowUp', 'Alt-Shift-ArrowUp']) {
        const s = run(run(caret(s0, 'below', 2), K[key]), K[key]);
        expect(s.selection.anchor).toBe(at(s0, 'below', 2));
        expect(where(s)).toEqual([true, 'c1', 0]);
      }
    });
    it('moving a card that ends in a table, from the cursor after the table, keeps the cursor in the table', () => {
      const s0 = createState(schema.node('doc', null, [p('Card A', 'tag'), p('a body'), p('Card B', 'tag'), table()]));
      const s = run(s0.apply(s0.tr.setSelection(new GapCursor(s0.doc.resolve(s0.doc.content.size)))), K['Mod-Alt-ArrowUp']);
      expect(map(s).split('\n').filter((l) => !l.startsWith('cell'))).toEqual(['tag: Card B', 'table 1 rows', 'tag: Card A', 'normal: a body']);
      expect(where(s)).toEqual([true, 'c2', 2]);
    });
  });
  it('PageDown/PageUp jump between headings', () => {
    let s = run(caret(doc(), 'a body', 1), K.PageDown);
    expect(s.selection.$from.parent.textContent).toBe('Card B');
    s = run(s, K.PageUp);
    expect(s.selection.$from.parent.textContent).toBe('Card A');
  });
});

describe('analytic (Mod-F7) over imported run color', () => {
  const navy = () => {
    const s = make([['tag', 'Switch sides solves'], ['normal', 'body']]);
    const end = 1 + 'Switch sides solves'.length;
    return s.apply(s.tr.addMark(1, end, schema.marks.color.create({ color: '#1F3864' })));
  };
  it('drops the inline color so the Settings analytic color shows', () => {
    expect(map(navy()).split('\n')[0]).toBe('tag: [Switch sides solves]{color}');
    expect(map(run(caret(navy(), 'sides', 1), K['Mod-F7'])).split('\n')[0]).toBe('analytic: Switch sides solves');
  });
  it('keeps inline color when the line becomes a hat', () => {
    expect(map(run(caret(navy(), 'sides', 1), K.F5)).split('\n')[0]).toBe('hat: [Switch sides solves]{color}');
  });
});
