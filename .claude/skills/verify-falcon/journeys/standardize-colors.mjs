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
const CM = 'Yellow*, Bright Green, Turquoise, Pink, Blue, Sky Blue, Red, Dark Yellow, Dark Green, Teal, Violet, Dark Blue, Dark Red, Gray 25%, Gray 50%, Black';
f.want(hl.join(', ') === CM, `CardMirror's highlight colors and names, in its order, plus Sky Blue, Yellow checked (${hl.join(', ')})`);
f.want(bg.length === 18 && bg[0] === 'Yellow*' && bg.includes('Light blue') && bg.includes('Faint gray'), `every background pen color plus the bright ones, Yellow checked (${bg.length}: ${bg.join(', ')})`);
await f.shot('exceptions');
await p.click('.st-sws[aria-label="Highlighting exception"] [aria-label="Dark Blue"]');
await p.click('.st-sws[aria-label="Background color exception"] [aria-label="Light blue"]');
await p.waitForTimeout(100);
f.want((await dots('Highlighting exception')).includes('Dark Blue*') && (await dots('Background color exception')).includes('Light blue*'), 'a click checks the new color');
f.want(await p.evaluate(() => [localStorage.getItem('falcon.standardizeHighlightException'), localStorage.getItem('falcon.standardizeShadingException')].join()) === 'darkBlue,#DDEBF7', 'and saves it');
await f.shot('picked');
// the Appearance highlighter and the toolbar's picker have the same 16
await p.fill('.st-search input', 'highlighter'); await p.waitForTimeout(150);
const pens = await p.$$eval('.st-pens [role="radio"]', (b) => b.map((x) => x.getAttribute('aria-label')));
f.want(pens.join(', ') === CM.replace('*', ''), `Settings highlighter has all 16 (${pens.length})`);
await p.click('.st-pens [aria-label="Sky Blue"]'); await p.waitForTimeout(100);
await p.keyboard.press('Escape'); await p.waitForTimeout(150);
await p.locator('.ProseMirror').click();
await p.keyboard.type('Turquoise highlight, Sky Blue highlight, Blue highlight');
// paint each phrase straight through the view (finding text by position)
const paint = (t, c) => p.evaluate(([t, c]) => {
  const v = window.__falconView;
  let at = -1;
  v.state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes(t)) at = pos + n.text.indexOf(t); });
  v.dispatch(v.state.tr.addMark(at, at + t.length, v.state.schema.marks.highlight.create({ color: c })));
}, [t, c]);
await paint('Turquoise highlight', 'cyan'); await paint('Sky Blue highlight', 'skyBlue'); await paint(', Blue highlight', 'blue');
await p.waitForTimeout(150);
await f.shot('sky-blue-on-page');
const swatches = await p.evaluate(() => [...document.querySelectorAll('.f-highlight')].map((e) => `${e.dataset.color}:${getComputedStyle(e).backgroundColor}`));
f.want(swatches.includes('skyBlue:rgb(0, 176, 240)'), `sky blue draws on the page (${swatches.join(' ')})`);
await f.done();
