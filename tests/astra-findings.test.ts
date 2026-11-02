import { afterEach, expect, test, vi } from 'vitest';
import { Fragment } from 'prosemirror-model';
import { TableMap } from 'prosemirror-tables';
import { EditorView } from 'prosemirror-view';
import { docToDocx } from '../src/docx/export';
import { docxToDoc } from '../src/docx/import';
import { createState, docFromHTML, markMap } from '../src/editor/editor';

const reopen = async (html: string) => docxToDoc(await docToDocx(docFromHTML(html)));

test('a table whose first two rows are one merged cell keeps all three rows', async () => {
  const doc = await reopen('<table><tr><td rowspan="2"><p>merged</p></td></tr><tr></tr><tr><td><p>below</p></td></tr></table>');
  const map = TableMap.get(createState(doc).doc.child(0));
  expect([map.width, map.height]).toEqual([1, 3]);
});

test('a size set on a heading survives a save', async () => {
  const doc = await reopen('<p data-style="tag"><span class="f-size" data-pt="24">big tag</span> plain</p>');
  expect(markMap(doc)).toContain('[big tag]{size:24pt}');
  expect(markMap(doc)).not.toContain('plain]{size');
});

const fetched: string[] = [];
vi.stubGlobal('fetch', (url: string) => { fetched.push(url); return Promise.resolve({ ok: false }); });
afterEach(() => { fetched.length = 0; });

test('a web picture pasted inside a table is fetched to embed it', () => {
  const view = new EditorView(document.createElement('div'), { state: createState() });
  const table = docFromHTML('<table><tr><td><p>cell <img src="https://site.example/p.png"></p></td><td><p>other</p></td></tr></table>').child(0);
  view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, Fragment.from(table)).setMeta('uiEvent', 'paste'));
  expect(view.state.doc.lastChild!.type.name).toBe('paragraph');
  expect(fetched).toEqual(['https://site.example/p.png']);
});

test('every paragraph pasted into a footnote is kept in the note', async () => {
  const { insertFootnote } = await import('../src/editor/footnotes');
  const views: EditorView[] = [];
  const focus = vi.spyOn(EditorView.prototype, 'focus').mockImplementation(function (this: EditorView) { views.push(this); });
  const view = new EditorView(document.body.appendChild(document.createElement('div')), { state: createState(docFromHTML('<p>text</p>')) });
  insertFootnote(view.state, view.dispatch, view);
  const note = views.find((v) => v !== view)!;
  vi.stubGlobal('ClipboardEvent', class extends Event {});
  note.pasteText('first paragraph\nsecond paragraph');
  focus.mockRestore();
  let content: { text?: string }[] = [];
  view.state.doc.descendants((n) => { if (n.type.name === 'footnote') content = n.attrs.content; });
  expect(content.map((n) => n.text ?? '¶')).toEqual(['first paragraph', '¶', 'second paragraph']);
  view.destroy();
});

test('a size set on cite text inside a heading survives a save', async () => {
  const doc = await reopen('<p data-style="pocket"><span class="f-cite"><span class="f-size" data-pt="26">cited</span></span></p>');
  expect(markMap(doc)).toContain('size:26pt');
});
