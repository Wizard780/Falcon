import { afterEach, describe, expect, it } from 'vitest';
import { schema } from '../src/editor/schema';
import { KEEP_DAYS, daysAgo, fresh, groupRecents, loadRecents, noteRecent, saveRecents, type Recent } from '../src/ui/recents';
import { freshStorage, mountApp, unmountAll } from './app-harness';

// "now" is Wednesday Nov 4 2026, 10:00 on the local clock; ago(n, h, m) is n calendar days before it at h:m
const now = new Date(2026, 10, 4, 10, 0);
const ago = (days: number, h = 12, m = 0) => new Date(2026, 10, 4 - days, h, m).getTime();
const recent = (name: string, when: number): Recent => ({ name, path: `/x/${name}.docx`, folder: 'x', cards: 0, blocks: [], when });
const sections = (list: Recent[], at = now) => groupRecents(list, at).map((g) => [g.label, g.items.map((r) => r.name)]);

describe('recent files by day', () => {
  it('starts Today at local midnight: a file opened at 23:59 yesterday is in Last 7 days', () => {
    expect(sections([recent('midnight', ago(0, 0, 0)), recent('late', ago(1, 23, 59))])).toEqual([
      ['Today', ['midnight']],
      ['Last 7 days', ['late']],
    ]);
  });

  it('puts the six days before today in Last 7 days and the day before those in Earlier', () => {
    expect(sections([recent('six', ago(6, 0, 0)), recent('seven', ago(7, 23, 59))])).toEqual([
      ['Last 7 days', ['six']],
      ['Earlier', ['seven']],
    ]);
  });

  it('keeps a month: an entry exactly 30 days old stays, one 31 days old goes', () => {
    expect(KEEP_DAYS).toBe(30);
    const list = [recent('thirty', ago(30, 10, 0)), recent('thirty-early', ago(30, 0, 0)), recent('thirty-one', ago(31, 23, 59))];
    expect(sections(list)).toEqual([['Earlier', ['thirty', 'thirty-early']]]);
    expect(fresh(list, now).map((r) => r.name)).toEqual(['thirty', 'thirty-early']);
  });

  it('leaves out empty sections and keeps the list order inside each', () => {
    expect(sections([recent('b', ago(0, 9)), recent('a', ago(0, 8)), recent('old', ago(12))])).toEqual([
      ['Today', ['b', 'a']],
      ['Earlier', ['old']],
    ]);
    expect(groupRecents([], now)).toEqual([]);
  });

  it('counts a time in the future (a clock set back) as today, and drops an entry with no time', () => {
    const noTime = { ...recent('no time', 0), when: undefined } as unknown as Recent;
    expect(sections([recent('tomorrow', ago(-1)), noTime])).toEqual([['Today', ['tomorrow']]]);
  });

  it('counts the day the clocks change as one day', () => {
    // US clocks went back an hour early on Sunday Nov 1 2026, so Nov 1 is 25 hours long there
    const monday = new Date(2026, 10, 2, 0, 30);
    expect(daysAgo(new Date(2026, 10, 1, 0, 30).getTime(), monday)).toBe(1);
    expect(daysAgo(new Date(2026, 9, 31, 23, 59).getTime(), monday)).toBe(2);
    expect(daysAgo(new Date(2026, 10, 2, 0, 0).getTime(), monday)).toBe(0);
  });

  it('moves a reopened file to the top of Today and drops entries past the month', () => {
    const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create({ style: 'tag' }, [schema.text('A tag')])]);
    const list = [recent('b', Date.now() - 2 * 86_400_000), recent('a', Date.now() - 3 * 86_400_000), recent('gone', Date.now() - 40 * 86_400_000)];
    const next = noteRecent(list, doc, { name: 'a', path: '/x/a.docx' });
    expect(next.map((r) => r.name)).toEqual(['a', 'b']);
    expect(groupRecents(next)[0]).toMatchObject({ label: 'Today', items: [{ name: 'a' }] });
  });
});

describe('the month limit in storage', () => {
  const stored = () => (JSON.parse(localStorage.getItem('falcon.recents.v1') ?? '[]') as Recent[]).map((r) => r.name);
  const day = 86_400_000;

  it('loads only the last month and saves only the last month', async () => {
    await freshStorage({ 'falcon.recents.v1': JSON.stringify([recent('new', Date.now()), recent('old', Date.now() - 45 * day)]) });
    expect(loadRecents().map((r) => r.name)).toEqual(['new']);
    saveRecents([recent('new', Date.now()), recent('old', Date.now() - 45 * day)]);
    expect(stored()).toEqual(['new']);
  });
});

describe('Home', () => {
  // times counted from local midnight, so the test means the same thing at any hour it runs
  const midnight = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const daysBack = (n: number, h = 12) => new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() - n, h).getTime();
  const headers = () => [...document.querySelectorAll('.hm-sec')].map((h) => h.textContent);
  const rowsIn = () => [...document.querySelectorAll('.hm-grp')].map((g) => [g.getAttribute('aria-label'), [...g.querySelectorAll('.hm-row .nm')].map((n) => n.textContent)]);
  const stored = () => (JSON.parse(localStorage.getItem('falcon.recents.v1') ?? '[]') as Recent[]).map((r) => r.name);
  afterEach(unmountAll);

  it('lists recents under Today, Last 7 days and Earlier, and forgets the ones past a month', async () => {
    await freshStorage({
      'falcon.openHome': 'on',
      'falcon.recents.v1': JSON.stringify([
        recent('Aff', Date.now()), recent('Neg', midnight.getTime()), recent('Blocks', daysBack(1, 23)), recent('Topic', daysBack(20)), recent('Septober', daysBack(45)),
      ]),
    });
    const app = await mountApp();
    expect(headers()).toEqual(['Today', 'Last 7 days', 'Earlier']);
    expect(rowsIn()).toEqual([['Today', ['Aff', 'Neg']], ['Last 7 days', ['Blocks']], ['Earlier', ['Topic']]]);
    expect(stored()).toEqual(['Aff', 'Neg', 'Blocks', 'Topic']);

    // the arrow keys walk straight across a section's edge
    const home = document.querySelector('.home')!;
    for (let i = 0; i < 2; i++) await app.act(() => home.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
    expect(document.querySelector('.hm-row[data-on] .nm')?.textContent).toBe('Blocks');
  });

  it('shows only the sections that have files', async () => {
    await freshStorage({ 'falcon.openHome': 'on', 'falcon.recents.v1': JSON.stringify([recent('Aff', Date.now()), recent('Topic', daysBack(9))]) });
    await mountApp();
    expect(headers()).toEqual(['Today', 'Earlier']);
  });

  it('keeps the empty state when every recent is past a month', async () => {
    await freshStorage({ 'falcon.openHome': 'on', 'falcon.recents.v1': JSON.stringify([recent('Septober', daysBack(31)), recent('August', daysBack(80))]) });
    await mountApp();
    expect(headers()).toEqual([]);
    expect(document.querySelector('.hm-none')?.textContent).toContain('No recent files yet');
    expect(stored()).toEqual([]);
  });
});
