// Compare Text: select a card body, put the source's version on the clipboard, run Compare Text from the
// command center. Red marks text only in the selection, green shows clipboard-only text; nothing in the
// document changes, and Esc clears the marks.
import { openFalcon, SEED, MOD } from '../lib/falcon.mjs';
const f = await openFalcon('compare-text');
const p = f.page;
await f.open(SEED);
await p.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: process.env.FALCON_URL });

const before = await f.markMap();
// the source as copied from the article: a sentence before and after, and two words that differ
await p.evaluate(() => navigator.clipboard.writeText('Economists agree.\nGlobal growth will drop to two percent next  year.\nThat is bad.'));
await f.select('Global growth will fall to two percent next year.');
await p.keyboard.press(`${MOD}+Shift+Space`);
await p.waitForSelector('.cc input');
await p.fill('.cc input', 'compare text');
await p.waitForTimeout(120);
const first = await p.$eval('.cc-row[data-on] .cc-nm', (x) => x.textContent).catch(() => null);
f.want(first === 'Compare Text', `"compare text" finds Compare Text (got ${first})`);
await f.shot('command-center');
await p.keyboard.press('Enter');
await p.waitForSelector('.f-cmp-del', { timeout: 3000 }).catch(() => {});

const del = await p.$$eval('.ProseMirror .f-cmp-del', (r) => r.map((x) => x.textContent));
const ins = await p.$$eval('.ProseMirror .f-cmp-ins', (r) => r.map((x) => x.textContent));
f.want(JSON.stringify(del) === '["fall"]', `"fall" is struck in red (got ${JSON.stringify(del)})`);
f.want(JSON.stringify(ins) === '["drop"]', `"drop" shows in green (got ${JSON.stringify(ins)})`);
const toast = await p.$eval('.toast', (x) => x.textContent);
f.want(toast.startsWith('1 difference: red') && toast.includes('also has text before and after'), `toast: ${toast}`);
f.want(await f.markMap() === before, 'the document is unchanged');
await f.shot('marked');

await p.keyboard.press('Escape');
await p.waitForTimeout(100);
f.want(!(await p.$('.f-cmp-del')) && !(await p.$('.f-cmp-ins')), 'Esc clears the marks');

// identical text says so
await p.evaluate(() => navigator.clipboard.writeText('Temperatures rose again.'));
await f.select('Temperatures rose again.');
await p.keyboard.press(`${MOD}+Shift+Space`);
await p.waitForSelector('.cc input');
await p.fill('.cc input', 'compare text');
await p.waitForTimeout(120);
await p.keyboard.press('Enter');
await p.waitForTimeout(300);
const t2 = await p.$eval('.toast', (x) => x.textContent);
f.want(t2 === 'Identical to the clipboard', `same text: ${t2}`);
await f.shot('identical');
await f.done();
