// Find from the tool row: the match is counted and selected; Replace all swaps every match in one
// undo step.
import { openFalcon, SEED, MOD } from '../lib/falcon.mjs';

const f = await openFalcon('find-replace');
const { page, want } = f;
await f.open(SEED);
await page.click('.tools [aria-label="Find"]');
want(await page.locator('.findbar').isVisible(), 'the Find button opens the find bar');
await page.fill('.findbar input[placeholder="Find"]', 'needle');
await page.waitForTimeout(300);
want((await page.textContent('.findbar .count')).trim() === '1/1', `counter reads 1/1 (${await page.textContent('.findbar .count')})`);
want(await page.evaluate(() => { const v = window.__falconView, s = v.state.selection; return v.state.doc.textBetween(s.from, s.to); }) === 'needle', 'the match is selected in the page');
await page.fill('.findbar input[placeholder="Find"]', 'Block');
await page.waitForTimeout(300);
want((await page.textContent('.findbar .count')).trim().endsWith('/2'), `"Block" counts two matches (${await page.textContent('.findbar .count')})`);
await f.shot('found');

await page.click('.findbar button[title^="Replace (⌘⇧H)"], .findbar button[title^="Replace (Ctrl+H)"]');
await page.fill('.findbar .fb-with', 'Section');
await page.click('.findbar button[title^="Replace all"]');
await page.waitForTimeout(300);
const map = await f.markMap();
want(map.includes('block: Economy Section') && map.includes('block: Warming Section') && !map.includes('Block'), 'Replace all changed both blocks');
await f.shot('replaced');
await page.keyboard.press('Escape');
await page.click('.ProseMirror');
await page.keyboard.press(`${MOD}+z`);
await page.waitForTimeout(200);
const undone = await f.markMap();
want(undone.includes('Economy Block') && undone.includes('Warming Block'), 'one undo restores both');
await f.done();
