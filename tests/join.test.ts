import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshStorage, mountApp, unmountAll } from './app-harness';
import { TextSelection } from 'prosemirror-state';
import { undo } from 'prosemirror-history';

beforeEach(async () => { await freshStorage(); });
afterEach(async () => { await unmountAll(); });

type App = Awaited<ReturnType<typeof mountApp>>;
const rows = (app: App) => [...app.el.querySelectorAll('.fs-docs .doc-row')] as HTMLElement[];
const tabBtn = (app: App, i: number) => rows(app)[i].querySelector('.doc-nm') as HTMLElement;
const panes = (app: App) => [...app.el.querySelectorAll('.split .pane')] as HTMLElement[];
const pm = (p: HTMLElement) => p.querySelector('.ProseMirror') as HTMLElement;
const paneText = (p: HTMLElement) => pm(p).textContent;
/** Click into a pane (what a click does first: focus lands in its editor). */
const into = (app: App, p: HTMLElement) => app.act(() => { pm(p).dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });
const split = (app: App) => app.el.querySelector('.app')!.hasAttribute('data-split');
const closeAnyway = () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Close Without Saving') ?? null;
const menuItems = (app: App) => [...app.el.querySelectorAll('.rail-menu .mn-i')].map((b) => b.textContent);

/** Three files, Alpha, Beta and Gamma, the last one open. */
async function three() {
  const app = await mountApp();
  await app.type('Alpha');
  await app.menu('new');
  await app.type('Beta');
  await app.menu('new');
  await app.type('Gamma');
  return app;
}
const shiftClick = (app: App, i: number) => app.act(() => { tabBtn(app, i).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true })); });
/** Shift-click the file whose text starts `text` (the rail regroups joined files, so slots move). */
const shiftOn = (app: App, text: string) => app.act(() => {
  const ids = [...app.el.querySelectorAll('.fs-docs .doc-row')].map((r) => Number((r as HTMLElement).dataset.id));
  const i = ['Alpha', 'Beta', 'Gamma'].indexOf(text);
  const row = app.el.querySelector(`.fs-docs .doc-row[data-id="${[...ids].sort((a, b) => a - b)[i]}"] .doc-nm`)!;
  row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
});
const rightClick = (app: App, i: number) => app.act(() => { rows(app)[i].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 100 })); });
const pickMenu = async (app: App, label: string) => app.click([...app.el.querySelectorAll('.rail-menu .mn-i')].find((b) => b.textContent === label) ?? null);
/** Open the first file, then Shift-click the rest in: each one splits in beside it. */
async function joinRows(app: App, first: number, ...rest: number[]) {
  await app.click(tabBtn(app, first));
  for (const i of rest) await shiftClick(app, i);
}

