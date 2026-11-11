// Search blocks: a file row's Enter asks open or search its blocks; inside, the file's headings insert into the open doc.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshStorage, mountApp, tick, unmountAll } from './app-harness';
import type { ParaStyle } from '../src/editor/schema';

const FILE = '/Users/me/Debate/K Backfile.docx';
const PARAS: [ParaStyle, string][] = [
  ['hat', 'Pluralism'],
  ['block', 'Pluralism – Bleiker'],
  ['tag', 'Tag one'], ['normal', 'Body one'],
  ['tag', 'Subs tag'], ['normal', 'Body two'],
  ['block', 'Politics – Academy'],
  ['tag', 'Academy tag'], ['normal', 'Body three'],
  ['hat', 'Identity'],
  ['block', 'IDPol Bad'],
  ['tag', 'Wrong forum'], ['normal', 'Body four'],
];
async function bytes() {
  const { docToDocx } = await import('../src/docx/export');
  const { schema } = await import('../src/editor/schema');
  return docToDocx(schema.node('doc', null, PARAS.map(([style, t]) => schema.node('paragraph', { style }, [schema.text(t)]))));
}
const reads: string[] = [];
const bridge = () => ({
  indexFolders: async () => [{ path: '/Users/me/Debate', count: 1, missing: false }],
  indexedFiles: async () => [{ path: FILE, root: '/Users/me/Debate', mtime: 1 }],
  openPath: async (p: string) => { reads.push(p); return { name: 'K Backfile.docx', path: p, data: await bytes() }; },
});

type App = Awaited<ReturnType<typeof mountApp>>;
const cc = () => document.querySelector<HTMLElement>('.cc');
const input = () => document.querySelector<HTMLInputElement>('.cc-input')!;
const rows = () => [...document.querySelectorAll('.cc-row')].map((r) => r.querySelector('.cc-nm')!.textContent);
const current = () => document.querySelector('.cc-row[data-on] .cc-nm')?.textContent;
const key = (app: App, k: string, init: KeyboardEventInit = {}, el: Element = input()) =>
  app.act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })), 120);
const openCc = async (app: App, q: string) => {
  await app.press(' ', { ctrlKey: true, shiftKey: true, code: 'Space' }, 120);
  await app.fill(input(), q, 120);
};
const paras = (app: App) => { const out: string[] = []; app.view().state.doc.forEach((n) => { out.push(n.textContent); }); return out; };

beforeEach(async () => { reads.length = 0; await freshStorage(); });
afterEach(async () => { await unmountAll(); });

