// Search cards: the main-process index (electron/cards.cjs) and finding a hit in the opened file.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { docToDocx } from '../src/docx/export';
import { docxToDoc } from '../src/docx/import';
import { levelOf } from '../src/editor/schema';
import { cardContent, findCard, shortCite } from '../src/ui/card-search';
import { make } from './helpers';

const { parseDocx, rank, createCardIndex } = createRequire(import.meta.url)('../electron/cards.cjs');

const FILE = make([
  ['pocket', '1AC'],
  ['hat', 'Advantage One'],
  ['block', 'Warming'],
  ['tag', 'Warming causes extinction'],
  ['normal', 'Chen 25 [Wei Chen, climate scientist, Nature, 2025]'],
  ['normal', 'The body of the card goes here.'],
  ['analytic', 'Their evidence is old'],
  ['normal', 'and it assumes a different policy'],
  ['block', 'Solvency'],
  ['tag', 'The plan solves'],
  ['normal', ''],
  ['normal', 'Kitchener 24 [some cite]'],
  ['normal', 'body'],
]).doc;

const docx = async () => Buffer.from(await docToDocx(FILE));

describe('parseDocx', () => {
  it('finds each tag with its cite and headings, and analytics without one', async () => {
    expect(parseDocx(await docx())).toEqual([
      ['Warming causes extinction', 'Chen 25 [Wei Chen, climate scientist, Nature, 2025]', '1AC\u0001Advantage One\u0001Warming'],
      ['Their evidence is old', '', '1AC\u0001Advantage One\u0001Warming'],
      ['The plan solves', 'Kitchener 24 [some cite]', '1AC\u0001Advantage One\u0001Solvency'],
    ]);
  });

  it('counts cards the way Falcon does when it opens the file', async () => {
    const buf = await docx();
    const opened = await docxToDoc(new Uint8Array(buf));
    const tags: string[] = [];
    opened.forEach((n) => { if (levelOf(n) === 4) tags.push(n.textContent); });
    expect(parseDocx(buf).map((c: string[]) => c[0])).toEqual(tags);
  });

  it('skips cards inside tables, which Falcon\'s outline doesn\'t count either', async () => {
    const { schema } = await import('../src/editor/schema');
    const P = (t: string) => schema.node('paragraph', { style: 'tag' }, [schema.text(t)]);
    const table = schema.nodes.table.create(null, [schema.nodes.table_row.create(null, [schema.nodes.table_cell.create(null, [P('In a table')])])]);
    const buf = Buffer.from(await docToDocx(schema.node('doc', null, [P('Before'), table, P('After')])));
    expect(parseDocx(buf).map((c: string[]) => c[0])).toEqual(['Before', 'After']);
  });

  it('turns a file that isn\'t a .docx down', () => {
    expect(() => parseDocx(Buffer.from('hello'))).toThrow();
  });
});

describe('rank', () => {
  const h = (tag: string, cite: string, extra: Partial<{ heads: string; name: string; mtime: number; path: string }> = {}) =>
    ({ path: extra.path ?? tag, i: 0, mtime: extra.mtime ?? 0, tag: tag.toLowerCase(), cite: cite.toLowerCase(), heads: extra.heads ?? '', name: extra.name ?? '' });

  it('needs every word, and puts a whole word ahead of part of one', () => {
    const hay = [h('Kitchen sink', 'Smith 20'), h('Warming bad', 'Chen 25'), h('Chen is wrong', '')];
    expect(rank(hay, 'chen').map((g: { h: { tag: string } }) => g.h.tag)).toEqual(['warming bad', 'chen is wrong', 'kitchen sink']);
    expect(rank(hay, 'chen warming').map((g: { h: { tag: string } }) => g.h.tag)).toEqual(['warming bad']);
    expect(rank(hay, '   ')).toEqual([]);
    expect(rank(hay, 'c')).toEqual([]); // one letter: nearly everything, so wait for more
  });

  it('shows a card saved in several files once, as its newest copy', () => {
    const hay = [h('Same card', 'Lee 22', { path: 'old', mtime: 1 }), h('Same card', 'Lee 22', { path: 'new', mtime: 5 })];
    const out = rank(hay, 'lee');
    expect(out).toHaveLength(1);
    expect(out[0].h.path).toBe('new');
    expect(out[0].copies).toBe(2);
  });

  it('matches headings and the file name too, below tags and cites', () => {
    const hay = [h('Something else', '', { heads: 'china da', name: 'neg' }), h('China rises', 'Wu 21')];
    expect(rank(hay, 'china').map((g: { h: { tag: string } }) => g.h.tag)).toEqual(['china rises', 'something else']);
  });
});

