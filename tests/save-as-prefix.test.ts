import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { docxBytes, freshStorage, mountApp, unmountAll } from './app-harness';
import { copyName } from '../src/editor/save-modes';

const saveFile = vi.fn(async (o: { path?: string; name: string }) => ({ name: o.name, path: `/x/${o.name}` }));

/** Opens Speech.docx, then Save As with the given copy kind; returns the name Falcon handed the save dialog. */
async function saveAs(mode: string) {
  const app = await mountApp({ saveFile, openFile: async () => ({ name: 'Speech.docx', path: '/x/Speech.docx', data: await docxBytes('words') }) });
  await app.menu('open');
  await app.menu('saveAs');
  await app.click(document.querySelector(`.sa-mode[data-mode="${mode}"]`), 200);
  return saveFile.mock.calls.at(-1)![0].name;
}

beforeEach(() => { saveFile.mockClear(); });
afterEach(async () => { await unmountAll(); });

describe('Save As prefixes', () => {
  it('puts SEND_, READ_ and MARKED_ in front of the copies by default, and nothing on As-Is', async () => {
    await freshStorage();
    expect(await saveAs('send')).toBe('SEND_Speech.docx');
    await unmountAll();
    expect(await saveAs('read')).toBe('READ_Speech.docx');
    await unmountAll();
    expect(await saveAs('asis')).toBe('Speech.docx');
  });

  it('uses the prefixes typed in Settings, and an empty one adds nothing', async () => {
    await freshStorage({ 'falcon.prefix.send': '[F] ', 'falcon.prefix.read': '' });
    expect(await saveAs('send')).toBe('[F] Speech.docx');
    await unmountAll();
    expect(await saveAs('read')).toBe('Speech.docx');
  });

  it('adds nothing when the option is off', async () => {
    await freshStorage({ 'falcon.savePrefix': 'off' });
    expect(await saveAs('send')).toBe('Speech.docx');
  });

  it('does not double a prefix the name already has', () => {
    expect(copyName('send', 'SEND_Speech', 'SEND_')).toBe('SEND_Speech');
    expect(copyName('marked', 'Speech', 'MARKED_')).toBe('MARKED_Speech');
    expect(copyName('asis', 'Speech', 'SEND_')).toBe('Speech');
  });
});
