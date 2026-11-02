import { beforeEach, describe, expect, it } from 'vitest';
import { undo } from 'prosemirror-history';
import { TextSelection } from 'prosemirror-state';
import { docToDocx } from '../src/docx/export';
import { docxToDoc } from '../src/docx/import';
import { falconKeys as K } from '../src/editor/keymap';
import { DOC_TOOLS, analyticsToTags, selectSimilar, standardize } from '../src/editor/doc-tools';
import { fixFormattingGaps } from '../src/editor/doc-tools/gaps';
import { findUrls, linkUrls, removeHyperlinks } from '../src/editor/doc-tools/links';
import { MultiSelection } from '../src/editor/multi';
import { toggleRead } from '../src/editor/read';
import { schema } from '../src/editor/schema';
import { activeColors } from '../src/editor/host';
import { caret, make, map, run, select } from './helpers';

const M = schema.marks;
const line = (s: ReturnType<typeof make>, i: number) => map(s).split('\n')[i];
const hrefs = (doc: import('prosemirror-model').Node) => {
  const out: string[] = [];
  doc.descendants((n) => { const l = M.link.isInSet(n.marks); if (l) out.push(`${n.text}=${l.attrs.href}`); return true; });
  return out;
};

beforeEach(() => {
  localStorage.clear();
  activeColors.highlight = 'yellow';
  activeColors.shading = '#D9D9D9';
});

describe('automatic gap bridging', () => {
  const body = () => make([['tag', 'Tag one'], ['normal', 'alpha beta gamma. delta']]);
  it('bridges the space when underlining a word next to an underlined word', () => {
    let s = run(select(body(), 'alpha'), K.F9);
    s = run(select(s, 'beta'), K.F9);
    expect(line(s, 1)).toBe('normal: [alpha beta]{underline} gamma. delta');
  });
  it('is one undo step with the command', () => {
    let s = run(select(body(), 'alpha'), K.F9);
    const before = map(s);
    s = run(select(s, 'beta'), K.F9);
    expect(map(run(s, undo))).toBe(before);
  });
  it('bridges punctuation too, unless set to spaces only', () => {
    let s = run(select(body(), 'gamma'), K.F11);
    s = run(select(s, 'delta'), K.F11);
    expect(line(s, 1)).toBe('normal: alpha beta [gamma. delta]{highlight:yellow}');
    localStorage.setItem('falcon.bridgeGaps', 'space');
    s = run(select(body(), 'gamma'), K.F11);
    s = run(select(s, 'delta'), K.F11);
    expect(line(s, 1)).toBe('normal: alpha beta [gamma]{highlight:yellow}. [delta]{highlight:yellow}');
  });
  it('can be turned off', () => {
    localStorage.setItem('falcon.autoBridge', 'off');
    let s = run(select(body(), 'alpha'), K.F9);
    s = run(select(s, 'beta'), K.F9);
    expect(line(s, 1)).toBe('normal: [alpha]{underline} [beta]{underline} gamma. delta');
  });
  it('a period highlighted on its own survives highlighting the next word', () => {
    let s = run(select(body(), 'gamma.'), K.F11);
    s = run(select(s, 'delta'), K.F11);
    expect(line(s, 1)).toBe('normal: alpha beta [gamma. delta]{highlight:yellow}');
    s = run(select(body(), '.'), K.F11);
    s = run(select(s, 'delta'), K.F11);
    expect(line(s, 1)).toBe('normal: alpha beta gamma[.]{highlight:yellow} [delta]{highlight:yellow}');
  });
  it('un-highlighting the word before a period clears the period with it', () => {
    let s = run(select(body(), 'gamma'), K.F11);
    s = run(select(s, 'delta'), K.F11);
    s = run(select(s, 'gamma'), K.F11);
    expect(line(s, 1)).toBe('normal: alpha beta gamma. [delta]{highlight:yellow}');
  });
  it('joins two emphasized words with underline', () => {
    let s = run(select(body(), 'alpha'), K.F10);
    s = run(select(s, 'beta'), K.F10);
    expect(line(s, 1)).toBe('normal: [alpha]{emphasis}[ ]{underline}[beta]{emphasis} gamma. delta');
  });
  it('never bridges in tags', () => {
    let s = run(select(body(), 'Tag'), K.F11);
    s = run(select(s, 'one'), K.F11);
    expect(line(s, 0)).toBe('tag: [Tag]{highlight:yellow} [one]{highlight:yellow}');
  });
  it('leaves undo alone', () => {
    let s = run(select(body(), 'alpha'), K.F9);
    s = run(select(s, 'beta'), K.F9);
    s = run(s, undo);
    expect(line(s, 1)).toBe('normal: [alpha]{underline} beta gamma. delta');
  });
});

