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

it('after an edit, the counts kept per paragraph add up to a fresh count of the edited doc', () => {
  const d = doc();
  expect(readSplit(d)).toEqual({ cards: 2, tags: 9 }); // fills the per-paragraph cache
  // the untouched paragraphs are the same nodes, as after a real edit
  const edited = d.type.create(null, [d.child(0), d.child(1), schema.node('paragraph', { style: 'normal' }, [schema.text('reefs feed millions', [schema.marks.highlight.create()])]), d.child(3)]);
  expect(readSplit(edited)).toEqual({ cards: 3, tags: 9 });
  expect(readSplit(edited)).toEqual(readSplit(schema.nodeFromJSON(edited.toJSON())));
});
