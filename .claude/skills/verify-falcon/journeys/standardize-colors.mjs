// Standardize exceptions in Settings: every highlighter color and every background pen color shows as a dot,
// picking one checks it and saves it, and the command's name follows.
import { openFalcon } from '../lib/falcon.mjs';
const f = await openFalcon('standardize-colors', { viewport: { width: 1440, height: 900 } });
const p = f.page;
await p.waitForSelector('.ProseMirror'); await p.keyboard.press('Escape');
await p.click('.fstrip [aria-label="Settings"]');
await p.fill('.st-search input', 'exception'); await p.waitForTimeout(150);
const dots = (g) => p.$$eval(`.st-sws[aria-label="${g}"] .st-sw`, (b) => b.map((x) => `${x.getAttribute('aria-label')}${x.getAttribute('aria-checked') === 'true' ? '*' : ''}`));
const hl = await dots('Highlighting exception'), bg = await dots('Background color exception');
f.want(hl.length === 15 && hl[0] === 'Yellow*' && hl.includes('Dark blue') && hl.includes('Black'), `all 15 highlight colors, Yellow checked (${hl.join(', ')})`);
f.want(bg.length === 18 && bg[0] === 'Yellow*' && bg.includes('Light blue') && bg.includes('Faint gray'), `every background pen color plus the bright ones, Yellow checked (${bg.length}: ${bg.join(', ')})`);
await f.shot('exceptions');
await p.click('.st-sws[aria-label="Highlighting exception"] [aria-label="Dark blue"]');
await p.click('.st-sws[aria-label="Background color exception"] [aria-label="Light blue"]');
await p.waitForTimeout(100);
f.want((await dots('Highlighting exception')).includes('Dark blue*') && (await dots('Background color exception')).includes('Light blue*'), 'a click checks the new color');
f.want(await p.evaluate(() => [localStorage.getItem('falcon.standardizeHighlightException'), localStorage.getItem('falcon.standardizeShadingException')].join()) === 'darkBlue,#DDEBF7', 'and saves it');
await f.shot('picked');
// the toolbar background picker names its colors now too
await p.keyboard.press('Escape'); await p.waitForTimeout(100);
await f.done();
