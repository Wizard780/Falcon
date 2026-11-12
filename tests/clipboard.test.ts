import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as pmView from 'prosemirror-view';
import type { Fragment, Slice, ResolvedPos } from 'prosemirror-model';
import { createState, markMap } from '../src/editor/editor';
import { schema } from '../src/editor/schema';
import { clipboardHTML } from '../src/editor/clipboard-styles';
import { cleanPastedHTML, highlightName } from '../src/editor/paste';
import { P, setPref } from '../src/editor/prefs';

const { EditorView } = pmView;
// ProseMirror's own paste parser (exported for tests, not typed): runs transformPastedHTML like a real paste
const parseFromClipboard = (pmView as unknown as { __parseFromClipboard: (v: pmView.EditorView, text: string, html: string, plain: boolean, $ctx: ResolvedPos) => Slice }).__parseFromClipboard;
const M = schema.marks;
const t = (text: string, ...marks: ReturnType<typeof M.cite.create>[]) => schema.text(text, marks);
const para = (style: string, ...runs: ReturnType<typeof t>[]) => schema.node('paragraph', { style }, runs);

/** A card with every style Falcon has, the way Verbatim files use them. */
const rich = () => schema.node('doc', null, [
  para('pocket', t('Pocket')),
  para('hat', t('Hat')),
  para('block', t('Block')),
  para('tag', t('Data centers cause '), t('blackouts', M.unbold.create())),
  para('undertag', t('a note under the tag')),
  para('normal', t('Smith 24', M.cite.create()), t(', Professor at MIT, '), t('"The Crunch"', M.italic.create())),
  para('normal',
    t('The rapid expansion of AI has ', M.size.create({ pt: 8 })),
    t('pushed utilities', M.underline.create(), M.highlight.create({ color: 'yellow' })),
    t(' to their limits', M.underline.create()),
    t(' and ', M.size.create({ pt: 8 })),
    t('rolling blackouts', M.emphasis.create(), M.highlight.create({ color: 'cyan' })),
    t(' loom', M.bold.create()),
    t('.', M.size.create({ pt: 8 }))),
  para('analytic', t('Extend the blackout impact')),
]);

/** Paste HTML through ProseMirror's real clipboard path (transformPastedHTML included) into an empty doc. */
function paste(html: string): string {
  const view = new EditorView(document.createElement('div'), { state: createState() });
  const slice = parseFromClipboard(view, '', html, false, view.state.doc.resolve(1));
  view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, slice.content));
  const out = markMap(view.state.doc);
  view.destroy();
  return out;
}

afterEach(() => setPref(P.smartPaste, true));