describe('Fix Formatting Gaps', () => {
  it('bridges what both bookends share and strips the rest, document-wide', () => {
    localStorage.setItem('falcon.autoBridge', 'off');
    let s = make([['normal', 'one two three four']]);
    s = run(select(s, 'one'), K.F9);
    s = run(select(s, 'two'), K.F9);
    s = run(select(s, 'three four'), K.F11);
    s = run(select(s, 'four'), K.F11);
    expect(map(s)).toBe('normal: [one]{underline} [two]{underline} [three ]{highlight:yellow}four');
    s = run(caret(s, 'one'), fixFormattingGaps);
    expect(map(s)).toBe('normal: [one two]{underline} [three]{highlight:yellow} four');
  });
  it('keeps to the selection, and does nothing when there is nothing to fix', () => {
    localStorage.setItem('falcon.autoBridge', 'off');
    let s = make([['normal', 'a b'], ['normal', 'c d']]);
    s = run(select(s, 'a'), K.F9); s = run(select(s, 'b'), K.F9); s = run(select(s, 'c'), K.F9); s = run(select(s, 'd'), K.F9);
    s = run(select(s, 'c d'), fixFormattingGaps);
    expect(map(s)).toBe('normal: [a]{underline} [b]{underline}\nnormal: [c d]{underline}');
    expect(fixFormattingGaps(s, () => {})).toBe(false);
  });
});

describe('Standardize', () => {
  // adjacent colors, unbridged
  const colored = () => {
    localStorage.setItem('falcon.autoBridge', 'off');
    let s = make([['normal', 'red green yellow']]);
    activeColors.highlight = 'red'; s = run(select(s, 'red'), K.F11);
    activeColors.highlight = 'green'; s = run(select(s, 'green'), K.F11);
    activeColors.highlight = 'yellow'; s = run(select(s, 'yellow'), K.F11);
    return s;
  };
  it('turns every highlight into the active color', () => {
    const s = colored();
    activeColors.highlight = 'cyan';
    expect(map(run(caret(s, 'red'), standardize(M.highlight, () => activeColors.highlight)))).toBe('normal: [red]{highlight:cyan} [green]{highlight:cyan} [yellow]{highlight:cyan}');
  });
  it('keeps to the selection, and the no-color pen strips', () => {
    expect(map(run(select(colored(), 'green'), standardize(M.highlight, () => null)))).toBe('normal: [red]{highlight:red} green [yellow]{highlight:yellow}');
  });
  it('leaves the exception color alone (yellow by default)', () => {
    const c = colored();
    activeColors.highlight = 'cyan';
    const s = run(caret(c, 'red'), DOC_TOOLS[1].items[2].run);
    expect(map(s)).toBe('normal: [red]{highlight:cyan} [green]{highlight:cyan} [yellow]{highlight:yellow}');
    expect(DOC_TOOLS[1].items[2].label).toBe('Standardize Highlighting (except Yellow)');
    localStorage.setItem('falcon.standardizeHighlightException', 'green');
    expect(DOC_TOOLS[1].items[2].label).toBe('Standardize Highlighting (except Green)');
  });
  it('does the same for background color, comparing colors case-blind', () => {
    localStorage.setItem('falcon.autoBridge', 'off');
    let s = make([['normal', 'one two']]);
    s = run(select(s, 'one'), K['Mod-F11']);
    activeColors.shading = '#ffff00'; s = run(select(s, 'two'), K['Mod-F11']);
    activeColors.shading = '#BFBFBF';
    s = run(caret(s, 'one'), DOC_TOOLS[1].items[3].run);
    expect(s.doc.firstChild!.child(0).marks[0].attrs.color).toBe('#BFBFBF');
    expect(s.doc.firstChild!.child(2).marks[0].attrs.color).toBe('#ffff00');
  });
  it('does nothing in read mode', () => {
    const s = run(colored(), toggleRead);
    expect(standardize(M.highlight, () => 'cyan')(s, () => {})).toBe(false);
  });
});

