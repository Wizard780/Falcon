import { afterEach, describe, expect, it, vi } from 'vitest';
import { docxBytes, freshStorage, mountApp, tick, unmountAll } from './app-harness';

afterEach(async () => { await unmountAll(); });

type File = { index: number; name: string; ctime: number };
/** A fake window.falcon.speechdrop with one room, "Round 3" (rd3abc), and a way to push files into it. */
function fakeSd(files: File[] = [{ index: 0, name: 'Aff 1AC.docx', ctime: Date.now() - 60_000 }]) {
  let push: ((u: { room: string; files: File[]; live: boolean }) => void) | null = null;
  let list = files;
  const api = {
    room: vi.fn(async (room: string) => (room === 'rd3abc' ? { ok: true, value: { room, name: 'Round 3', files: list } } : { ok: false, error: 'no_room' })),
    make: vi.fn(async () => ({ ok: true, value: 'rd3abc' })),
    upload: vi.fn(async (_room: string, name: string) => {
      list = [{ index: list.length, name, ctime: Date.now() }, ...list];
      return { ok: true, value: { files: list, index: list[0].index } };
    }),
    remove: vi.fn(async (_room: string, index: number) => { list = list.filter((f) => f.index !== index); return { ok: true, value: list }; }),
    pick: vi.fn(async () => ({ ok: true, value: [] })),
    open: vi.fn(async (_room: string, _i: number, name: string) => ({ ok: true, value: { path: `/dl/${name}`, docx: name.endsWith('.docx') } })),
    download: vi.fn(async () => ({ ok: true, value: '/dl/x' })),
    archive: vi.fn(async () => ({ ok: true, value: { path: '/dl/Round 3.zip', count: 1, skipped: 0 } })),
    watch: vi.fn((_room: string, _f: unknown, f: typeof push) => { push = f; return () => { push = null; }; }),
  };
  return { api, push: (f: File[]) => { list = f; push?.({ room: 'rd3abc', files: f, live: true }); }, watching: () => push !== null };
}

const panel = () => document.querySelector('section.sd');
const sdTab = () => document.querySelector('.fs-docs .sd-tab .doc-nm');
const button = (text: string) => [...document.querySelectorAll('.sd button')].find((b) => b.textContent?.includes(text)) ?? null;

async function joined(extra: Record<string, unknown> = {}) {
  await freshStorage();
  const sd = fakeSd();
  const app = await mountApp({ speechdrop: sd.api, ...extra });
  await app.act(() => window.dispatchEvent(new Event('falcon:sd-show')));
  await app.fill(document.querySelector('input[aria-label="Room code"]'), 'rd3abc', 100);
  return { app, sd };
}

