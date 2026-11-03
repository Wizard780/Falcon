// Ctrl-Tab: a quick tap flips to the last doc; held, the switcher shows page previews, most recent first,
// Tab walks it and letting go of Ctrl opens the lit doc.
import { openFalcon, SEED, MOD } from '../lib/falcon.mjs';

const f = await openFalcon('recent-docs');
const { page } = f;
const active = () => page.$eval('.doc-row[data-on] .doc-nm', (e) => e.getAttribute('aria-label'));
await f.open(SEED);
for (const t of ['Second doc: a short analytic', 'Third doc']) {
  await page.keyboard.press(`${MOD}+n`);
  await page.waitForTimeout(200);
  await page.keyboard.type(t);
}
const third = await active();
await page.keyboard.press(`${MOD}+n`); // fourth, blank: Untitled
await page.waitForTimeout(200);
await page.keyboard.type('Fourth');
const fourth = await active();

await page.keyboard.press('Control+Tab');
await page.waitForTimeout(300);
f.want(!(await page.$('.sw')), 'a quick tap draws no switcher');
f.want(await active() === third, `a quick tap opens the last doc (${await active()})`);
await page.keyboard.press('Control+Tab');
await page.waitForTimeout(300);
f.want(await active() === fourth, 'a second tap flips back');

await page.keyboard.down('Control');
await page.keyboard.press('Tab');
await page.waitForTimeout(350);
f.want(await page.locator('.sw-it').count() === 4, 'held: the switcher shows all four docs');
f.want(await page.$eval('.sw-it[data-on] .sw-nm span', (e) => e.textContent) === third, 'the last doc is lit first');
const peeks = await page.$$eval('.sw-doc', (ds) => ds.map((d) => d.textContent));
f.want(peeks[0].includes('Fourth') && peeks[1].includes('Third doc'), 'previews show each doc’s own page');
await f.shot('switcher-held');
await page.keyboard.press('Tab');
await page.waitForTimeout(100);
f.want(await page.$eval('.sw-it[data-on] .sw-doc', (e) => e.textContent.includes('Second doc')), 'Tab walks the most recent order (3rd, then 2nd)');
await f.shot('switcher-walked');
f.want(await active() === fourth, 'nothing switches while Ctrl is held');
await page.keyboard.up('Control');
await page.waitForTimeout(300);
f.want(!(await page.$('.sw')), 'letting go closes the switcher');
f.want(await page.evaluate(() => window.__falconView.state.doc.textContent.includes('Second doc')), 'letting go opens the lit doc');
f.want(await page.evaluate(() => document.activeElement?.closest('.ProseMirror') !== null), 'focus is in the editor');

await page.keyboard.down('Control');
await page.keyboard.press('Shift+Tab');
await page.waitForTimeout(350);
await f.shot('switcher-backward');
await page.keyboard.press('Escape');
await page.keyboard.up('Control');
await page.waitForTimeout(200);
f.want(!(await page.$('.sw')) && await page.evaluate(() => window.__falconView.state.doc.textContent.includes('Second doc')), 'Esc keeps the current doc');

await page.keyboard.down('Control');
await page.keyboard.press('Tab');
await page.waitForTimeout(350);
await page.locator('.sw-it').nth(3).click();
await page.keyboard.up('Control');
await page.waitForTimeout(300);
f.want(!(await page.$('.sw')), 'a click closes the switcher');
f.want(await active() === 'seed', 'and opens the clicked doc');
await f.done();
