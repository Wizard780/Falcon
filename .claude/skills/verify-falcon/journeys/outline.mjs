// The docked outline: rows follow the doc's headings, the 1-4 depth buttons, clicking a row jumps
// the page there, and the depth survives a reload.
import { openFalcon, SEED } from '../lib/falcon.mjs';

const f = await openFalcon('outline');
const { page, want } = f;
await f.open(SEED);
const rows = () => page.$$eval('.sb-row.ol', (r) => r.map((x) => x.className.match(/l\d/)[0] + ' ' + x.querySelector('.nm, span')?.textContent.trim()));
const names = () => page.$$eval('.sb-row.ol', (r) => r.map((x) => x.textContent.replace(/\d+$/, '').trim()));
want(JSON.stringify(await names()) === JSON.stringify(['Seed Pocket', 'Seed Hat', 'Economy Block', 'Warming Block']), `default depth 3 lists pocket, hat, blocks: ${JSON.stringify(await names())}`);
await f.shot('depth-3');
await page.click('[aria-label="Show down to tags"]');
await page.waitForTimeout(300);
const four = await names();
want(four.includes('Growth is slowing') && four.includes('Warming is real') && four.length === 6, `depth 4 adds the tags: ${JSON.stringify(four)}`);
await page.click('[aria-label="Show pockets"]');
await page.waitForTimeout(300);
want(JSON.stringify(await names()) === '["Seed Pocket"]', 'depth 1 shows only the pocket');
await page.click('[aria-label="Show down to tags"]');
await page.waitForTimeout(300);

await page.click('.sb-row.ol:has-text("Warming is real")');
await page.waitForTimeout(700);
const lit = await page.$eval('.sb-row.ol[data-on]', (r) => r.textContent.replace(/\d+$/, '').trim()).catch(() => null);
want(lit === 'Warming is real', `clicked row is lit (${lit})`);
const caretIn = await page.evaluate(() => window.__falconView.state.selection.$head.parent.textContent);
want(caretIn === 'Warming is real', `the caret moved to that heading (${caretIn})`);
await f.shot('jumped');

await page.reload(); await page.waitForSelector('.ProseMirror');
want(await page.evaluate(() => localStorage.getItem('falcon.depth')) === '4', 'depth is stored as falcon.depth=4');
want(await page.$eval('[aria-label="Show down to tags"]', (b) => b.hasAttribute('data-on')), 'depth 4 is still selected after a reload');
await f.done();
