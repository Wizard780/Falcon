import { afterEach, beforeEach, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { freshStorage, mountApp, unmountAll } from './app-harness';

beforeEach(async () => { await freshStorage({ 'falcon.showPrep': 'on' }); });
afterEach(async () => { await unmountAll(); });

it('shows reading times and the timers as minutes:seconds', async () => {
  const app = await mountApp();
  await app.act(() => {
    const v = app.view(), { schema } = v.state;
    v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, schema.nodes.paragraph.create({ style: 'tag' }, schema.text(Array(700).fill('word').join(' ')))));
  }, 400);
  const status = app.el.querySelector('footer.status')!.textContent;
  expect(status).toContain('Doc: 700 · Reader 1: 3:30 · Reader 2: 2:20');
  const timers = [...app.el.querySelectorAll('button.timer')].map((b) => b.textContent?.trim());
  expect(timers).toEqual(['8:00', 'Prep 8:00']);
});

it('counts only the read words in a selection', async () => {
  const app = await mountApp();
  await app.act(() => {
    const v = app.view(), { schema } = v.state;
    const hl = schema.marks.highlight.create();
    const body = schema.nodes.paragraph.create(null, [
      schema.text('one two three '),
      schema.text('four five', [hl]),
      schema.text(' six seven'),
    ]);
    const tag = schema.nodes.paragraph.create({ style: 'tag' }, schema.text('Tag words here'));
    v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, [tag, body]));
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 1, v.state.doc.content.size - 1)));
  }, 400);
  const status = app.el.querySelector('footer.status')!.textContent;
  // 3 tag words + 2 highlighted body words are read; 10 words selected in all
  expect(status).toContain('Sel: 10 · Read: 5 ·');
});
