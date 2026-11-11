// The docked outline: rows follow the doc's headings, the 1-4 depth buttons, clicking a row jumps
// the page there, and the depth survives a reload.
import { openFalcon, SEED } from '../lib/falcon.mjs';

const f = await openFalcon('outline');
const { page, want } = f;
await f.open(SEED);
const rows = () => page.$$eval('.sb-row.ol', (r) => r.map((x) => x.className.match(/l\d/)[0] + ' ' + x.querySelector('.nm, span')?.textContent.trim()));
const names = () => page.$$eval('.sb-row.ol', (r) => r.map((x) => x.querySelector('.nm').textContent.trim())); // the heading, not its cite or card count
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

// rest on a tag: its card shows beside the pane, follows the pointer down the tags, and never takes a click
const row = async (text) => { const b = await page.locator(`.sb-row.ol:has-text("${text}")`).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const pv = () => page.evaluate(() => { const e = document.querySelector('.ol-pv.cl-on'); if (!e) return null; const r = e.getBoundingClientRect(); return { text: e.textContent, top: r.top, left: r.left, pe: getComputedStyle(e).pointerEvents, pane: document.querySelector('.olp').getBoundingClientRect().right }; });
let at = await row('Growth is slowing');
await page.mouse.move(at.x - 20, at.y); await page.mouse.move(at.x, at.y);
await page.waitForTimeout(120);
want(!(await pv()), 'passing over a tag shows nothing yet');
await page.waitForTimeout(500);
const one = await pv();
want(!!one && one.text.includes('Growth is slowing') && one.text.includes('Smith'), `resting on a tag shows its card (${one?.text.slice(0, 80)})`);
want(!!one && one.left >= one.pane && one.pe === 'none', `it sits beside the pane and takes no pointer (left ${one?.left}, pane ${one?.pane}, ${one?.pe})`);
want(await page.locator('.sb-row.ol:has-text("Growth is slowing") .cite').isVisible(), 'the cite still shows in the row');
await f.shot('preview');
at = await row('Warming is real');
await page.mouse.move(at.x, at.y, { steps: 8 });
await page.waitForTimeout(600);
const two = await pv();
want(!!two && two.text.includes('Warming is real') && !two.text.includes('Growth is slowing'), `moving to another tag swaps the card at once (${two?.text.slice(0, 80)})`);
want(!!two && two.top > one.top + 10, `and the box followed the pointer down (${one?.top} → ${two?.top})`);
await f.shot('preview-followed');
await page.mouse.click(at.x, at.y);
await page.waitForTimeout(600);
want(!(await pv()), 'a click closes it');
want(await page.evaluate(() => window.__falconView.state.selection.$head.parent.textContent) === 'Warming is real', 'and still goes to the card: the preview took no click');
await page.mouse.move(at.x + 3, at.y + 1); // a hand never holds still after a click
await page.waitForTimeout(600);
want(!(await pv()), 'and it stays closed on the clicked row, so it does not cover the card the page went to');
let back = await row('Growth is slowing');
await page.mouse.move(back.x, back.y, { steps: 4 });
await page.waitForTimeout(600);
want((await pv())?.text.includes('Growth is slowing'), 'another row shows its card again');
// Card links set to Page slice: the preview is a piece of the page
await page.click('.fstrip [aria-label="Settings"]');
await page.click('[aria-label="Settings sections"] button:has-text("Editor")');
await page.locator('[role="group"][aria-label="Card links"]').getByRole('button', { name: 'Page slice' }).click();
await page.click('[aria-label="Close settings"]');
await page.waitForTimeout(300);
await page.mouse.move(back.x - 20, back.y); await page.mouse.move(back.x, back.y);
await page.waitForTimeout(600);
want(await page.locator('.ol-pv.cl-on.cl-page').count() === 1, 'with Card links on Page slice it is a piece of the page');
await f.shot('preview-page-slice');
// a block is not a card
at = await row('Economy Block');
await page.mouse.move(at.x - 20, at.y); await page.mouse.move(at.x, at.y);
await page.waitForTimeout(600);
want(!(await pv()), 'a block row shows no preview');
// Settings turns it off
await page.click('.fstrip [aria-label="Settings"]');
await page.click('[aria-label="Settings sections"] button:has-text("Editor")');
const sw = page.locator('[aria-label="Card preview in the outline"]');
await sw.scrollIntoViewIfNeeded();
await f.shot('preview-setting');
await sw.click();
want(await page.evaluate(() => localStorage.getItem('falcon.outlinePreview')) === 'off', `Settings stores it off (${await page.evaluate(() => localStorage.getItem('falcon.outlinePreview'))})`);
await page.click('[aria-label="Close settings"]');
await page.waitForTimeout(300);
at = await row('Growth is slowing');
await page.mouse.move(at.x - 20, at.y); await page.mouse.move(at.x, at.y);
await page.waitForTimeout(600);
want(!(await pv()), 'off: resting on a tag shows nothing');

await page.reload(); await page.waitForSelector('.ProseMirror');
want(await page.evaluate(() => localStorage.getItem('falcon.depth')) === '4', 'depth is stored as falcon.depth=4');
want(await page.$eval('[aria-label="Show down to tags"]', (b) => b.hasAttribute('data-on')), 'depth 4 is still selected after a reload');
await f.done();
