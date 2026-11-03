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
  // 3 tag words + 2 highlighted body words are read; the 5 plain words in between don't count
  expect(status).toContain('Sel: 5 words · 0:02 / 0:01');
  expect(status).not.toContain('10 words');
});

it('reads tags, analytics and cites at each reader\'s tag speed', async () => {
  await freshStorage({ 'falcon.wpm1': '200', 'falcon.wpm1.tags': '300', 'falcon.wpm2': '300' });
  const app = await mountApp();
  await app.act(() => {
    const v = app.view(), { schema } = v.state;
    const hl = schema.marks.highlight.create();
    // 300 tag words and 200 highlighted card words
    const tag = schema.nodes.paragraph.create({ style: 'tag' }, schema.text(Array(300).fill('tag').join(' ')));
    const body = schema.nodes.paragraph.create(null, schema.text(Array(200).fill('card').join(' '), [hl]));
    v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, [tag, body]));
  }, 400);
  const status = app.el.querySelector('footer.status')!.textContent;
  // Reader 1: 200 cards at 200 + 300 tags at 300 = 2:00; Reader 2 has no tag speed, so 500 at 300 = 1:40
  expect(status).toContain('Doc: 500 · Reader 1: 2:00 · Reader 2: 1:40');
});

it('shows no selection count when nothing selected is read aloud', async () => {
  const app = await mountApp();
  await app.act(() => {
    const v = app.view(), { schema } = v.state;
    v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, schema.nodes.paragraph.create(null, schema.text('plain unhighlighted words'))));
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 1, v.state.doc.content.size - 1)));
  }, 400);
  expect(app.el.querySelector('footer.status .sel')).toBeNull();
});
