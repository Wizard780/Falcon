// Hiding files and folders from search, in Settings > File search. The web build has no folder index, so the page gets
// a stand-in bridge. A hidden file stops showing in Cmd-K, a hidden folder takes everything inside it with it, an open
// tree shows what's hidden, and the Hidden from search list brings things back. The list is sent along to Search cards.
import { openFalcon, MOD } from '../lib/falcon.mjs';
const f = await openFalcon('hidden-files', { viewport: { width: 1440, height: 860 } });
const p = f.page;
await p.context().addInitScript(() => {
  const F = [
    { path: '/Users/a/Dropbox/Aff/1AC.docx', root: '/Users/a/Dropbox', mtime: 1 },
    { path: '/Users/a/Dropbox/Aff/2AC.docx', root: '/Users/a/Dropbox', mtime: 2 },
    { path: '/Users/a/Dropbox/Neg/Cap K.docx', root: '/Users/a/Dropbox', mtime: 3 },
    { path: '/Users/a/Dropbox/Neg/Old/Cap Backfile.docx', root: '/Users/a/Dropbox', mtime: 4 },
  ];
  window.__cardAsks = [];
  window.falcon = {
    indexFolders: async () => [{ path: '/Users/a/Dropbox', count: 4, missing: false }], indexedFiles: async () => F,
    searchCards: async (q, hidden) => { window.__cardAsks.push(hidden); return { hits: [], status: { files: 4, cards: 0, scanning: false } }; },
  };
});
await p.reload(); await p.waitForSelector('.ProseMirror'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
const found = async (q) => {
  await p.keyboard.press(`${MOD}+k`); await p.waitForSelector('.pk input'); await p.waitForTimeout(200);
  await p.fill('.pk input', q); await p.waitForTimeout(100);
  const names = await p.$$eval('.pk-row .pk-nm', (rs) => rs.map((r) => r.textContent));
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  return names.join(', ');
};
const openPage = async () => {
  await p.click('.fstrip [aria-label="Settings"]');
  await p.click('[aria-label="Settings sections"] button:has-text("File search")'); await p.waitForTimeout(200);
};
const close = async () => { await p.click('[aria-label="Close settings"]'); await p.waitForTimeout(200); };

f.want((await found('cap')).includes('Cap K') && (await found('cap')).includes('Cap Backfile'), 'both Cap files show to start with');
await openPage();
f.want(await p.isVisible('h3:has-text("Hidden from search")') && await p.isVisible('text=Nothing hidden'), 'Settings has a Hidden from search list, empty at first');
await p.click('[aria-label="Open Dropbox"]'); await p.waitForTimeout(100);
await p.click('.stt-dir:has-text("Aff") .stt-open'); await p.waitForTimeout(100);
await p.click('[aria-label="Hide 1AC"]'); await p.waitForTimeout(100);
f.want(await p.isVisible('.stt-file[data-off]:has-text("1AC")'), 'a hidden file is crossed out in the tree');
await p.click('[aria-label="Hide Neg"]'); await p.waitForTimeout(100);
await p.click('.stt-dir:has-text("Neg") .stt-open'); await p.waitForTimeout(100);
f.want(await p.isDisabled('[aria-label="Hide Cap K"]'), 'a file inside a hidden folder has nothing to do on its own');
await f.shot('tree-hidden');
await close();

f.want(await found('1ac') === '', `the hidden file is gone from Cmd-K: ${await found('1ac')}`);
f.want(await found('2ac') === '2AC', 'the file next to it stays');
f.want(await found('cap') === '', 'a hidden folder takes its files and folders with it');

await p.keyboard.press(`${MOD}+Shift+k`); await p.waitForTimeout(300);
await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
const asked = await p.evaluate(() => window.__cardAsks.at(-1));
f.want(asked?.includes('/Users/a/Dropbox/Neg') && asked?.includes('/Users/a/Dropbox/Aff/1AC.docx'), `Search cards is told what's hidden: ${asked}`);

await openPage();
const list = await p.$$eval('.st-row:has(.st-eye) .st-txt span', (s) => s.map((x) => x.textContent));
f.want(list.includes('1AC') && list.includes('Neg'), `the list names what's hidden: ${list.join(', ')}`);
await p.locator('.st-row:not(.st-tree) [aria-label="Show Neg"]').click(); await p.waitForTimeout(100);
await close();
f.want((await found('cap')).includes('Cap Backfile'), 'showing the folder brings its files back');
f.want(await found('1ac') === '', 'and the other hidden file stays hidden');
const saved = await p.evaluate(() => localStorage.getItem('falcon.hiddenFiles'));
f.want(JSON.parse(saved).join() === '/Users/a/Dropbox/Aff/1AC.docx', `the list is saved: ${saved}`);
await f.done();
