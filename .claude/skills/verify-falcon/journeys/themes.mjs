// Themes: pick a preset, make and edit a custom theme, see it survive a reload and Restore defaults,
// delete it, override the paper, follow the system, and save a file under a dark theme unchanged.
import fs from 'node:fs';
import { openFalcon, SEED } from '../lib/falcon.mjs';

const f = await openFalcon('themes');
const { page, want } = f;
const bg = (sel = 'body') => page.$eval(sel, (x) => getComputedStyle(x).backgroundColor);
const chrome = () => page.evaluate(() => document.documentElement.dataset.chrome);
const tile = (name) => `[aria-label="Theme"] [role=radio][aria-label="${name}"]`;
const checked = async (name) => (await page.getAttribute(tile(name), 'aria-checked')) === 'true';
const appearance = async () => {
  if (!(await page.$('.st'))) await page.click('.fstrip [aria-label="Settings"]');
  await page.click('[aria-label="Settings sections"] button:has-text("Appearance")');
  await page.waitForTimeout(150);
};
const seg = (label, text) => page.click(`.st-row:has(.st-txt > span:text-is("${label}")) .st-seg button:text-is("${text}")`);

await f.open(SEED);
const before = await f.markMap();
want(await bg() === 'rgb(15, 15, 16)' && await chrome() === 'dark', 'Dark is the default: graphite chrome');
await appearance();
const names = await page.$$eval('[aria-label="Theme"] [role=radio]', (b) => b.map((x) => x.getAttribute('aria-label')));
want(names.join() === 'System,Dark,Light,Night,Midnight,Sepia,High contrast', `presets: ${names.join(', ')}`);
want(await checked('Dark'), 'Dark is checked');

// a preset
await page.click(tile('Light'));
want(await bg() === 'rgb(244, 244, 245)' && await chrome() === 'light', 'Light: light chrome at once');
want(await page.evaluate(() => localStorage.getItem('falcon.theme')) === 'light', 'stored as falcon.theme=light');
await f.shot('light');
await page.click(tile('Sepia'));
want(await bg('.f-scroll') === 'rgb(248, 242, 229)', 'Sepia: warm paper');

// a custom theme, copied from the one that's on, edited in place
await page.click('[aria-label="New theme"]');
want(await checked('Sepia copy'), 'New theme makes "Sepia copy" and picks it');
await page.fill('input[aria-label="Background"]', '#203040');
want(await bg() === 'rgb(32, 48, 64)' && await chrome() === 'dark', 'Background color applies live, and a dark color makes dark chrome');
await page.fill('input[aria-label="Paper"]', '#fdf6e3');
want(await bg('.f-scroll') === 'rgb(253, 246, 227)', 'Paper color applies to the page');
await page.fill('input[aria-label="Theme name"]', 'Harbor');
want(await checked('Harbor'), 'renamed to Harbor');
await f.shot('custom');

await page.reload(); await page.waitForSelector('.ProseMirror'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
want(await bg() === 'rgb(32, 48, 64)', 'Harbor is still on after a reload');
await appearance();
want(await checked('Harbor'), 'and still checked');

await page.click('.st-restore');
await page.waitForTimeout(150);
want(await checked('Dark') && await bg() === 'rgb(15, 15, 16)', 'Restore defaults goes back to Dark');
want(await page.$(tile('Harbor')) !== null, 'but keeps Harbor');
await page.click(tile('Harbor'));
await page.click('.st-row:has(.st-txt > span:text-is("Delete theme")) button');
want(await page.$(tile('Harbor')) === null && await checked('Dark'), 'Delete removes Harbor and goes back to Dark');

// the paper on its own
await page.click(tile('Light'));
await seg('Document paper', 'Dark');
want(await bg('.f-scroll') === 'rgb(30, 30, 32)' && await chrome() === 'light', 'Document paper Dark: dark page in light chrome');
await seg('Document paper', 'Theme');
want(await bg('.f-scroll') === 'rgb(255, 255, 255)', 'Document paper Theme: the theme\'s white page again');

// System follows the OS, live
await page.emulateMedia({ colorScheme: 'light' });
await page.click(tile('System'));
want(await chrome() === 'light', 'System on a light OS: light chrome');
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(100);
want(await chrome() === 'dark' && await bg() === 'rgb(15, 15, 16)', 'the OS turns dark: Falcon follows without a reload');
await f.shot('system-dark');

// a theme never reaches the file
await page.click(tile('Night'));
await page.click('[aria-label="Close settings"]');
const saved = await f.save('night.docx');
await f.done();

const g = await openFalcon('themes-reopen');
await g.open(saved);
g.want((await g.markMap()) === before, 'a file saved under Night reopens with the same marks');
g.want(fs.statSync(saved).size > 0, 'saved');
await g.done();

// the old Document paper toggle carries over
const h = await openFalcon('themes-migrate', { storage: { 'falcon.pageDark': 'on' } });
h.want(await h.page.$eval('.f-scroll', (x) => getComputedStyle(x).backgroundColor) === 'rgb(30, 30, 32)', 'an old dark-paper setting still gives a dark page');
h.want(await h.page.evaluate(() => localStorage.getItem('falcon.paper') === 'dark' && localStorage.getItem('falcon.pageDark') === null), 'and becomes falcon.paper=dark');
await h.done();