describe('Join', () => {
  it('shift-click splits a file in beside the open one, and shift-click on a joined one takes it out', async () => {
    const app = await three();
    await shiftOn(app, 'Alpha');
    expect(split(app)).toBe(true);
    expect(panes(app).map((p) => paneText(p))).toEqual(['Alpha', 'Gamma']); // in rail order
    expect(app.view().dom).toBe(pm(panes(app)[0])); // the file you shift-clicked has focus
    await shiftOn(app, 'Beta');
    // the joined files sit together in the rail, so Beta comes in after them
    expect(panes(app).map((p) => paneText(p))).toEqual(['Alpha', 'Gamma', 'Beta']);
    expect(app.view().dom).toBe(pm(panes(app)[2]));
    expect(panes(app).map((p) => p.querySelector('.pane-h .nm')?.textContent)).toEqual(['Untitled', 'Untitled', 'Untitled']);
    expect(rows(app).map((r) => r.dataset.join ?? null)).toEqual(['first', 'mid', 'last']);
    // no right-click Join any more
    await rightClick(app, 0);
    expect(menuItems(app)).toEqual(['Unjoin']);
    await app.press('Escape');
    await shiftOn(app, 'Beta');
    expect(panes(app).map((p) => paneText(p))).toEqual(['Alpha', 'Gamma']);
    await shiftOn(app, 'Alpha');
    expect(split(app)).toBe(false); // below two the split comes apart
    expect(rows(app).every((r) => !r.dataset.join)).toBe(true);
  });

  it('the outline stacks one section per joined file, each with its own 1-4, the focused one marked', async () => {
    const app = await three();
    await joinRows(app, 0, 1);
    const secs = () => [...app.el.querySelectorAll('.olp .ol-sec')] as HTMLElement[];
    expect(app.el.querySelector('.olp')!.hasAttribute('data-stack')).toBe(true);
    expect(secs().map((s) => s.querySelector('.sb-label')?.textContent)).toEqual(['Untitled', 'Untitled']);
    expect(secs().map((s) => s.hasAttribute('data-focus'))).toEqual([false, true]);
    expect(secs().map((s) => s.querySelectorAll('.lv button').length)).toEqual([4, 4]);
    // one file's 1-4 leaves the other's alone
    await app.click(secs()[0].querySelector('.lv button[data-lv="1"]'));
    expect(secs().map((s) => s.querySelector('.lv button[data-on]')?.getAttribute('data-lv'))).toEqual(['1', '3']);
    // back to one file: one outline, its usual name
    await app.click(tabBtn(app, 2));
    expect(secs()).toHaveLength(1);
    expect(secs()[0].querySelector('.sb-label')?.textContent).toBe('Outline');
  });

  it('a click in a pane makes it the one the toolbar and keys act on, and an edit marks only that file unsaved', async () => {
    const app = await three();
    await joinRows(app, 0, 1);
    const [a, b] = panes(app);
    await into(app, b);
    expect(app.view().dom).toBe(pm(b));
    expect(b.hasAttribute('data-on')).toBe(true);
    expect(a.hasAttribute('data-on')).toBe(false);
    expect(tabBtn(app, 1).getAttribute('aria-selected')).toBe('true');
    await app.type('!');
    expect(paneText(b)).toBe('Beta!');
    expect(paneText(a)).toBe('Alpha');
  });

  it('Send to speech puts the card into the speech doc beside it, without making another', async () => {
    const app = await three();
    await joinRows(app, 0, 1);
    const [a, b] = panes(app);
    // the right pane is the speech doc
    await into(app, b);
    await app.click(app.el.querySelector('.tools button[aria-label^="Speech doc"]'));
    await into(app, a);
    const v = app.view();
    await app.act(() => { v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 1, 6))); });
    await app.press('`');
    expect(rows(app)).toHaveLength(3);
    expect(paneText(b)).toBe('BetaAlpha');
    expect(app.toast()).toContain('Sent');
    // its Undo takes it back out of the pane
    await app.click(app.el.querySelector('.toast button'));
    expect(paneText(b)).toBe('Beta');
  });

  it('the first send makes the speech doc after the group, so the joined files stay together', async () => {
    const app = await three();
    await joinRows(app, 0, 1);
    await into(app, panes(app)[0]);
    const v = app.view();
    await app.act(() => { v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 1, 6))); });
    await app.press('`');
    expect(rows(app).map((r) => r.dataset.join ?? null)).toEqual(['first', 'last', null, null]);
    expect(app.tabs()[2]).toBe('Speech (speech doc)');
    expect(panes(app)).toHaveLength(2);
  });

  it('another file shows alone and the group stays joined; going back shows the group with its edits and undo', async () => {
    const app = await three();
    await joinRows(app, 0, 1);
    await into(app, panes(app)[0]);
    await app.type(' one');
    await app.click(tabBtn(app, 2));
    expect(split(app)).toBe(false);
    expect(app.text()).toBe('Gamma');
    expect(rows(app).map((r) => r.dataset.join ?? null)).toEqual(['first', 'last', null]);
    await app.click(tabBtn(app, 1));
    expect(split(app)).toBe(true);
    expect(app.view().dom).toBe(pm(panes(app)[1]));
    expect(paneText(panes(app)[0])).toBe('Alpha one');
    await into(app, panes(app)[0]);
    const left = app.view();
    await app.act(() => { undo(left.state, left.dispatch); });
    expect(paneText(panes(app)[0])).toBe('Alpha');
  });

  it('stops at the max from Settings', async () => {
    await freshStorage({ 'falcon.joinMax': '2' });
    const app = await three();
    await shiftOn(app, 'Alpha');
    await shiftOn(app, 'Beta');
    expect(app.toast()).toContain('You can join up to 2 files');
    expect(panes(app).map((p) => paneText(p))).toEqual(['Alpha', 'Gamma']);
  });

  it('joins three by default', async () => {
    const app = await three();
    await joinRows(app, 0, 1, 2);
    expect(panes(app).map((p) => paneText(p))).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('Unjoin puts the files back one at a time, the focused one on screen', async () => {
    const app = await three();
    await joinRows(app, 0, 1);
    await into(app, panes(app)[0]);
    await rightClick(app, 0);
    expect(menuItems(app)).toEqual(['Unjoin']);
    await pickMenu(app, 'Unjoin');
    expect(split(app)).toBe(false);
    expect(panes(app)).toHaveLength(0);
    expect(app.text()).toBe('Alpha');
    expect(rows(app).some((r) => r.dataset.join)).toBe(false);
    await app.click(tabBtn(app, 1));
    expect(app.text()).toBe('Beta');
  });

  it('closing a joined file shrinks the group, and below two it comes apart', async () => {
    const app = await three();
    await joinRows(app, 0, 1, 2);
    await into(app, panes(app)[1]);
    await app.menu('close'); // Beta has typing in it, so it asks
    await app.click(closeAnyway());
    expect(panes(app).map((p) => paneText(p))).toEqual(['Alpha', 'Gamma']);
    expect(rows(app)).toHaveLength(2);
    expect(app.view().dom).toBe(pm(panes(app)[1])); // the file that took its place
    await app.menu('close');
    await app.click(closeAnyway());
    expect(split(app)).toBe(false);
    expect(rows(app)).toHaveLength(1);
    expect(app.text()).toBe('Alpha');
  });

  it('a new file opens alone, after the group, which stays joined', async () => {
    const app = await three();
    await joinRows(app, 0, 1);
    await app.menu('new');
    expect(split(app)).toBe(false);
    expect(rows(app)).toHaveLength(4);
    expect(rows(app).map((r) => r.dataset.join ?? null)).toEqual(['first', 'last', null, null]);
    expect(app.text()).toBe('');
    await app.click(tabBtn(app, 0));
    expect(panes(app).map((p) => paneText(p))).toEqual(['Alpha', 'Beta']);
  });
});
