// Home's recent files sit under Today, Last 7 days and Earlier, by the local day each was last opened;
// anything opened more than 30 days ago leaves the list and storage. Opening a file moves it to the top of Today.
import path from 'node:path';
import { openFalcon, SEED } from '../lib/falcon.mjs';

const mid = new Date(); mid.setHours(0, 0, 0, 0);
const at = (daysBack, h = 12, m = 0) => new Date(mid.getFullYear(), mid.getMonth(), mid.getDate() - daysBack, h, m).getTime();
const seedName = path.basename(SEED, '.docx');
const r = (name, when, folder, cards) => ({ name, path: `/Users/me/Debate/${folder}/${name}.docx`, folder, cards, blocks: [], when });
const recents = [
  r('NATO AT Neg', Date.now() - 60_000, 'NATO', 212),
  r('NATO Aff', at(0, 0, 5), 'NATO', 64),
  r('AT K Cap', at(1, 23, 59), 'Blocks', 41), // 23:59 yesterday: not today
  { name: seedName, folder: '', cards: 3, blocks: [], when: at(3) }, // a web-build file (no path), reopened below
  r('Umbrella DA', at(6, 9), 'NATO', 18),
  r('Deep Strike', at(12), 'NATO', 22),
  r('Septober Neg', at(30, 8), 'Sept-Oct', 140), // exactly 30 days back: kept
  r('Space Col Aff', at(31, 23), 'LD', 33), // 31 days back: dropped
];

const f = await openFalcon('recents-by-day', { storage: { 'falcon.recents.v1': JSON.stringify(recents), 'falcon.recentCount': '20' } });
const { page } = f;
const sections = () => page.$$eval('.hm-grp', (gs) => gs.map((g) => `${g.getAttribute('aria-label')}: ${[...g.querySelectorAll('.hm-row .nm')].map((n) => n.textContent).join(', ')}`));
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('falcon.recents.v1') ?? '[]').map((x) => x.name));
const home = async () => { await page.click('.fstrip [aria-label="Home"]'); await page.waitForSelector('.home.open .hm-row'); await page.waitForTimeout(500); };

await home();
await f.shot('home-sections');
const before = await sections();
f.want(JSON.stringify(before) === JSON.stringify([
  'Today: NATO AT Neg, NATO Aff',
  `Last 7 days: AT K Cap, ${seedName}, Umbrella DA`,
  'Earlier: Deep Strike, Septober Neg',
]), `three sections in order (${before.join(' | ')})`);
f.want(!(await stored()).includes('Space Col Aff'), 'the entry past 30 days is gone from storage');
f.want((await stored()).includes('Septober Neg'), 'the entry exactly 30 days back is kept');
const lab = await page.$eval('.hm-sec', (e) => { const s = getComputedStyle(e); return `${s.fontSize} ${s.fontFamily.split(',')[0]}`; });
f.want(/^11px/.test(lab), `section labels are small (${lab})`);

// real arrow keys: two steps down from the top cross from Today into Last 7 days
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(200);
const lit = await page.$eval('.hm-row[data-on] .nm', (e) => e.textContent);
f.want(lit === 'AT K Cap', `↓↓ lights the first of Last 7 days (${lit})`);
f.want(await page.$eval('.hm-cap b', (e) => e.textContent) === 'AT K Cap', 'the page beside the list follows');
await f.shot('arrow-across-sections');

// reopening a file moves it to the top of Today
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await f.open(SEED);
await home();
const after = await sections();
f.want(after[0] === `Today: ${seedName}, NATO AT Neg, NATO Aff`, `the reopened file tops Today (${after[0]})`);
f.want(!after.some((s) => s.startsWith('Last 7 days') && s.includes(seedName)), 'and has left Last 7 days');
await f.shot('reopened-to-today');

// with nothing in the last month, the empty state is unchanged
await page.evaluate((list) => localStorage.setItem('falcon.recents.v1', JSON.stringify(list)), [r('Old', at(40), 'x', 1)]);
await page.reload();
await page.waitForSelector('.home.open');
await page.waitForTimeout(500);
f.want(await page.$$eval('.hm-sec', (e) => e.length) === 0, 'no section labels with no recents');
f.want((await page.$eval('.hm-none', (e) => e.textContent)).includes('No recent files yet'), 'the empty state shows');
await f.shot('empty');

await f.done();
