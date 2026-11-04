// Starred and pinned files, marked in Settings > File search. The web build has no folder index, so the page gets a
// stand-in bridge with two Dropboxes that both hold an Impact Defense file. A starred file goes first in Cmd-K file
// search when it matches what you type, but isn't listed with the box empty; a pinned one is listed first with the box
// empty too. Both hide their copy in the other Dropbox (a same-named file in another folder is not a copy), the popup
// itself has no buttons, and both lists are saved.
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
const rows = () => p.$$eval('.pk-row', (rs) => rs.map((r) => { const m = r.querySelector('.pk-star')?.getAttribute('aria-label'); return `${r.querySelector('.pk-nm').textContent} | ${r.querySelector('.pk-in').textContent}${m === 'Starred' ? ' | ★' : m === 'Pinned' ? ' | pin' : ''}`; }));
const openK = async () => { await p.keyboard.press(`${MOD}+k`); await p.waitForSelector('.pk input'); await p.waitForTimeout(300); };
const openStars = async () => {
  await p.click('.fstrip [aria-label="Settings"]');
  await p.click('[aria-label="Settings sections"] button:has-text("File search")'); await p.waitForTimeout(200);
};
const starRows = () => p.$$eval('.st-row:not(.st-tree)', (rs) => rs.filter((r) => r.querySelector('.st-star')).map((r) => `${r.querySelector('.st-txt span').textContent} | ${r.querySelector('output').textContent}${r.querySelector('.st-pin[aria-pressed=true]') ? ' | pin' : ''}${r.querySelector('.st-star:not(.st-pin)[aria-pressed=true]') ? ' | ★' : ''}`));
const STAR = '.st-star:not(.st-pin)', FIND = '[aria-label="Find a file to star or pin"]';

await openK();
await p.fill('.pk input', 'impact'); await p.waitForTimeout(100);
const r0 = await rows();
f.want(r0.length === 4 && r0.filter((r) => r.startsWith('Impact Defense')).length === 3, `both Impact Defense files show before starring: ${r0.join(' / ')}`);
f.want(!(await p.$('.pk-row button')), 'file search has no star or pin button of its own');
await p.keyboard.press('Escape'); await p.keyboard.press('Escape');

await openStars();
f.want(await p.isVisible('h3:has-text("Starred and pinned files")') && await p.isVisible('text=No starred or pinned files yet'), 'Settings > File search has a Starred and pinned files section, empty to start');
await p.fill(FIND, 'impact def'); await p.waitForTimeout(100);
const s0 = await starRows();
f.want(s0.length === 3 && s0.some((r) => r.includes('Team Dropbox › DA')), `typing finds files to star, with their Dropbox: ${s0.join(' / ')}`);
await f.shot('settings-find');
await p.click(`.st-row:has(output:text-is("Dropbox › DA")) ${STAR}`); await p.waitForTimeout(100);
f.want((await starRows()).some((r) => r === 'Impact Defense | Dropbox › DA | ★'), 'its star goes gold');
f.want((await starRows()).length === 3, 'the copy it hides can still be found here, to star that one instead');
await p.fill(FIND, ''); await p.waitForTimeout(100);
await p.fill(FIND, 'impact turns'); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
await p.keyboard.press('Enter'); await p.waitForTimeout(100);
f.want((await starRows())[0]?.endsWith('| ★'), 'Enter stars the top match, and a second Enter leaves it starred');
await p.keyboard.press('Escape'); await p.waitForTimeout(100);
const s1 = await starRows();
f.want(s1.join(' / ') === 'Impact Defense | Dropbox › DA · hides 1 copy | ★ / Impact Turns | Team Dropbox › DA | ★', `Esc clears the box, and the list is sorted by Dropbox: ${s1.join(' / ')}`);
await f.shot('settings-starred');

