// Starred files: starred in Settings > File search, shown first in Cmd-K file search. The web build has no folder
// index, so the page gets a stand-in bridge with two Dropboxes that both hold an Impact Defense file: starring one in
// Settings puts it at the top of file search with a gold star, its copy in the other Dropbox is hidden (a same-named
// file in another folder is not), the popup itself has no star button, and the star is saved.
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
const openStars = async () => {
  await p.click('.fstrip [aria-label="Settings"]');
  await p.click('[aria-label="Settings sections"] button:has-text("File search")'); await p.waitForTimeout(200);
};
const starRows = () => p.$$eval('.st-row', (rs) => rs.filter((r) => r.querySelector('.st-star')).map((r) => `${r.querySelector('.st-txt span').textContent} | ${r.querySelector('output').textContent}${r.querySelector('.st-star[aria-pressed=true]') ? ' | ★' : ''}`));

await openK();
await p.fill('.pk input', 'impact'); await p.waitForTimeout(100);
const r0 = await rows();
f.want(r0.length === 4 && r0.filter((r) => r.startsWith('Impact Defense')).length === 3, `both Impact Defense files show before starring: ${r0.join(' / ')}`);
f.want(!(await p.$('.pk-row button')), 'file search has no star button of its own');
await p.keyboard.press('Escape'); await p.keyboard.press('Escape');

await openStars();
f.want(await p.isVisible('h3:has-text("Starred files")') && await p.isVisible('text=No starred files yet'), 'Settings > File search has a Starred files section, empty to start');
await p.fill('[aria-label="Find a file to star"]', 'impact def'); await p.waitForTimeout(100);
const s0 = await starRows();
f.want(s0.length === 3 && s0.some((r) => r.includes('Team Dropbox › DA')), `typing finds files to star, with their Dropbox: ${s0.join(' / ')}`);
await f.shot('settings-find');
await p.click('.st-row:has(output:text-is("Dropbox › DA")) .st-star'); await p.waitForTimeout(100);
f.want((await starRows()).some((r) => r === 'Impact Defense | Dropbox › DA | ★'), 'its star goes gold');
await p.fill('[aria-label="Find a file to star"]', ''); await p.waitForTimeout(100);
await p.fill('[aria-label="Find a file to star"]', 'impact turns'); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
await p.keyboard.press('Escape'); await p.waitForTimeout(100);
const s1 = await starRows();
f.want(s1.join(' / ') === 'Impact Defense | Dropbox › DA · hides 1 copy | ★ / Impact Turns | Team Dropbox › DA | ★', `Enter stars the top match, Esc clears the box, and the list is sorted by Dropbox: ${s1.join(' / ')}`);
await f.shot('settings-starred');
await p.click('[aria-label="Close settings"]'); await p.waitForTimeout(200);

await openK();
await p.fill('.pk input', 'impact'); await p.waitForTimeout(100);
const r1 = await rows();
f.want(r1.slice(0, 2).includes('Impact Defense | Dropbox › DA · 1 more hidden | ★') && r1[0].endsWith('★') && r1[1].endsWith('★') && r1.filter((r) => r.startsWith('Impact Defense')).length === 2 && r1.some((r) => r.includes('Old Topic')), `file search lists the starred ones first, marked, the copy hidden, the Old Topic file kept: ${r1.join(' / ')}`);
f.want(await p.$eval('.pk-row[data-star] .pk-star', (b) => getComputedStyle(b.querySelector('svg')).color) === 'rgb(226, 179, 60)', 'the star is gold');
await f.shot('search-starred');
await p.fill('.pk input', ''); await p.waitForTimeout(100);
const heads = await p.$$eval('.pk-head', (hs) => hs.map((h) => h.textContent));
f.want(heads[0] === 'Starred' && (await rows()).slice(0, 2).every((r) => r.endsWith('★')), `empty box lists them under Starred first (${heads})`);
await f.shot('empty-starred');
await p.keyboard.press('Escape');

await openStars();
await p.click('.st-row:has-text("Impact Turns") .st-star'); await p.waitForTimeout(100);
f.want((await starRows()).length === 1, 'clicking a gold star in Settings unstars it');
await p.click('[aria-label="Close settings"]');
f.want(JSON.parse(await p.evaluate(() => localStorage.getItem('falcon.starredFiles'))).join() === '/Users/a/Dropbox/DA/Impact Defense.docx', 'saved');
await f.done();
