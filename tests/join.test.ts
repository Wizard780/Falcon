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
const rightClick = (app: App, i: number) => app.act(() => { rows(app)[i].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 100 })); });
const pickMenu = async (app: App, label: string) => app.click([...app.el.querySelectorAll('.rail-menu .mn-i')].find((b) => b.textContent === label) ?? null);
async function joinRows(app: App, ...is: number[]) {
  for (const i of is) await shiftClick(app, i);
  await rightClick(app, is[0]);
  await pickMenu(app, 'Join');
}

describe('Join', () => {
  it('shift-click picks files without opening them, and right-click joins them side by side', async () => {
    const app = await three();
    await shiftClick(app, 0);
    await shiftClick(app, 1);
    expect(app.text()).toBe('Gamma'); // still on the file that was open
    expect(rows(app).map((r) => r.hasAttribute('data-sel'))).toEqual([true, true, false]);
    await rightClick(app, 1);
    expect(app.el.querySelector('.rail-menu .mn-h')?.textContent).toBe('2 files selected');
    expect(menuItems(app)).toEqual(['Join']);
    await pickMenu(app, 'Join');
    expect(split(app)).toBe(true);
    expect(panes(app).map((p) => paneText(p))).toEqual(['Alpha', 'Beta']);
    expect(panes(app).map((p) => p.querySelector('.pane-h .nm')?.textContent)).toEqual(['Untitled', 'Untitled']);
    expect(rows(app).map((r) => r.dataset.join ?? null)).toEqual(['first', 'last', null]);
    expect(rows(app).some((r) => r.hasAttribute('data-sel'))).toBe(false);
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
    await shiftClick(app, 0);
    await shiftClick(app, 1);
    await shiftClick(app, 2);
    expect(app.toast()).toContain('You can join up to 2 files');
    expect(rows(app).map((r) => r.hasAttribute('data-sel'))).toEqual([true, true, false]);
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
