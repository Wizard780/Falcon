// Settings: pick a highlighter pen, see it stored, see F11 use it, and see it survive a reload.
import { openFalcon, SEED } from '../lib/falcon.mjs';

const f = await openFalcon('settings');
const { page, want } = f;
await f.open(SEED);
await page.click('.fstrip [aria-label="Settings"]');
await page.waitForTimeout(300);
const panes = await page.$$eval('[aria-label="Settings sections"] button', (b) => b.map((x) => x.textContent.trim()));
want(JSON.stringify(panes) === JSON.stringify(['General', 'Appearance', 'Editor', 'Formatting', 'Keybindings', 'Speech and timers']), `six panes: ${panes.join(', ')}`);
await page.click('[aria-label="Settings sections"] button:has-text("Appearance")');
await page.click('[aria-label="Highlighter"] [role=radio][aria-label="Green"]');
await page.waitForTimeout(200);
want(await page.getAttribute('[aria-label="Highlighter"] [aria-label="Green"]', 'aria-checked') === 'true', 'Green is checked');
want(await page.evaluate(() => localStorage.getItem('falcon.highlight')) === 'green', 'stored as falcon.highlight=green');
await f.shot('green-picked');
await page.click('[aria-label="Close settings"]');
await page.waitForTimeout(200);

await f.select('Temperatures'); await page.keyboard.press('F11');
want((await f.markMap()).includes('[Temperatures]{highlight:green}'), 'F11 now highlights in green');
await f.shot('green-highlight');

await page.reload(); await page.waitForSelector('.ProseMirror'); await page.keyboard.press('Escape');
await page.click('.fstrip [aria-label="Settings"]');
await page.click('[aria-label="Settings sections"] button:has-text("Appearance")');
want(await page.getAttribute('[aria-label="Highlighter"] [aria-label="Green"]', 'aria-checked') === 'true', 'Green is still checked after a reload');
await f.done();
