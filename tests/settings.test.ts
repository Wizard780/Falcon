import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { falconKeys as K } from '../src/editor/keymap';
import { condenseText, insertPlainText } from '../src/editor/commands';
import { cleanPastedHTML } from '../src/editor/paste';
import { readKey, toggleMarker, toggleRead } from '../src/editor/read';
import { P, pref, resetPrefs, setPref } from '../src/editor/prefs';
import { caret, make, map, run, select } from './helpers';

afterEach(() => resetPrefs());

const BODY = 'The rapid expansion of AI has pushed utilities to their limits.';
const card = () => make([['tag', 'Grid tag here'], ['normal', 'Smith 24, Professor at MIT'], ['normal', BODY]]);
const body = (s: ReturnType<typeof card>) => map(s).split('\n')[2];

describe('settings store', () => {
  it('reads defaults, stores toggles as on/off, and restores defaults', () => {
    expect(pref(P.condense)).toBe('integrity');
    setPref(P.citeNearest, false);
    expect(localStorage.getItem('falcon.citeNearest')).toBe('off');
    setPref(P.wpm1, 250);
    expect(pref(P.wpm1)).toBe(250);
    resetPrefs();
    expect(pref(P.citeNearest)).toBe(true);
    expect(pref(P.wpm1)).toBe(200);
  });
});

describe('condense settings', () => {
  const s0 = () => make([['tag', 'Tag'], ['normal', 'cite'], ['normal', 'one   two'], ['normal', 'three']]);
  it('F3 runs the condense mode Settings picks', () => {
    expect(map(run(caret(s0(), 'three', 1), K.F3))).toBe('tag: Tag\nnormal: cite\nnormal: one two\nnormal: three');
    setPref(P.condense, 'merge');
    expect(map(run(caret(s0(), 'three', 1), K.F3))).toBe('tag: Tag\nnormal: cite\nnormal: one two three');
    setPref(P.condense, 'pilcrows');
    expect(map(run(caret(s0(), 'three', 1), K.F3))).toBe('tag: Tag\nnormal: cite\nnormal: one two ¶ three');
  });
  it('small pilcrows set the ¶ marks at 6 pt, and uncondense still splits them', () => {
    setPref(P.smallPilcrows, true);
    const s = run(caret(s0(), 'three', 1), K['Mod-Alt-F3']);
    expect(map(s)).toBe('tag: Tag\nnormal: cite\nnormal: one two[ ¶ ]{size:6pt}three');
    expect(map(run(caret(s, 'two'), K['Mod-Alt-Shift-F3']))).toBe('tag: Tag\nnormal: cite\nnormal: one two\nnormal: three');
  });
  it('condenseText collapses whitespace and merges lines like F3', () => {
    expect(condenseText(' a  b \r\n\r\nc\t d ', 'integrity')).toBe('a b\n\nc d');
    expect(condenseText(' a  b \n\nc\t d ', 'merge')).toBe('a b c d');
    expect(condenseText('a\nb', 'pilcrows')).toBe('a ¶ b');
  });
  it('Paste Text condenses what it pastes when Settings says so', () => {
    const paste = (s: ReturnType<typeof card>) => run(caret(s, 'Smith', 0), insertPlainText('one  two\nthree'));
    expect(map(paste(card())).split('\n').slice(1, 3)).toEqual(['normal: one  two', 'normal: threeSmith 24, Professor at MIT']);
    setPref(P.pasteCondense, true);
    setPref(P.condense, 'merge');
    expect(map(paste(card())).split('\n')[1]).toBe('normal: one two threeSmith 24, Professor at MIT');
  });
});

describe('shrink settings', () => {
  const omitted = () => make([['tag', 'T'], ['normal', 'cite'], ['normal', 'read this [Table Omitted] not this']]);
  it('stops at the smallest size Settings allows, then starts over', () => {
    setPref(P.shrinkMin, 7);
    let s = run(select(card(), 'pushed utilities'), K.F9);
    s = run(caret(s, 'rapid'), K['Mod-8']);
    expect(body(s)).toContain('{size:8pt}');
    s = run(s, K['Mod-8']);
    expect(body(s)).toContain('{size:7pt}');
    s = run(s, K['Mod-8']);
    expect(body(s)).toBe('normal: The rapid expansion of AI has [pushed utilities]{underline} to their limits.');
  });
  it('keeps omission notes full size unless protection is off', () => {
    let s = run(select(omitted(), 'read this'), K.F9);
    expect(map(run(caret(s, 'not'), K['Mod-8'])).split('\n')[2]).toBe('normal: [read this]{underline}[ ]{size:8pt}[Table Omitted][ not this]{size:8pt}');
    setPref(P.shrinkProtect, false);
    s = run(caret(s, 'not'), K['Mod-8']);
    expect(map(s).split('\n')[2]).toBe('normal: [read this]{underline}[ [Table Omitted] not this]{size:8pt}');
  });
});

