// Drives the chrome in a headless browser: the rail, several open documents, the outline chevron past
// the depth, the font size box and Settings. Usage: vite preview on :5190, then
//   node scripts/ui-check.mjs <a.docx> <b.docx> [shots dir]
import { chromium } from 'playwright';

const [a, b, shots = '/tmp/fui'] = process.argv.slice(2);
const base = (f) => f.split('/').pop().replace(/\.docx$/i, '');
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5190/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.ProseMirror');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

const results = [];
const want = (ok, what) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const rows = () => page.$$eval('.doc-row', (r) => r.map((x) => (x.hasAttribute('data-on') ? '*' : '') + x.textContent.trim()));
const open = async (file) => {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.fstrip [aria-label="Open…"]')]);
  await fc.setFiles(file);
  await page.waitForFunction((n) => document.querySelectorAll('.doc-row').length >= n, 1);
  await page.waitForTimeout(400);
};

want(await page.$$eval('.fstrip button', (bs) => bs.map((x) => x.getAttribute('aria-label')).join(',')) === 'Home,New document,Open…,Save,Save As…,Find,Outline,Read mode,Settings', 'rail has Home, New, Open, Save, Save As, Find, Outline, Read, Settings');
await page.screenshot({ path: `${shots}/1-empty.png` });

await open(a);
let r = await rows();
want(r.length === 1 && r[0] === `*${base(a)}`, `opening into a blank Untitled replaces it: ${JSON.stringify(r)}`);
// edit the first doc so it's dirty and has undo history
await page.evaluate(() => { const v = window.__falconView; v.dispatch(v.state.tr.insertText('ZQZ', 1)); });
await open(b);
r = await rows();
want(r.length === 2 && r[1] === `*${base(b)}`, `second Open adds a document: ${JSON.stringify(r)}`);
await page.screenshot({ path: `${shots}/2-two-docs.png` });

await page.click('.doc-row:nth-child(1) .doc-nm');
await page.waitForTimeout(200);
r = await rows();
const text = await page.evaluate(() => window.__falconView.state.doc.textContent.slice(0, 3));
want(r[0].startsWith('*') && text === 'ZQZ', `clicking a file switches back with its edits (${text})`);
want(await page.$eval('.doc-row:nth-child(1) .dot', () => true).catch(() => false), 'edited file shows the unsaved dot');
await page.click('.ProseMirror');
await page.keyboard.press(`${mod}+z`);
want(await page.evaluate(() => !window.__falconView.state.doc.textContent.startsWith('ZQZ')), 'undo history survives switching');
await page.keyboard.press('Control+Tab');
await page.waitForTimeout(150);
want((await rows())[1].startsWith('*'), 'Ctrl-Tab goes to the next document');

// outline: at depth 3, a block's chevron shows its tags (in the first file, which has blocks with tags)
await page.click('.doc-row:nth-child(1) .doc-nm');
await page.click('.lv [data-lv="3"]');
await page.waitForTimeout(150);
const before = await page.$$eval('.sb-row.ol.l4', (x) => x.length);
const block = await page.$('.sb-row.ol.l3[aria-expanded="false"]');
const label = await block.$eval('.nm', (x) => x.textContent);
await (await block.$('[data-tw]')).click();
await page.waitForTimeout(250);
const after = await page.$$eval('.sb-row.ol.l4', (x) => x.length);
want(before === 0 && after > 0, `depth 3: chevron on "${label}" shows its tags (${before} -> ${after})`);
await page.screenshot({ path: `${shots}/3-chevron.png` });
await (await page.$(`.sb-row.ol.l3[aria-expanded="true"] [data-tw]`)).click();
await page.waitForTimeout(150);
want(await page.$$eval('.sb-row.ol.l4', (x) => x.length) === 0, 'chevron again hides them');

// font size: the box reads the selection's size, and the list sets it
await page.evaluate(() => {
  const v = window.__falconView; const S = v.state.selection.constructor;
  let at = -1; v.state.doc.forEach((n, p) => { if (at < 0 && n.attrs.style === 'tag' && n.textContent.length > 5) at = p; });
  v.dispatch(v.state.tr.setSelection(S.create(v.state.doc, at + 1, at + 5))); v.focus();
});
await page.waitForTimeout(100);
const sz0 = await page.$eval('.b.fsz', (x) => x.textContent.trim());
await page.click('.b.fsz');
await page.waitForSelector('.pop.sizes.in');
await page.screenshot({ path: `${shots}/4-sizes.png` });
await page.click('.pop .szi:text-is("18")');
await page.waitForTimeout(100);
const sz1 = await page.$eval('.b.fsz', (x) => x.textContent.trim());
want(sz0 === '13' && sz1 === '18', `font size box shows 13 on a tag, then 18 after picking it (${sz0} -> ${sz1})`);

// settings
await page.click('.fstrip [aria-label="Settings"]');
await page.waitForSelector('.st');
await page.click('.st-step [aria-label="More time"]');
want(await page.$eval('.b.timer', (x) => x.textContent) === '9:00', 'speech timer length follows Settings');
await page.screenshot({ path: `${shots}/5-settings.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
want(!(await page.$('.st')), 'Esc closes Settings');

// outline hide and back from the rail
await page.click('.fstrip [aria-label="Outline"]');
await page.waitForTimeout(300);
const hidden = await page.$eval('.app', (x) => x.classList.contains('no-outline'));
await page.click('.fstrip [aria-label="Outline"]');
await page.waitForTimeout(300);
want(hidden && !(await page.$eval('.app', (x) => x.classList.contains('no-outline'))), 'rail Outline button hides and brings back the outline');

// new, then close
await page.click('.fstrip [aria-label="New document"]');
await page.waitForTimeout(150);
want((await rows()).length === 3, 'New adds a third document');
await page.keyboard.press(`${mod}+w`);
await page.waitForTimeout(150);
want((await rows()).length === 2, `${mod}+W closes the blank one`);
page.once('dialog', (d) => d.accept());
await page.click('.doc-row:nth-child(1) .doc-x'); // the edited one asks first
await page.waitForTimeout(150);
r = await rows();
want(r.length === 1 && r[0] === `*${base(b)}`, `closing the edited file asks, then leaves the other: ${JSON.stringify(r)}`);
await page.screenshot({ path: `${shots}/6-after-close.png` });

want(!errors.length, `no page errors ${errors.join(' | ')}`);
console.log(results.join('\n'));
await browser.close();
process.exit(results.some((x) => x.startsWith('FAIL')) ? 1 : 0);