describe('Convert Analytics to Tags', () => {
  const doc = () => {
    let s = make([['analytic', 'Bare'], ['normal', 'text'], ['analytic', 'Cited'], ['normal', 'Smith 24'], ['normal', 'body']]);
    return run(select(s, 'Smith 24'), K.F8);
  };
  it('converts every analytic with nothing selected', () => {
    const s = run(caret(doc(), 'body'), analyticsToTags(false));
    expect(map(s).split('\n').map((l) => l.split(':')[0])).toEqual(['tag', 'normal', 'tag', 'normal', 'normal']);
  });
  it('the cited variant only converts analytics with a cite', () => {
    const s = run(caret(doc(), 'body'), analyticsToTags(true));
    expect(map(s).split('\n').map((l) => l.split(':')[0])).toEqual(['analytic', 'normal', 'tag', 'normal', 'normal']);
  });
  it('with a selection, only the analytics it touches (or whose card it is in)', () => {
    const s = run(select(doc(), 'text'), analyticsToTags(false));
    expect(map(s).split('\n').map((l) => l.split(':')[0])).toEqual(['tag', 'normal', 'analytic', 'normal', 'normal']);
  });
});

describe('Select Similar Formatting', () => {
  it('selects every run formatted like the one at the cursor', () => {
    let s = make([['normal', 'one two three four'], ['tag', 'one']]);
    s = run(select(s, 'one'), K.F9);
    s = run(select(s, 'three'), K.F9);
    s = run(caret(s, 'three', 2), selectSimilar);
    expect(s.selection).toBeInstanceOf(MultiSelection);
    expect((s.selection as MultiSelection).spans.map((r) => s.doc.textBetween(r.from, r.to))).toEqual(['one', 'three']);
  });
});

describe('links', () => {
  it('finds addresses, leaving trailing punctuation and lone brackets out', () => {
    expect(findUrls('see https://x.org/a. and (www.y.com/b) or http://en.wikipedia.org/wiki/Foo_(bar), not http://nohost').map((u) => u.href))
      .toEqual(['https://x.org/a', 'https://www.y.com/b', 'http://en.wikipedia.org/wiki/Foo_(bar)']);
  });
  it('Link URLs links the whole document, and Remove Hyperlinks undoes it', () => {
    let s = make([['normal', 'Go to www.example.com/page today.']]);
    s = run(caret(s, 'Go'), linkUrls);
    expect(hrefs(s.doc)).toEqual(['www.example.com/page=https://www.example.com/page']);
    expect(linkUrls(s, () => {})).toBe(false);
    s = run(caret(s, 'Go'), removeHyperlinks);
    expect(hrefs(s.doc)).toEqual([]);
  });
  it('Remove Hyperlinks keeps to the selection', () => {
    let s = make([['normal', 'http://a.com and http://b.com']]);
    s = run(caret(s, 'and'), linkUrls);
    s = run(select(s, 'http://b.com'), removeHyperlinks);
    expect(hrefs(s.doc)).toEqual(['http://a.com=http://a.com']);
  });
  it('round-trip through .docx keeps links, their text and formatting', async () => {
    let s = make([['tag', 'Tag'], ['normal', 'Read https://a.org/x?q=1&b=2 and http://b.com/y here']]);
    s = run(caret(s, 'Read'), linkUrls);
    s = run(select(s, 'https://a.org'), K.F9);
    const back = await docxToDoc(await docToDocx(s.doc));
    expect(hrefs(back)).toEqual(hrefs(s.doc));
    expect(map({ doc: back } as typeof s)).toBe(map(s));
  });
  it('links survive copy and paste inside Falcon, and only web links get a live href', () => {
    const el = document.createElement('div');
    const a = schema.marks.link.spec.toDOM!(M.link.create({ href: 'javascript:alert(1)' }), true) as [string, Record<string, string>];
    expect(a[1].href).toBeUndefined();
    el.innerHTML = '<p><a class="f-link" data-href="https://x.org">x</a></p>';
    expect(el.querySelector('a')!.dataset.href).toBe('https://x.org');
  });
});

describe('selection semantics', () => {
  it('multi-selection stretches are each a scope', () => {
    let s = make([['normal', 'http://a.com http://b.com http://c.com']]);
    const pos = (t: string) => { let p = -1; s.doc.descendants((n, at) => { if (n.isText && p < 0) { const i = n.text!.indexOf(t); if (i >= 0) p = at + i; } return true; }); return p; };
    s = s.apply(s.tr.setSelection(MultiSelection.create(s.doc, [{ from: pos('http://a'), to: pos('http://a') + 3 }, { from: pos('http://c'), to: pos('http://c') + 3 }])));
    s = run(s, linkUrls);
    expect(hrefs(s.doc).map((h) => h.split('=')[1])).toEqual(['http://a.com', 'http://c.com']);
    expect(s.selection).not.toBeInstanceOf(TextSelection);
  });
});
