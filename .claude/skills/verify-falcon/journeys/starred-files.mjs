// Starred files in Cmd-K file search. The web build has no folder index, so the page gets a stand-in
// bridge with two Dropboxes that both hold an Impact Defense file: Alt-P and the star button star one,
// it goes to the top marked with a gold star, its copy in the other Dropbox is hidden (a same-named file in another folder is not), and the star is saved.
import { openFalcon, MOD } from '../lib/falcon.mjs';
const f = await openFalcon('starred-files', { viewport: { width: 1440, height: 860 } });
const p = f.page;
// two Dropboxes in file search, both with an Impact Defense file
await p.context().addInitScript(() => {
  const F = [
    { path: '/Users/a/Dropbox/DA/Impact Defense.docx', root: '/Users/a/Dropbox', mtime: 1 },
    { path: '/Users/a/Team Dropbox/DA/Impact Defense.docx', root: '/Users/a/Team Dropbox', mtime: 9 },
    { path: '/Users/a/Team Dropbox/DA/Impact Turns.docx', root: '/Users/a/Team Dropbox', mtime: 5 },
    { path: '/Users/a/Dropbox/Old Topic/Impact Defense.docx', root: '/Users/a/Dropbox', mtime: 2 },
    { path: '/Users/a/Dropbox/Aff/Aff---1AC.docx', root: '/Users/a/Dropbox', mtime: 3 },
  ];
  window.falcon = { indexFolders: async () => [{ path: '/Users/a/Dropbox', count: 2, missing: false }, { path: '/Users/a/Team Dropbox', count: 2, missing: false }], indexedFiles: async () => F };
});
await p.reload(); await p.waitForSelector('.ProseMirror'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
const rows = () => p.$$eval('.pk-row', (rs) => rs.map((r) => `${r.querySelector('.pk-nm').textContent} | ${r.querySelector('.pk-in').textContent}${r.dataset.star !== undefined ? ' | ★' : ''}`));
const openK = async () => { await p.keyboard.press(`${MOD}+k`); await p.waitForSelector('.pk input'); await p.waitForTimeout(300); };
await openK();
await p.fill('.pk input', 'impact'); await p.waitForTimeout(100);
const r0 = await rows();
f.want(r0.length === 4 && r0.filter((r) => r.startsWith('Impact Defense')).length === 3, `both Impact Defense files show before starring: ${r0.join(' / ')}`);
f.want(r0.some((r) => r.includes('Team Dropbox › DA')) && r0.some((r) => r.includes('| Dropbox › DA')), 'rows say which Dropbox');
await f.shot('before-star');
// the main Dropbox one: arrow to it and Alt-P
const idx = r0.findIndex((r) => r.startsWith('Impact Defense | Dropbox › DA'));
for (let i = 0; i < idx; i++) await p.keyboard.press('ArrowDown');
await p.keyboard.press('Alt+KeyP'); await p.waitForTimeout(150);
const r1 = await rows();
f.want(r1[0] === 'Impact Defense | Dropbox › DA · 1 more hidden | ★' && r1.filter((r) => r.startsWith('Impact Defense')).length === 2 && r1.some((r) => r.includes('Old Topic')), `Alt-P stars it: top, marked, the copy hidden, the Old Topic file kept: ${r1.join(' / ')}`);
f.want(await p.$eval('.pk-row[data-on] .pk-nm', (x) => x.textContent) === 'Impact Defense', 'the highlight follows it to the top');
f.want(await p.$eval('.pk-row[data-star] .pk-star', (b) => getComputedStyle(b.querySelector('svg')).color) === 'rgb(226, 179, 60)', 'the star is gold');
await f.shot('starred');
await p.fill('.pk input', ''); await p.waitForTimeout(100);
const heads = await p.$$eval('.pk-head', (h) => h.map((x) => x.textContent));
f.want(heads[0] === 'Starred' && (await rows())[0].startsWith('Impact Defense'), `empty box lists it under Starred first (${heads})`);
await f.shot('empty-starred');
await p.keyboard.press('Escape'); await p.waitForTimeout(100);
await openK();
f.want((await rows())[0]?.endsWith('★'), 'still starred after reopening');
await p.fill('.pk input', 'aff 1ac'); await p.waitForTimeout(100);
await p.hover('.pk-row'); await p.click('.pk-row .pk-star'); await p.waitForTimeout(100);
f.want(!!(await p.$('.pk')) && (await rows())[0].endsWith('★'), 'clicking the star stars it without opening the file');
await p.click('.pk-row .pk-star'); await p.waitForTimeout(100);
f.want(!(await rows())[0].endsWith('★'), 'clicking again unstars');
f.want(JSON.parse(await p.evaluate(() => localStorage.getItem('falcon.starredFiles'))).join() === '/Users/a/Dropbox/DA/Impact Defense.docx', 'saved');
await f.done();
