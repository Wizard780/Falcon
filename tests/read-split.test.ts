import { expect, it } from 'vitest';
import { schema } from '../src/editor/schema';
import { readSeconds, readSplit, readWords } from '../src/editor/outline';

const doc = () => schema.node('doc', null, [
  schema.node('paragraph', { style: 'tag' }, [schema.text('Reefs are key')]),
  schema.node('paragraph', { style: 'normal' }, [schema.text('Smith 24', [schema.marks.cite.create()]), schema.text(', Professor')]),
  schema.node('paragraph', { style: 'normal' }, [schema.text('reefs '), schema.text('feed millions', [schema.marks.highlight.create()]), schema.text(' of people')]),
  schema.node('paragraph', { style: 'analytic' }, [schema.text('Their ev is old')]),
]);

it('splits read words into card text and tags, analytics and cites', () => {
  expect(readSplit(doc())).toEqual({ cards: 2, tags: 9 });
  expect(readWords(doc())).toBe(11);
});

it('times each part at its own speed, and a missing tag speed falls back to the card speed', () => {
  const r = { cards: 200, tags: 300 };
  expect(readSeconds(r, 200, 300)).toBe(120);
  expect(readSeconds(r, 250)).toBe(120);
  expect(readSeconds(r, 250, 0)).toBe(120);
});