describe('copy out', () => {
  const html = clipboardHTML(rich().content);
  it('writes the Verbatim look inline, for apps without Falcon styles', () => {
    const el = (sel: string) => new DOMParser().parseFromString(html, 'text/html').querySelector<HTMLElement>(sel)!.getAttribute('style') ?? '';
    expect(el('.f-cite')).toMatch(/font-weight:bold/);
    expect(el('.f-cite')).toMatch(/font-size:13pt/);
    expect(el('.f-underline')).toMatch(/text-decoration:underline/);
    expect(el('.f-emphasis')).toMatch(/font-weight:bold;text-decoration:underline;border:1pt solid/);
    expect(el('h4.f-tag')).toMatch(/font-weight:bold/);
    expect(el('.f-unbold')).toMatch(/font-weight:normal/);
    // Word turns mso-highlight into a real highlight; Docs and Gmail read the background
    expect(el('.f-highlight[data-color=yellow]')).toMatch(/^mso-highlight:yellow;background-color/);
    expect(el('.f-highlight[data-color=cyan]')).toMatch(/mso-highlight:aqua/);
    expect(el('.f-size')).toMatch(/font-size: ?8pt/);
  });
  it("carries CardMirror's names for each style, which its paste reads instead of the look", () => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const s of ['pocket', 'hat', 'block', 'tag', 'analytic', 'cite', 'underline', 'emphasis']) expect(doc.querySelector(`.f-${s}`)!.classList).toContain(`pmd-${s}`);
    expect(doc.querySelector('p.f-analytic.pmd-analytic')).not.toBeNull();
    // CardMirror reads data-color as a font color: a highlight goes by its name, anything else as a fill
    expect(doc.querySelector<HTMLElement>('.f-highlight[data-color=cyan]')!.className).toBe('f-highlight pmd-highlight');
    expect(doc.querySelector<HTMLElement>('.f-highlight[data-color=cyan]')!.dataset.highlight).toBe('cyan');
    const other = new DOMParser().parseFromString(clipboardHTML(schema.node('doc', null, [para('normal',
      t('deep', M.highlight.create({ color: 'deepTurquoise' })), t('gray', M.shading.create({ color: '#D9D9D9' })))]).content), 'text/html');
    expect(other.querySelector<HTMLElement>('.f-highlight')!.dataset.shading).toBe('00DAFF');
    expect(other.querySelector<HTMLElement>('.f-highlight')!.classList).not.toContain('pmd-highlight');
    expect(other.querySelector<HTMLElement>('.f-shading')!.dataset.shading).toBe('D9D9D9');
  });
  it('a font color goes to CardMirror without its #, and comes back into Falcon with it', () => {
    const d = schema.node('doc', null, [para('normal', t('red', M.color.create({ color: '#C00000' })))]);
    const out = clipboardHTML(d.content);
    expect(new DOMParser().parseFromString(out, 'text/html').querySelector<HTMLElement>('.f-color')!.dataset.color).toBe('C00000');
    expect(paste(out)).toBe(markMap(d));
  });
  it('pastes back into Falcon exactly as it was copied', () => {
    expect(paste(html)).toBe(markMap(rich()));
  });
  it('survives a trip through an app that drops classes (Gmail)', () => {
    // what's left once the classes and data attributes are gone: the inline look and the tags
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.body.querySelectorAll('*').forEach((el) => { el.removeAttribute('class'); for (const a of Array.from(el.attributes)) if (a.name.startsWith('data-')) el.removeAttribute(a.name); });
    expect(paste(doc.body.innerHTML).split('\n')).toEqual([
      'pocket: Pocket',
      'hat: Hat',
      'block: Block',
      'tag: Data centers cause blackouts',
      'normal: [a note under the tag]{italic}',
      'normal: [Smith 24]{cite}, Professor at MIT, ["The Crunch"]{italic}',
      'normal: [The rapid expansion of AI has ]{size:8pt}[pushed utilities]{highlight:yellow+underline}[ to their limits]{underline}[ and ]{size:8pt}[rolling blackouts]{emphasis+highlight:cyan}[ loom]{bold}[.]{size:8pt}',
      // an analytic is bold 13pt text: its blue is what keeps it from reading as a cite
      'analytic: Extend the blackout impact',
    ]);
  });
});