describe('SpeechDrop tab', () => {
  it('opens as a tab after the docs, joins a room by its code, and lists its files', async () => {
    const { app, sd } = await joined();
    expect(sd.api.room).toHaveBeenCalledWith('rd3abc');
    expect(panel()?.classList.contains('open')).toBe(true);
    expect(sdTab()?.getAttribute('aria-label')).toBe('SpeechDrop: Round 3');
    expect(app.tabs()).toEqual(['Untitled', 'SpeechDrop: Round 3']);
    expect(app.tab('Untitled')?.hasAttribute('data-on')).toBe(false); // only the lit tab is lit
    expect(document.querySelector('.sd-hi')?.textContent).toBe('Round 3');
    expect([...document.querySelectorAll('.sd-f .nm')].map((n) => n.textContent)).toEqual(['Aff 1AC.docx']);
    expect(sd.watching()).toBe(true);
  });

  it('a wrong code says so and stays in the lobby', async () => {
    await freshStorage();
    const sd = fakeSd();
    const app = await mountApp({ speechdrop: sd.api });
    await app.act(() => window.dispatchEvent(new Event('falcon:sd-show')));
    await app.fill(document.querySelector('input[aria-label="Room code"]'), 'zzzzzz', 100);
    expect(document.querySelector('.sd-hint')?.textContent).toBe('No room has that code');
    expect(app.toast()).toBe('No room has that code');
    expect(document.querySelector('.sd-hi')?.textContent).toBe('Join a room');
  });

  it('clicking the doc goes back to it; the tab stays and keeps watching', async () => {
    const { app, sd } = await joined();
    await app.click(app.tab('Untitled'));
    expect(panel()?.classList.contains('open')).toBe(false);
    expect(app.tab('Untitled')?.hasAttribute('data-on')).toBe(true);
    expect(sdTab()).not.toBeNull();
    expect(sd.watching()).toBe(true);
    await app.click(sdTab());
    expect(panel()?.classList.contains('open')).toBe(true);
  });

  it('a file that arrives while you are in a doc: a dot on the tab and a toast that shows it', async () => {
    const { app, sd } = await joined();
    await app.click(app.tab('Untitled'));
    await app.act(() => sd.push([{ index: 1, name: 'Neg 1NC.docx', ctime: Date.now() }, { index: 0, name: 'Aff 1AC.docx', ctime: 1 }]));
    expect(app.toast()).toContain('New in SpeechDrop: Neg 1NC.docx');
    expect(sdTab()?.getAttribute('aria-label')).toBe('SpeechDrop: Round 3 (1 new)');
    expect(document.querySelector('.fs-docs .sd-tab .dot.new')).not.toBeNull();
    await app.click(document.querySelector('.toast button'));
    expect(panel()?.classList.contains('open')).toBe(true);
    expect(document.querySelector('.sd-row[data-fresh] .nm')?.textContent).toBe('Neg 1NC.docx');
  });

  it('Mod-W closes the SpeechDrop tab, not the doc under it', async () => {
    const { app, sd } = await joined();
    await app.type('keep me');
    await app.press('w', { ctrlKey: true });
    expect(sdTab()).toBeNull();
    expect(sd.watching()).toBe(false);
    expect(app.tabs()).toEqual(['Untitled']);
    expect(app.text()).toBe('keep me');
    expect(document.querySelector('.cf')).toBeNull(); // no "close without saving?" for the doc
  });

  it('File > Close Document closes the SpeechDrop tab while it shows, and Find goes back to the doc', async () => {
    const { app } = await joined();
    await app.type('keep me');
    await app.menu('close');
    expect(sdTab()).toBeNull();
    expect(app.tabs()).toEqual(['Untitled']);
    expect(document.querySelector('.cf')).toBeNull();
    await app.act(() => window.dispatchEvent(new Event('falcon:sd-show')));
    expect(panel()?.classList.contains('open')).toBe(true);
    await app.press('f', { ctrlKey: true });
    expect(panel()?.classList.contains('open')).toBe(false);
    expect(document.querySelector('.findbar')).not.toBeNull();
  });

  it('next and previous doc walk through the SpeechDrop tab', async () => {
    const { app } = await joined();
    await app.press('Tab', { ctrlKey: true });
    expect(panel()?.classList.contains('open')).toBe(false);
    await app.press('Tab', { ctrlKey: true });
    expect(panel()?.classList.contains('open')).toBe(true);
  });

  it('Upload sends the doc you came from as a .docx, unsaved', async () => {
    const { app, sd } = await joined();
    await app.click(app.tab('Untitled'));
    await app.type('the plan');
    await app.click(sdTab());
    await app.click(button('Upload Untitled'), 300);
    expect(sd.api.upload).toHaveBeenCalledTimes(1);
    const [room, name, data] = sd.api.upload.mock.calls[0] as unknown as [string, string, Uint8Array];
    expect([room, name]).toEqual(['rd3abc', 'Untitled.docx']);
    const { docxToDoc } = await import('../src/docx/import');
    expect((await docxToDoc(data)).textContent).toBe('the plan');
    expect(app.toast()).toBe('Uploaded Untitled.docx to Round 3');
    // your own upload: not "new", and you may delete it (after a yes)
    expect(document.querySelector('.sd-row[data-fresh]')).toBeNull();
    const del = document.querySelector('[aria-label="Delete Untitled.docx"]');
    expect(del).not.toBeNull();
    expect(document.querySelector('[aria-label="Delete Aff 1AC.docx"]')).toBeNull(); // not theirs
    await app.click(del);
    await app.click([...document.querySelectorAll('.cf button')].find((b) => b.textContent === 'Delete')!);
    expect(sd.api.remove).toHaveBeenCalledWith('rd3abc', 1);
    expect([...document.querySelectorAll('.sd-f .nm')].map((n) => n.textContent)).toEqual(['Aff 1AC.docx']);
  });

  it('opening a .docx from the room opens it as a Falcon tab', async () => {
    const bytes = await docxBytes('Aff card');
    const openPath = vi.fn(async (p: string) => ({ name: 'Aff 1AC.docx', path: p, data: bytes }));
    const { app, sd } = await joined({ openPath });
    await app.click(document.querySelector('.sd-f'), 300);
    expect(sd.api.open).toHaveBeenCalledWith('rd3abc', 0, 'Aff 1AC.docx');
    expect(openPath).toHaveBeenCalledWith('/dl/Aff 1AC.docx');
    expect(app.tabs()).toEqual(['Aff 1AC', 'SpeechDrop: Round 3']); // the blank Untitled made way
    expect(panel()?.classList.contains('open')).toBe(false);
    expect(app.text()).toBe('Aff card');
  });

  it('makes a room by name and remembers rooms joined', async () => {
    await freshStorage();
    const sd = fakeSd();
    const app = await mountApp({ speechdrop: sd.api });
    await app.act(() => window.dispatchEvent(new Event('falcon:sd-show')));
    await app.fill(document.querySelector('input[aria-label="New room name"]'), 'Round 3');
    await app.act(() => document.querySelector('form.sd-make')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })), 100);
    expect(sd.api.make).toHaveBeenCalledWith('Round 3');
    expect(document.querySelector('.sd-hi')?.textContent).toBe('Round 3');
    await app.click(button('Leave room'));
    expect([...document.querySelectorAll('.sd-rr .nm')].map((n) => n.textContent)).toEqual(['Round 3']);
  });

  it('is a command (no key until you set one), and Home has a button for it', async () => {
    await freshStorage({ 'falcon.openHome': 'on' });
    const app = await mountApp({ speechdrop: fakeSd().api });
    const { bindingOf } = await import('../src/editor/keybinds');
    expect(bindingOf('speechdrop')?.key).toBe('');
    const home = [...document.querySelectorAll('.home .hm-act')].find((b) => b.textContent?.includes('SpeechDrop'));
    await app.click(home!);
    expect(panel()?.classList.contains('open')).toBe(true);
    expect(document.querySelector('.home.open')).toBeNull();
    await tick();
  });

  it('the web build says it needs the desktop app', async () => {
    await freshStorage();
    const app = await mountApp();
    await app.act(() => window.dispatchEvent(new Event('falcon:sd-show')));
    expect(document.querySelector('.sd-hi')?.textContent).toBe('SpeechDrop needs the desktop app');
  });
});
