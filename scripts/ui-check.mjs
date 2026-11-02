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
const rows = () => page.$$eval('.doc-row', (r) => r.map((x) => (x.hasAttribute('data-on') ? '*' : '') + x.querySelector('.doc-nm').getAttribute('aria-label')));
const open = async (file) => {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.tools [aria-label="Open…"]')]);
  await fc.setFiles(file);
  await page.waitForFunction((n) => document.querySelectorAll('.doc-row').length >= n, 1);
  await page.waitForTimeout(400);
};

want(await page.$$eval('.tools button', (bs) => bs.map((x) => x.getAttribute('aria-label')).join(',')) === 'New document,Open…,Save,Save As…,Find,Outline,Read mode', 'tool row has New, Open, Save, Save As, Find, Outline, Read');
want(await page.$$eval('.fstrip > button', (bs) => bs.map((x) => x.getAttribute('aria-label')).join(',')) === 'Home,Settings', 'rail has Home, the open files, Settings');
{ const t = await page.$eval('.tools', (x) => { const r = x.getBoundingClientRect(), o = document.querySelector('.olp').getBoundingClientRect(); return r.bottom <= o.top && r.left >= o.left - 1 && r.right <= o.right + 1; });
  want(t, 'tool row sits above the outline pane'); }
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
// the files panel opened by hovering the rail closes once the pointer leaves it
await page.mouse.move(900, 600, { steps: 5 }); await page.waitForTimeout(400);
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
await page.screenshot({ path: `${shots}/5-settings.png` });
want(await page.$$eval('.st-navb', (x) => x.map((b) => b.textContent).join(',')) === 'Appearance,Editor,Keybindings,Speech and timers', 'Settings lists Appearance, Editor, Keybindings, Speech and timers');
await page.click('.st-navb:has-text("Speech and timers")');
await page.selectOption('select[aria-label="Speech length"]', '9');
want(await page.$eval('.b.timer', (x) => x.textContent) === '9:00', 'speech timer length follows Settings');
await page.click('.st-navb:has-text("Editor")');
await page.click('.st [aria-label="Show outline pane"]');
want(await page.$eval('.app', (x) => x.classList.contains('no-outline')), 'Settings switch hides the outline');
await page.click('.st-seg button:has-text("2")');
want(await page.$eval('.lv [data-lv="2"]', (x) => x.hasAttribute('data-on')), 'Settings depth sets the outline depth');
await page.screenshot({ path: `${shots}/5b-settings-editor.png` });
await page.click('.st-navb:has-text("Keybindings")');
await page.screenshot({ path: `${shots}/5c-settings-keys.png` });
await page.keyboard.press('/');
await page.keyboard.type('zoom');
want(await page.$$eval('.st-row .st-txt > span', (x) => x.map((e) => e.textContent).join(',')) === 'Zoom,Zoom in,Zoom out', `search finds the zoom rows: ${await page.$$eval('.st-row .st-txt > span', (x) => x.map((e) => e.textContent).join(','))}`);
await page.screenshot({ path: `${shots}/5d-settings-search.png` });
await page.keyboard.press('Escape'); // clears the search first
want(!!(await page.$('.st')) && (await page.$eval('.st-search input', (x) => x.value)) === '', 'Esc in the search clears it and keeps Settings open');
await page.click('.st-restore');
await page.waitForTimeout(150);
want(await page.$eval('.b.timer', (x) => x.textContent) === '8:00' && !(await page.$eval('.app', (x) => x.classList.contains('no-outline'))) && await page.$eval('.lv [data-lv="3"]', (x) => x.hasAttribute('data-on')),
  'Restore defaults puts back 8:00, the outline, and depth 3');
await page.click('.st-navb:has-text("Speech and timers")');
await page.selectOption('select[aria-label="Speech length"]', '9');
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
want(!(await page.$('.st')), 'Esc closes Settings');

// outline hide and back from the rail
await page.click('.tools [aria-label="Outline"]');
await page.waitForTimeout(300);
const hidden = await page.$eval('.app', (x) => x.classList.contains('no-outline'));
await page.click('.tools [aria-label="Outline"]');
await page.waitForTimeout(300);
want(hidden && !(await page.$eval('.app', (x) => x.classList.contains('no-outline'))), 'rail Outline button hides and brings back the outline');