describe('Search blocks', () => {
  it('Enter on a file asks open or search; searching lists its tree with the blocks closed', async () => {
    const app = await mountApp(bridge());
    await openCc(app, 'f backfile');
    expect(current()).toBe('K Backfile');
    await key(app, 'Enter');
    expect(rows()).toEqual(['Search blocks in K Backfile', 'Open K Backfile']);
    expect(reads).toEqual([]); // nothing is read until you pick
    await key(app, 'Enter');
    expect(input().placeholder).toBe('Search in K Backfile…');
    expect(rows()).toEqual(['Pluralism', 'Pluralism – Bleiker', 'Politics – Academy', 'Identity', 'IDPol Bad']);
    // → opens a block, ← closes it
    await key(app, 'ArrowDown');
    await key(app, 'ArrowRight');
    expect(rows()).toEqual(['Pluralism', 'Pluralism – Bleiker', 'Tag one', 'Subs tag', 'Politics – Academy', 'Identity', 'IDPol Bad']);
    await key(app, 'ArrowLeft');
    expect(rows()).toHaveLength(5);
    // right-click toggles too
    await app.act(() => document.querySelectorAll('.cc-row')[4].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    expect(rows()).toContain('Wrong forum');
  });

  it('typing searches every heading, words that look like prefixes included; Enter inserts the section and stays open', async () => {
    const app = await mountApp(bridge());
    await app.type('My speech');
    await openCc(app, 'f backfile');
    await key(app, 'Enter');
    await key(app, 'Enter');
    await app.fill(input(), 's subs');
    expect(current()).toBe('Subs tag');
    await key(app, 'Enter');
    expect(cc()).not.toBeNull(); // CardMirror keeps it open to insert more
    expect(paras(app)).toEqual(['My speech', 'Subs tag', 'Body two']);
    // a hat brings its blocks and cards; Alt-Enter puts it at the end
    await app.fill(input(), 'identity');
    await key(app, 'Enter', { altKey: true });
    expect(paras(app)).toEqual(['My speech', 'Subs tag', 'Body two', 'Identity', 'IDPol Bad', 'Wrong forum', 'Body four']);
    expect(app.toast()).toContain('Inserted Identity at the end');
    // one undo takes back one insert
    await key(app, 'z', { ctrlKey: true });
    expect(paras(app)).toEqual(['My speech', 'Subs tag', 'Body two']);
  });

  it('Esc steps back to the files with the query kept, then closes', async () => {
    const app = await mountApp(bridge());
    await openCc(app, 'f backfile');
    await key(app, 'ArrowRight'); // → on a file skips the question
    expect(input().placeholder).toBe('Search in K Backfile…');
    await key(app, 'Escape');
    expect(input().value).toBe('f backfile');
    expect(current()).toBe('K Backfile');
    await key(app, 'Enter');
    await key(app, 'Escape');
    expect(input().value).toBe('f backfile');
    await key(app, 'Escape');
    expect(cc()).toBeNull();
  });

  it('Mod-Enter opens the file with no question, from the list and from the question', async () => {
    const app = await mountApp(bridge());
    await openCc(app, 'f backfile');
    await key(app, 'Enter', { ctrlKey: true });
    await tick(100);
    expect(cc()).toBeNull();
    expect(app.tabs()).toContain('K Backfile');
  });

  it('reads an open file from its tab, unsaved edits and all', async () => {
    const app = await mountApp(bridge());
    await openCc(app, 'f backfile');
    await key(app, 'Enter', { ctrlKey: true });
    await tick(100);
    reads.length = 0;
    await app.type('Edited ');
    await app.menu('new');
    await openCc(app, 'f backfile');
    await key(app, 'Enter');
    await key(app, 'Enter');
    expect(reads).toEqual([]);
    expect(rows()[0]).toBe('Edited Pluralism');
  });

  it('Cmd-K asks too, and Search blocks continues in the command center', async () => {
    const app = await mountApp(bridge());
    await app.press('k', { ctrlKey: true });
    const pk = () => document.querySelector('.pk[aria-label="Search files"]')!;
    await app.fill(pk().querySelector('input'), 'backfile', 120);
    const pkKey = (k: string, init: KeyboardEventInit = {}) => key(app, k, init, pk().querySelector('input')!);
    await pkKey('Enter');
    expect([...pk().querySelectorAll('.pk-row .pk-nm')].map((r) => r.textContent)).toEqual(['Search blocks', 'Open']);
    await pkKey('Enter');
    expect(document.querySelector('.pk')).toBeNull();
    expect(input().placeholder).toBe('Search in K Backfile…');
    await app.act(() => {}, 150); // the file is read once the command center is up
    expect(rows()[0]).toBe('Pluralism');
    await key(app, 'Escape');
    expect(input().value).toBe('f ');
  });
});

describe('Search blocks tree', async () => {
  const { canFold, startFolded, visibleTree, blockEntries } = await import('../src/ui/cc-sources');
  const { insertAtEnd } = await import('../src/editor/speech');
  const { make } = await import('./helpers');
  // pocket, hat, block, tag, tag, block (empty), hat, tag
  const L = [1, 2, 3, 4, 4, 3, 2, 4];
  it('folds pockets, hats and blocks that have something under them, never cards', () => {
    expect(L.map((_, i) => canFold(L, i))).toEqual([true, true, true, false, false, false, true, false]);
  });
  it('starts with the blocks closed', () => {
    expect([...startFolded(L)]).toEqual([2]);
    expect(visibleTree(L, startFolded(L))).toEqual([0, 1, 2, 5, 6, 7]);
  });
  it('a closed hat hides everything to the next hat; nothing closed shows it all', () => {
    expect(visibleTree(L, new Set([1]))).toEqual([0, 1, 6, 7]);
    expect(visibleTree(L, new Set())).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it('rows carry the badge, level and the cite under a card', () => {
    const s = make([['block', 'Answers'], ['tag', 'Wrong'], ['normal', 'body']]);
    expect(blockEntries(s.doc).entries.map((e) => [e.badge, e.label, e.level])).toEqual([['BLK', 'Answers', 3], ['TAG', 'Wrong', 4]]);
  });
  it('insertAtEnd adds below everything and leaves the caret; an empty doc is replaced', () => {
    const s = make([['tag', 'Mine'], ['normal', 'x']]);
    const add = make([['tag', 'New']]).doc.content;
    const t = insertAtEnd(s, add);
    const texts: string[] = [];
    t.doc.forEach((n) => { texts.push(n.textContent); });
    expect(texts).toEqual(['Mine', 'x', 'New']);
    expect(t.selection.from).toBe(s.selection.from);
    const empty = make([['normal', '']]);
    expect(insertAtEnd(empty, add).doc.childCount).toBe(1);
  });
});