describe('createCardIndex', () => {
  it('indexes the folder, reads changed files again, and keeps the index on disk', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-cards-'));
    const a = path.join(dir, 'Aff.docx'), b = path.join(dir, 'Neg.docx'), store = path.join(dir, 'index.json');
    fs.writeFileSync(a, await docx());
    fs.writeFileSync(b, 'not a docx');
    const list = async () => [a, b].filter((p) => fs.existsSync(p)).map((p) => ({ path: p, mtime: fs.statSync(p).mtimeMs }));
    const idx = createCardIndex(store, list);
    await idx.scan();
    const r = await idx.search('chen nature');
    expect(r.hits).toEqual([{ path: a, ordinal: 0, file: 'Aff', tag: 'Warming causes extinction', cite: 'Chen 25 [Wei Chen, climate scientist, Nature, 2025]', headings: ['1AC', 'Advantage One', 'Warming'], copies: 1 }]);
    expect(r.status).toMatchObject({ files: 2, cards: 3, scanning: false });

    // a fresh start answers from the saved index, before any scan
    const again = createCardIndex(store, async () => []);
    expect((await again.search('plan solves')).hits.map((x: { ordinal: number }) => x.ordinal)).toEqual([2]);

    // a file that changed is read again
    fs.writeFileSync(b, Buffer.from(await docToDocx(make([['tag', 'Neg card'], ['normal', 'Ortiz 23']]).doc)));
    await idx.scan();
    expect((await idx.search('ortiz')).hits.map((x: { file: string }) => x.file)).toEqual(['Neg']);

    // a file that's gone drops out on the next scan
    fs.rmSync(a);
    await idx.scan();
    expect((await idx.search('chen')).hits).toEqual([]);
    fs.rmSync(dir, { recursive: true });
  });
});

describe('finding the card in the opened file', () => {
  it('goes by tag text nearest the indexed spot, then by the spot alone', () => {
    const doc = make([['tag', 'A'], ['normal', 'x'], ['tag', 'B'], ['tag', 'A'], ['normal', 'y']]).doc;
    const posOf = (i: number) => { let p = -1, n = 0; doc.forEach((node, pos) => { if (levelOf(node) === 4 && n++ === i) p = pos; }); return p; };
    expect(findCard(doc, 'A', 2)).toBe(posOf(2));
    expect(findCard(doc, 'A', 0)).toBe(posOf(0));
    expect(findCard(doc, 'B', 0)).toBe(posOf(1)); // moved since indexing
    expect(findCard(doc, 'Renamed', 1)).toBe(posOf(1));
    expect(findCard(doc, 'Renamed', 9)).toBeNull();
    expect(findCard(doc, 'Renamed', 1, true)).toBeNull(); // a copy has to be the card itself
    expect(findCard(doc, 'b', 0, true)).toBe(posOf(1)); // case and punctuation don't matter
  });

  it('copies the whole card, tag to the next card', () => {
    const doc = make([['tag', 'A'], ['normal', 'cite'], ['normal', 'body'], ['tag', 'B']]).doc;
    const frag = cardContent(doc, findCard(doc, 'A', 0)!)!;
    expect(frag.childCount).toBe(3);
    expect(frag.lastChild!.textContent).toBe('body');
  });

  it('shortens a cite to its author and year', () => {
    expect(shortCite('Chen 25 [Wei Chen, Nature]')).toBe('Chen 25');
    expect(shortCite('Chen 25')).toBe('Chen 25');
  });
});
