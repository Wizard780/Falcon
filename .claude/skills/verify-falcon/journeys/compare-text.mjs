// Compare Text: the panel, as in the debate-uploader plugin. The selection becomes Text 1, Text 2 is pasted or
// taken with Use selection, Compare (Mod-Enter) marks the differences side by side, ↑↓ step through them.
import { openFalcon, SEED, MOD } from '../lib/falcon.mjs';
const f = await openFalcon('compare-text');
const p = f.page;
await f.open(SEED);
const before = await f.markMap();

const runCompareText = async () => {
  await p.keyboard.press(`${MOD}+Shift+Space`);
  await p.waitForSelector('.cc input');
  await p.fill('.cc input', 'compare text');
  await p.waitForTimeout(120);
  const first = await p.$eval('.cc-row[data-on] .cc-nm', (x) => x.textContent).catch(() => null);
  f.want(first === 'Compare Text', `"compare text" finds Compare Text (got ${first})`);
  await p.keyboard.press('Enter');
  await p.waitForSelector('.cf.cmp', { timeout: 2000 }).catch(() => {});
};
const marks = (side) => p.$$eval(`.cmp-out .cmp-k2.cmp-${side}`, (r) => r.map((x) => x.textContent));
const note = () => p.$eval('.cmp-note', (x) => x.textContent);

// 1. the selection becomes Text 1
await f.select('Global growth will fall to two percent next year.');
await runCompareText();
f.want(!!(await p.$('.cf.cmp')), 'the Compare Text panel opens');
f.want(await p.inputValue('textarea[aria-label="Text 1"]') === 'Global growth will fall to two percent next year.', 'the selection is Text 1');
const focused = await p.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Text 2', null, { timeout: 1000 }).then(() => true, () => false);
f.want(focused, `focus waits in Text 2 (it's on ${await p.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.className)})`);
await f.shot('opened');

// 2. paste Text 2, Mod-Enter compares
await p.fill('textarea[aria-label="Text 2"]', 'Global growth will drop to two percent next  year.');
await p.keyboard.press(`${MOD}+Enter`);
await p.waitForSelector('.cmp-out');
f.want(JSON.stringify(await marks('a')) === '["fall"," "]', `Text 1 marks "fall" and the single space (got ${JSON.stringify(await marks('a'))})`);
f.want(JSON.stringify(await marks('b')) === '["drop","  "]', `Text 2 marks "drop" and the double space (got ${JSON.stringify(await marks('b'))})`);
f.want((await note()) === '2 differences · 1 word only in Text 1 · 1 word only in Text 2', `summary: ${await note()}`);
f.want(await p.$eval('.cmp-nav', (x) => x.textContent.includes('1 of 2')), 'the first difference is current');
await f.shot('compared');

// 3. ↓ steps to the next difference
await p.keyboard.press('ArrowDown');
await p.waitForTimeout(80);
f.want(await p.$eval('.cmp-nav', (x) => x.textContent.includes('2 of 2')), '↓ moves to 2 of 2');
f.want(await p.$$eval('.cmp-out .cmp-cur', (r) => r.map((x) => x.textContent).join('|')) === ' |  ', 'the current difference is underlined on both sides');

// 4. Ignore spacing re-runs in place
await p.click('button:has-text("Ignore spacing")');
await p.waitForTimeout(80);
f.want((await note()) === '1 difference · 1 word only in Text 1 · 1 word only in Text 2', `Ignore spacing leaves one difference: ${await note()}`);
f.want(JSON.parse(await p.evaluate(() => localStorage.getItem('falcon.compareOpts'))).ignoreSpace === true, 'the option is kept');

// 5. Characters mode marks just the letters that differ
await p.click('button:has-text("Characters")');
await p.click('.cmp-main'); // Edit
f.want(!!(await p.$('textarea[aria-label="Text 1"]')), 'Edit goes back to the texts');
await p.fill('textarea[aria-label="Text 2"]', 'Global growth will fal to two percent next year.');
await p.click('.cmp-main'); // Compare
await p.waitForSelector('.cmp-out');
// (with Ignore spacing on, a space rides along with the character before it, as in the plugin)
f.want(JSON.stringify(await marks('a')) === '["l "]', `Characters mode marks only the extra "l" (got ${JSON.stringify(await marks('a'))})`);
await f.shot('characters');

// 6. Swap
await p.click('button:has-text("Swap")');
await p.waitForTimeout(80);
f.want(JSON.stringify(await marks('b')) === '["l "]' && !(await marks('a')).length, 'Swap flips the sides');

// 7. Use selection: the panel steps aside, you select in the document, the bar takes it
await p.click('.cmp-main'); // Edit
await p.click('.cmp-col:nth-child(2) button:has-text("Use selection")');
await p.waitForSelector('.cmp-pick');
f.want(!(await p.$('.cf.cmp')), 'the panel steps aside for the selection bar');
await f.select('Temperatures rose again.');
await f.shot('picking');
await p.click('.cmp-pick .cmp-main');
await p.waitForSelector('.cmp-out');
const right = await p.$$eval('.cmp-out', (r) => r[1].textContent);
f.want(right === 'Temperatures rose again.', `Use selection fills Text 2 and compares (got ${right})`);

// 8. Esc closes; the document is untouched; the texts are kept for next time
await p.keyboard.press('Escape');
await p.waitForTimeout(120);
f.want(!(await p.$('.cf.cmp')), 'Esc closes the panel');
f.want(await f.markMap() === before, 'the document is unchanged');
await p.keyboard.press('ArrowRight'); // collapse the selection
await runCompareText();
f.want(await p.inputValue('textarea[aria-label="Text 2"]') === 'Temperatures rose again.', 'with no selection, both texts come back as they were');
await f.shot('reopened');
await f.done();