// a search folder opens into its folders and files, to star or pin from there
const tree = () => p.$$eval('.stt-row', (rs) => rs.map((r) => r.textContent.trim()));
f.want(!(await p.$('.stt')), 'folders start closed');
await p.click('[aria-label="Open Dropbox"]'); await p.waitForTimeout(100);
const t0 = await tree();
f.want(t0.join(' / ') === 'Aff1 / DA★ 11 / Old Topic1', `opening Dropbox shows its folders, with marks inside counted: ${t0.join(' / ')}`);
await p.click('.stt-dir:has-text("Aff")'); await p.waitForTimeout(100);
await p.click(`.stt-file:has-text("Aff---1AC") ${STAR}`); await p.waitForTimeout(100);
f.want((await tree())[0] === 'Aff★ 11' && (await starRows()).some((r) => r.startsWith('Aff---1AC | Dropbox › Aff | ★')), `starring a file in the tree adds it to the list: ${(await starRows()).join(' / ')}`);
await p.click(`.stt-file:has-text("Aff---1AC") ${STAR}`); await p.waitForTimeout(100);
f.want((await starRows()).join(' / ') === s1.join(' / '), 'and its star in the tree unstars it');
await p.click('.stt-file:has-text("Aff---1AC") .st-pin'); await p.waitForTimeout(100);
const s2 = await starRows();
f.want(s2.some((r) => r === 'Aff---1AC | Dropbox › Aff | pin') && s2.length === 3, `its pin pins it: ${s2.join(' / ')}`);
await f.shot('settings-tree');
await p.click('[aria-label="Close Dropbox"]'); await p.waitForTimeout(100);
f.want(!(await p.$('.stt')), 'the chevron closes it again');
await p.click('[aria-label="Close settings"]'); await p.waitForTimeout(200);

// empty box: the pinned file shows, the starred ones don't
await openK();
const e0 = await rows();
const heads = await p.$$eval('.pk-head', (hs) => hs.map((h) => h.textContent));
f.want(heads[0] === 'Pinned' && e0[0] === 'Aff---1AC | Dropbox › Aff | pin' && !e0.some((r) => r.startsWith('Impact')), `empty box lists the pinned file first and not the starred ones (${heads}: ${e0.join(' / ')})`);
await f.shot('empty-pinned');
// a search puts the starred matches first
await p.fill('.pk input', 'impact'); await p.waitForTimeout(100);
const r1 = await rows();
f.want(r1.slice(0, 2).includes('Impact Defense | Dropbox › DA · 1 more hidden | ★') && r1[0].endsWith('★') && r1[1].endsWith('★') && r1.filter((r) => r.startsWith('Impact Defense')).length === 2 && r1.some((r) => r.includes('Old Topic')), `searching lists the starred ones first, marked, the copy hidden, the Old Topic file kept: ${r1.join(' / ')}`);
f.want(await p.$eval('.pk-row[data-star] .pk-star', (b) => getComputedStyle(b.querySelector('svg')).color) === 'rgb(226, 179, 60)', 'the star is gold');
await f.shot('search-starred');
await p.fill('.pk input', '1ac'); await p.waitForTimeout(100);
f.want((await rows())[0] === 'Aff---1AC | Dropbox › Aff | pin', `a search puts a pinned match first too (${(await rows()).join(' / ')})`);
await p.keyboard.press('Escape'); await p.keyboard.press('Escape');

await openStars();
await p.click(`.st-row:has-text("Impact Turns") ${STAR}`); await p.waitForTimeout(100);
f.want((await starRows()).length === 2, 'clicking a gold star in Settings unstars it');
await p.click('[aria-label="Close settings"]');
const saved = await p.evaluate(() => [localStorage.getItem('falcon.starredFiles'), localStorage.getItem('falcon.pinnedFiles')]);
f.want(JSON.parse(saved[0]).join() === '/Users/a/Dropbox/DA/Impact Defense.docx' && JSON.parse(saved[1]).join() === '/Users/a/Dropbox/Aff/Aff---1AC.docx', `both lists are saved (${saved.join(' ; ')})`);
await f.done();
