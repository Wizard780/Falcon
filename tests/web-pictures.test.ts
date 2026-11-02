import { afterEach, expect, test, vi } from 'vitest';
import { Slice, Fragment } from 'prosemirror-model';
import { EditorView } from 'prosemirror-view';
import { createState, docFromHTML } from '../src/editor/editor';
import { schema } from '../src/editor/schema';

const fetched: string[] = [];
vi.stubGlobal('fetch', (url: string) => { fetched.push(url); return Promise.resolve({ ok: false }); });
afterEach(() => { fetched.length = 0; });

const opened = () => new EditorView(document.createElement('div'), {
  state: createState(docFromHTML('<p>text <img src="https://tracker.example/pixel.png"></p>')),
});
const paste = (view: EditorView, slice: Slice) => view.dispatch(view.state.tr.replaceSelection(slice).setMeta('uiEvent', 'paste'));

test('pasting text never fetches the pictures a file was opened with', () => {
  const view = opened();
  paste(view, new Slice(Fragment.from(schema.text('pasted')), 0, 0));
  expect(fetched).toEqual([]);
});

test('a pasted web picture is fetched to embed it', () => {
  const view = opened();
  paste(view, new Slice(Fragment.from(schema.nodes.image.create({ src: 'https://site.example/chart.png' })), 0, 0));
  expect(fetched).toEqual(['https://site.example/chart.png']);
});
