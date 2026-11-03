import { afterEach, describe, expect, it, vi } from 'vitest';
import { freshStorage, mountApp, unmountAll } from './app-harness';
import { formatDate, speechFileName } from '../src/ui/files';

afterEach(async () => { await unmountAll(); });

const at = new Date(2026, 3, 5, 19, 5, 7); // Sun Apr 5 2026, 7:05:07 PM

describe('speech doc names', () => {
  it('writes out every date token', () => {
    expect(formatDate('YYYY YY M MM MMM MMMM D DD ddd dddd', at)).toBe('2026 26 4 04 Apr April 5 05 Sun Sunday');
    expect(formatDate('h hh H HH m mm s ss A a', at)).toBe('7 07 19 19 5 05 7 07 PM pm');
    expect(formatDate('h-mmA [on] MMM D', at)).toBe('7-05PM on Apr 5');
  });

  it('fills {speech} and {date:…}, and keeps the file name legal', () => {
    expect(speechFileName('1NC', 'Speech {speech} {date:M-D h-mmA}', at)).toBe('Speech 1NC 4-5 7-05PM');
    expect(speechFileName('', 'Speech {speech} {date:M-D}', at)).toBe('Speech 4-5');
    expect(speechFileName('2AC', '{speech} {date:M/D}', at)).toBe('2AC 4-5');
    expect(speechFileName('1AR', '', at)).toBe('1AR');
  });
});

describe('New speech doc', () => {
  it('asks for a name, opens on a pocket with it, and makes it the speech doc', async () => {
    await freshStorage({ 'falcon.speechName': 'Speech {speech}' });
    const saveFile = vi.fn(async (o: { name: string }) => ({ name: o.name, path: `/x/${o.name}` }));
    const app = await mountApp({ saveFile });
    await app.menu('newSpeech');
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Speech name"]');
    expect(input).not.toBeNull();
    await app.fill(input, '1NC');
    expect(document.querySelector('.ns-file')?.textContent).toBe('Saves as Speech 1NC.docx');
    await app.act(() => input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })), 100);
    expect(document.querySelector('input[aria-label="Speech name"]')).toBeNull();

    const doc = app.view().state.doc;
    expect(doc.firstChild!.attrs.style).toBe('pocket');
    expect(doc.firstChild!.textContent).toBe('1NC');
    expect(app.view().state.selection.$head.parent.attrs.style).toBe('normal'); // typing goes under the pocket
    expect(document.querySelector('.tools button[aria-pressed="true"] svg')).not.toBeNull(); // the mic is on

    await app.menu('save', 200);
    expect(saveFile.mock.calls.at(-1)![0].name).toBe('Speech 1NC.docx');
  });

  it('Esc closes the dialog without making a doc', async () => {
    await freshStorage();
    const app = await mountApp();
    await app.menu('newSpeech');
    await app.press('Escape');
    expect(document.querySelector('input[aria-label="Speech name"]')).toBeNull();
    expect(app.view().state.doc.firstChild!.attrs.style).toBe('normal');
  });
});

describe('New speech doc key', () => {
  it('Ctrl-Shift-N opens the dialog', async () => {
    await freshStorage();
    const app = await mountApp();
    await app.press('N', { ctrlKey: true, shiftKey: true, code: 'KeyN', keyCode: 78 });
    expect(document.querySelector('input[aria-label="Speech name"]')).not.toBeNull();
  });
});

describe('New speech doc dialog is modal', () => {
  it('app shortcuts wait while it is up', async () => {
    await freshStorage();
    const app = await mountApp();
    await app.type('words'); // not blank, so a new doc would get its own tab
    await app.menu('newSpeech');
    await app.press('n', { ctrlKey: true, keyCode: 78, code: 'KeyN' }); // Mod-N: no Untitled behind it
    expect(app.tabs().length).toBe(1);
    expect(document.querySelector('input[aria-label="Speech name"]')).not.toBeNull();
  });

  it('Esc over Home closes the dialog, not Home', async () => {
    await freshStorage();
    const app = await mountApp();
    await app.press('t', { ctrlKey: true, keyCode: 84, code: 'KeyT' }); // Home
    await app.click([...document.querySelectorAll('.hm-act')].find((b) => b.textContent?.includes('New speech doc')) ?? null);
    expect(document.querySelector('input[aria-label="Speech name"]')).not.toBeNull();
    await app.press('Escape');
    expect(document.querySelector('input[aria-label="Speech name"]')).toBeNull();
    expect(document.querySelector('.hm-act')).not.toBeNull();
  });
});