// new, then close
await page.click('.tools [aria-label="New document"]');
await page.waitForTimeout(150);
want((await rows()).length === 3, 'New adds a third document');
await page.keyboard.press(`${mod}+w`);
await page.waitForTimeout(150);
want((await rows()).length === 2, `${mod}+W closes the blank one`);
await page.hover('.doc-row:nth-child(1)'); await page.waitForTimeout(300);
await page.click('.files-r:nth-child(1) .files-x'); // the edited one asks first, in Falcon's dialog
await page.waitForSelector('.cf'); await page.waitForTimeout(300);
await page.screenshot({ path: `${shots}/6-confirm-close.png` });
await page.keyboard.press('Escape'); // Esc cancels
await page.waitForTimeout(200);
want((await rows()).length === 2 && !(await page.$('.cf')), 'Esc in the close warning keeps the file open');
await page.hover('.doc-row:nth-child(1)'); await page.waitForTimeout(300);
await page.click('.files-r:nth-child(1) .files-x');
await page.click('.cf-ok');
await page.mouse.move(900, 600, { steps: 5 }); await page.waitForTimeout(400);
await page.waitForTimeout(150);
r = await rows();
want(r.length === 1 && r[0] === `*${base(b)}`, `closing the edited file asks, then leaves the other: ${JSON.stringify(r)}`);
await page.screenshot({ path: `${shots}/6-after-close.png` });

// behind Settings and in read mode, nothing swaps the document out
await page.click('.tools [aria-label="New document"]');
await page.waitForTimeout(150);
await page.click('.fstrip [aria-label="Settings"]');
await page.keyboard.press(`${mod}+w`);
await page.keyboard.press('Control+Tab');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
r = await rows();
want(r.length === 2 && r[1].startsWith('*'), `Settings blocks ${mod}+W and Ctrl-Tab: ${JSON.stringify(r)}`);
await page.click('.tools [aria-label="Read mode"]');
await page.keyboard.press('Control+Tab');
await page.waitForTimeout(150);
want((await rows())[1].startsWith('*'), 'read mode blocks Ctrl-Tab');
await page.click('.tools [aria-label="Read mode"]');
await page.keyboard.press(`${mod}+w`);
await page.waitForTimeout(150);

// crash recovery keeps an unsaved file even when another one is active
await page.evaluate(() => { const v = window.__falconView; v.dispatch(v.state.tr.insertText('KEEPME', 1)); });
await open(a);
await page.waitForTimeout(1500); // the backup runs when idle
page.on('dialog', (d) => d.accept()); // the unsaved-changes prompt on reload
await page.reload();
await page.waitForSelector('.ProseMirror');
await page.waitForTimeout(300);
r = await rows();
await page.keyboard.press('Escape');
await page.click(`.doc-nm[aria-label*="${base(b)}"]`);
await page.waitForTimeout(150);
const kept = await page.evaluate(() => window.__falconView.state.doc.textContent.slice(0, 6));
want(r.length === 2 && kept === 'KEEPME', `after a reload both files come back, unsaved edit included: ${JSON.stringify(r)} ${kept}`);
// the file that was only opened comes back clean: closing it doesn't ask
{
  const dot = (n) => page.$(`.doc-row:has(.doc-nm[aria-label*="${n}"]) .dot`).then((x) => !!x);
  const [cleanDot, editedDot] = [await dot(base(a)), await dot(base(b))];
  await page.click(`.doc-nm[aria-label*="${base(a)}"]`);
  await page.keyboard.press(`${mod}+w`);
  await page.waitForTimeout(200);
  const asked = !!(await page.$('[role=alertdialog]'));
  want(!cleanDot && editedDot && !asked, `after a reload an untouched file isn't marked unsaved (dot ${cleanDot}, edited dot ${editedDot}, close asked ${asked})`);
}

want(!errors.length, `no page errors ${errors.join(' | ')}`);
console.log(results.join('\n'));
await browser.close();
process.exit(results.some((x) => x.startsWith('FAIL')) ? 1 : 0);