describe('paste in', () => {
  it('Falcon to Falcon: an indented tag or pocket keeps its indent, and a sent card does too', async () => {
    const indented = schema.node('doc', null, [
      schema.node('paragraph', { style: 'pocket', indent: 1 }, [t('Pocket')]),
      schema.node('paragraph', { style: 'tag', indent: 2 }, [t('Tag')]),
      schema.node('paragraph', { style: 'normal', indent: 1 }, [t('Body')]),
    ]);
    const view = new EditorView(document.createElement('div'), { state: createState() });
    const slice = parseFromClipboard(view, '', clipboardHTML(indented.content), false, view.state.doc.resolve(1));
    view.destroy();
    const indents = (f: Fragment) => { const out: number[] = []; f.forEach((n) => out.push(n.attrs.indent as number)); return out; };
    expect(indents(slice.content)).toEqual([1, 2, 1]);
    const { cardFragment } = await import('../src/collab/service');
    expect(indents(cardFragment(indented.content.toJSON())!)).toEqual([1, 2, 1]);
  });
  it('a pasted or received highlight color, size or indent Word has no value for is brought into range', async () => {
    const { docToDocx } = await import('../src/docx/export');
    const { unzipSync, strFromU8 } = await import('fflate');
    const view = new EditorView(document.createElement('div'), { state: createState() });
    // shaped like Falcon's own copy (the f-* paragraph classes), so the f-* marks are read as they are
    const html = '<h4 class="f-tag" data-style="tag" data-indent="99">Tag</h4><p class="f-normal" data-style="normal" data-indent="-3"><span class="f-highlight" data-color="notAColor">a</span> <span class="f-size" data-pt="-10">b</span> <span class="f-size" data-pt="9999">c</span> <span class="f-highlight" data-color="toString">d</span></p>';
    const slice = parseFromClipboard(view, '', html, false, view.state.doc.resolve(1));
    view.destroy();
    const xml = strFromU8(unzipSync(await docToDocx(schema.node('doc', null, slice.content)))['word/document.xml']);
    expect(xml.match(/w:highlight w:val="[^"]*"/g)).toEqual(['w:highlight w:val="yellow"', 'w:highlight w:val="yellow"']);
    expect(xml).not.toMatch(/w:sz w:val="-/);
    expect(xml).not.toContain('w:sz w:val="19998"');
    expect(xml).toContain('<w:ind w:left="5760"/>'); // 8 steps, Falcon's most
    expect(xml).not.toContain('w:left="-');
  });
  it('Word: Verbatim character styles and highlights', () => {
    const lines = paste(fs.readFileSync('tests/fixtures/word-clipboard.html', 'utf8')).split('\n');
    expect(lines).toEqual([
      'tag: Data centers cause blackouts',
      'normal: [Smith 24]{cite}, Professor at MIT, "The Crunch"',
      'normal: [The rapid expansion of AI has ]{size:8pt}[pushed utilities]{highlight:yellow+underline}[ to their limits]{underline}[ and ]{size:8pt}[rolling blackouts]{emphasis+highlight:cyan}[ loom.]{size:8pt}',
    ]);
  });
  it('Word without a Verbatim template: direct bold, underline and 13pt (a bold line is a cite, not a guessed tag)', () => {
    const html = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><body><p class=MsoNormal><b><span style='font-size:13.0pt'>Cards say this</span></b></p>
      <p class=MsoNormal><b><span style='font-size:13.0pt'>Lee 23</span></b> writes <u>that it</u> <b><u>happens</u></b></p></body></html>`;
    expect(paste(html).split('\n')).toEqual(['normal: [Cards say this]{cite}', 'normal: [Lee 23]{cite} writes [that it]{underline} [happens]{emphasis}']);
  });
  it('Google Docs: inline styles under its font-weight:normal wrapper', () => {
    const html = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b3c4d-5e6f">'
      + '<h4 dir="ltr" style="line-height:1.38;margin-top:0pt"><span style="font-size:13pt;font-family:Calibri,sans-serif;font-weight:700;">Blackouts are coming</span></h4>'
      + '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:13pt;font-family:Calibri,sans-serif;font-weight:700;">Smith 24</span><span style="font-size:11pt;font-family:Calibri,sans-serif;font-weight:400;">, Professor</span></p>'
      + '<br><p dir="ltr"><span style="font-size:8pt;font-weight:400;text-decoration:none;">AI has </span>'
      + '<span style="font-size:11pt;font-weight:400;text-decoration:underline;background-color:#ffff00;">pushed utilities</span>'
      + '<span style="font-size:11pt;font-weight:700;text-decoration:underline;background-color:#00ffff;"> to the limit</span>'
      + '<span style="font-size:11pt;font-weight:400;background-color:#f1f3f4;"> today</span></p></b>';
    expect(paste(html).split('\n')).toEqual([
      'tag: Blackouts are coming',
      'normal: [Smith 24]{cite}, Professor',
      'normal: ',
      'normal: [AI has ]{size:8pt}[pushed utilities]{highlight:yellow+underline}[ to the limit]{emphasis+highlight:cyan} today',
    ]);
  });
  it('Google Docs: headings that lost their style are matched by font size', () => {
    const span = (text: string, pt: number, weight = 700) => `<span style="font-size:${pt}pt;font-family:Calibri,sans-serif;font-weight:${weight};">${text}</span>`;
    const p = (...spans: string[]) => `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">${spans.join('')}</p>`;
    const html = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-9f8e7d6c">'
      + p(span('Pocket', 26)) + p(span('Hat', 22)) + p(span('Block', 16))
      + p(span('Data centers cause ', 13), span('blackouts', 13, 400))
      + p(span('Smith 24', 13), span(', Professor', 11, 400))
      + p(span('Bold card text', 11))
      + '</b>';
    expect(paste(html).split('\n')).toEqual([
      'pocket: Pocket',
      'hat: Hat',
      'block: Block',
      'tag: Data centers cause [blackouts]{unbold}',
      'normal: [Smith 24]{cite}, Professor',
      'normal: [Bold card text]{bold}',
    ]);
  });
  it('Google Docs: heading sizes follow the Settings sizes', () => {
    setPref(P.szTag, 14);
    try {
      const html = '<b style="font-weight:normal;" id="docs-internal-guid-1"><p><span style="font-size:14pt;font-weight:700;">Tag at 14</span></p></b>';
      expect(paste(html)).toBe('tag: Tag at 14');
    } finally { setPref(P.szTag, 13); }
  });
  it('Google Docs: an analytic is told from a tag or cite by its blue', () => {
    const docs = (inner: string) => `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1">${inner}</b>`;
    const run = (text: string, color = '#1f3f8a', weight = 700) => `<span style="font-size:13pt;font-family:Calibri,sans-serif;color:${color};background-color:transparent;font-weight:${weight};font-style:normal;text-decoration:none;vertical-align:baseline;white-space:pre-wrap;">${text}</span>`;
    expect(paste(docs(`<p dir="ltr" style="line-height:1.38;margin-top:0pt">${run('Extend the impact')}</p>`))).toBe('analytic: Extend the impact');
    // a Verbatim .docx opened in Docs: Analytic is based on Heading 4, so Docs writes an h4
    expect(paste(docs(`<h4 dir="ltr">${run('From a docx')}</h4>`))).toBe('analytic: From a docx');
    // Verbatim's own analytic blue, with an unbolded word
    expect(paste(docs(`<p>${run('Verbatim ', '#1f3864')}${run('blue', '#1f3864', 400)}</p>`))).toBe('analytic: Verbatim [blue]{unbold}');
    // a heading that's only a link is blue too, but underlined: still a tag
    expect(paste(docs(`<h4><a href="https://x.y"><span style="font-size:13pt;font-weight:700;color:#0563c1;text-decoration:underline">Smith 20 evidence</span></a></h4>`))).toBe('tag: Smith 20 evidence');
    // black stays a tag; a blue cite inside a sentence stays a cite
    expect(paste(docs(`<p>${run('A tag', '#000000')}</p>`))).toBe('tag: A tag');
    expect(paste(docs(`<p>${run('Smith 24')}<span style="font-size:11pt;color:#000000">, Prof</span></p>`))).toBe('normal: [Smith 24]{cite}, Prof');
  });
  it('a custom analytic color in Settings is read back too', () => {
    setPref(P.colorAnalytic, '#7a1fa2');
    try {
      expect(paste('<p><span style="font-size:13pt;font-weight:bold;color:rgb(122, 31, 162)">Purple analytic</span></p>')).toBe('analytic: Purple analytic');
    } finally { setPref(P.colorAnalytic, ''); }
  });
  it('Gmail: rgb() colors and px sizes, no classes', () => {
    const html = '<div dir="ltr"><div><span style="font-weight:bold;font-size:17.3333px">Smith 24</span> says</div>'
      + '<div><span style="text-decoration:underline;background-color:rgb(255, 255, 0)">lit</span> and <span style="text-decoration:underline;border:1px solid rgb(34, 34, 34);font-weight:bold">boxed</span></div></div>';
    expect(paste(html).split('\n')).toEqual(['normal: [Smith 24]{cite} says', 'normal: [lit]{highlight:yellow+underline} and [boxed]{emphasis}']);
  });
  it('CardMirror: its classes, with the bold its plugin adds for Docs ignored', () => {
    const html = '<div class="pmd-card" data-pm-slice="0 0 []"><h4 class="pmd-tag" style="font-size:13pt">CM tag</h4>'
      + '<p class="pmd-cite-para" style="font-size:11pt"><span class="pmd-cite" style="font-size:13pt; font-weight: 700;" data-du-bold="font-size:13pt">Lee 23</span>, Prof</p>'
      + '<p class="pmd-card-body"><span class="pmd-underline" style="text-decoration:underline"><span class="pmd-highlight" data-highlight="green" style="background-color:#00ff00">green</span></span> '
      + '<span class="pmd-emphasis" style="font-weight: 700;border:1pt solid #333">box</span> <span data-half-points="16" style="font-size: 8pt">small</span></p></div>'
      + '<p class="pmd-analytic">CM analytic</p>';
    expect(paste(html).split('\n')).toEqual([
      'tag: CM tag',
      'normal: [Lee 23]{cite}, Prof',
      'normal: [green]{highlight:green+underline} [box]{emphasis} [small]{size:8pt}',
      'analytic: CM analytic',
    ]);
  });
  it('a web page: its backgrounds, fonts and big headings stay out', () => {
    const html = '<article><h2>Title</h2><p style="font-family:Georgia;font-size:16px;background:#fafafa">Some <a href="https://x.y">link</a> and <b>bold</b>.</p><ul><li>one</li><li>two</li></ul></article>';
    expect(paste(html).split('\n')).toEqual(['hat: Title', 'normal: Some link and [bold]{bold}.', 'normal: one', 'normal: two']);
  });
  it('smart paste off: only paragraphs, bold and italic', () => {
    setPref(P.smartPaste, false);
    const html = '<p><span style="font-weight:bold;font-size:13pt">Smith 24</span> <u>under</u> <i>it</i> <span style="background:yellow">lit</span></p>';
    expect(paste(html)).toBe('normal: [Smith 24]{bold} under [it]{italic} lit');
    expect(cleanPastedHTML(html)).not.toMatch(/f-(cite|underline|highlight)/);
  });
  it('edge shapes: wrapped headings, blank lines, <pre>, bordered cells, a shrunk cite', () => {
    expect(paste('<h2><div>Title</div></h2><div class="pmd-analytic"><p>An analytic</p></div>')).toBe('hat: Title\nanalytic: An analytic');
    expect(paste('<div>one</div><div><br></div><div>two<br></div>')).toBe('normal: one\nnormal: \nnormal: two');
    expect(cleanPastedHTML('<pre>line one\nline two</pre>')).toBe('<p>line one<br>line two</p>');
    expect(paste('<table><tr><td style="border:1px solid #000"><u>x</u></td></tr></table>')).toBe('normal: [x]{underline}');
    // a cite shrunk by Create Reference, after an app dropped the classes
    expect(paste('<p><span style="font-size:13pt;font-weight:bold"><span style="font-size:8pt">Smith 24</span></span> rest</p>')).toBe('normal: [Smith 24]{cite+size:8pt} rest');
  });
  it("a pasted color can't carry extra CSS", () => {
    expect(paste('<p class="f-normal"><span class="f-color" data-color="red;background:url(//x)">a</span><span class="f-color" data-color="#FF0000">b</span></p>')).toBe('normal: a[b]{color}');
  });
  it('maps colors to Word highlight names only when they are one', () => {
    expect(highlightName('#FFFF00')).toBe('yellow');
    expect(highlightName('rgb(0, 255, 255)')).toBe('cyan');
    expect(highlightName('lime')).toBe('green');
    expect(highlightName('darkBlue')).toBe('darkBlue');
    expect(highlightName('#fafafa')).toBeNull();
    expect(highlightName('rgba(0, 0, 0, 0)')).toBeNull();
  });
});