describe('editing settings', () => {
  it('Enter at the end of a heading starts the style Settings picks', () => {
    expect(map(run(caret(card(), 'here', 4), K.Enter)).split('\n')[1]).toBe('normal: ');
    setPref(P.enterTag, 'tag');
    expect(map(run(caret(card(), 'here', 4), K.Enter)).split('\n')[1]).toBe('tag: ');
  });
  it('highlight lands on underlined text only when Settings says so', () => {
    let s = run(select(card(), 'pushed utilities'), K.F9);
    setPref(P.hlUnderlined, true);
    s = run(select(s, 'AI has pushed utilities to'), K.F11);
    expect(body(s)).toBe('normal: The rapid expansion of AI has [pushed utilities]{highlight:yellow+underline} to their limits.');
    // nothing underlined in the selection: the key clears instead
    s = run(select(s, 'The rapid'), K.F11);
    expect(body(s)).toContain('The rapid expansion');
  });
  it('Copy previous cite takes the cite lines after the first when "first line only" is off', () => {
    const doc = () => {
      let s = make([['tag', 'One'], ['normal', 'Smith 24'], ['normal', 'Professor, MIT'], ['normal', 'body'], ['tag', 'Two'], ['normal', '']]);
      s = run(select(s, 'Smith 24'), K.F8);
      return run(select(s, 'Professor, MIT'), K.F8);
    };
    const last = (s: ReturnType<typeof make>) => map(s).split('\n').slice(5);
    const atEmpty = (s: ReturnType<typeof make>) => run(s.apply(s.tr.setSelection(TextSelection.create(s.doc, s.doc.content.size - 1))), K['Alt-F8']);
    expect(last(atEmpty(doc()))).toEqual(['normal: [Smith 24]{cite}']);
    setPref(P.citeNearest, false);
    expect(last(atEmpty(doc()))).toEqual(['normal: [Smith 24]{cite}', 'normal: [Professor, MIT]{cite}']);
  });
  it('smart paste off leaves Word styles unconverted', () => {
    const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office"><body><p><span class="Emphasis">big</span> <span style="mso-highlight:yellow">lit</span></p></body></html>';
    expect(cleanPastedHTML(html)).toContain('f-emphasis');
    expect(cleanPastedHTML(html)).toContain('f-highlight');
    setPref(P.smartPaste, false);
    expect(cleanPastedHTML(html)).not.toContain('f-emphasis');
    expect(cleanPastedHTML(html)).not.toContain('f-highlight');
  });
});

describe('read mode settings', () => {
  const doc = () => {
    let s = make([['tag', 'Tag'], ['undertag', 'note'], ['normal', 'Smith 24 cite'], ['normal', 'one'], ['normal', 'two shaded']]);
    s = run(select(s, 'Smith 24'), K.F8);
    s = run(select(s, 'one'), K.F11);
    s = run(select(s, 'two'), K.F11);
    return run(select(s, 'shaded'), K['Mod-F11']);
  };
  const classes = (s: ReturnType<typeof make>, want: string) => {
    const decos = readKey.getState(s)!.decos.find();
    return decos.filter((d) => String((d as unknown as { type: { attrs: { class: string } } }).type.attrs.class).split(' ').includes(want)).map((d) => s.doc.textBetween(d.from, d.to, '|')).sort();
  };
  it('defaults: undertags hidden, paragraphs flow, only cite-marked words of the cite', () => {
    const s = run(doc(), toggleRead);
    expect(classes(s, 'f-read-flow')).toEqual(['one', 'two shaded']);
    expect(classes(s, 'f-read-hidden')).toEqual([' ', ' cite', 'note', 'shaded']);
  });
  it('keep paragraphs, whole cite, undertags and background color', () => {
    setPref(P.readParas, true);
    setPref(P.readWholeCite, true);
    setPref(P.readUndertags, true);
    setPref(P.readShading, true);
    const s = run(doc(), toggleRead);
    expect(classes(s, 'f-read-flow')).toEqual([]);
    // only the space between two shown runs, drawn as one space
    expect(classes(s, 'f-read-hidden')).toEqual([' ']);
    expect(classes(s, 'f-read-gap')).toEqual([' ']);
  });
  it('markers take the color and text Settings picks', () => {
    setPref(P.markerColor, '#0070C0');
    setPref(P.markerTime, false);
    let s = run(caret(doc(), 'one', 3), toggleMarker);
    expect(map(s)).toContain('[ Marked ]{color}');
    expect(JSON.stringify(s.doc.toJSON())).toContain('#0070C0');
    s = run(caret(s, 'Marked', 2), toggleMarker);
    expect(map(s)).not.toContain('Marked');
  });
  it('jump to the top moves the cursor to the start', () => {
    setPref(P.readTop, true);
    const s = run(caret(doc(), 'two'), toggleRead);
    expect(s.selection.from).toBe(1);
  });
});
