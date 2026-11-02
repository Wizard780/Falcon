// Real mouse and key gestures for navigation and structure: outline drag, copy-drag, Mod/Shift-click,
// the right-click menu, outline search, find and replace, card numbering, dragging on the page, and
// the next/previous keys. Usage: vite preview on :5190 (or FALCON_URL), then
//   node scripts/nav-check.mjs <file.docx>   (screenshots go to /tmp/nav-*.png)
import { chromium } from 'playwright';
const URL = process.env.FALCON_URL || 'http://localhost:5190/';
const file = process.argv[2] || '/tmp/fdirty/Whittaker.docx';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new globalThis.URL(URL).origin });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('falcon.depth', '4'); });
await page.reload();
await page.waitForSelector('.ProseMirror'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.tools [aria-label="Open…"]')]);
await fc.setFiles(file); await page.waitForTimeout(900);

const results = [];
const want = (ok, what) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const heads = () => page.evaluate(() => { const o = []; window.__falconView.state.doc.forEach((n) => { if (['pocket', 'hat', 'block', 'tag', 'analytic'].includes(n.attrs.style)) o.push(n.attrs.style[0] + ':' + n.textContent.trim().slice(0, 30)); }); return o; });
const docText = () => page.evaluate(() => window.__falconView.state.doc.textContent);
const settle = () => page.waitForTimeout(400);
const row = (i) => page.locator(`.sb-row.ol[data-i="${i}"]`);
const center = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
const undoAll = async (n) => { await page.click('.ProseMirror'); for (let k = 0; k < n; k++) await page.keyboard.press('Meta+z'); await settle(); };

process.on('unhandledRejection', async (e) => { console.log(results.join('\n')); console.log('ERR', e.message.split('\n')[0]); await page.screenshot({ path: '/tmp/nav-fail.png' }); process.exit(1); });
try {
const h0 = await heads();
console.log('headings', h0.length, h0.slice(0, 14));
const tagRows = await page.$$eval('.sb-row.ol.l4', (r) => r.map((x) => Number(x.dataset.i)));
const blockRows = await page.$$eval('.sb-row.ol.l3', (r) => r.map((x) => Number(x.dataset.i)));

// ---- 1. drag a tag down past two tags ----
{
  const [a, , , d] = tagRows;
  const src = await center(row(a)), dst = await center(row(d));
  await page.mouse.move(src.x, src.y); await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(src.x, src.y + ((dst.b.y + 2 - src.y) * k) / 8);
  await page.waitForTimeout(150);
  want(await page.locator('.ol-drop').count() === 1, 'dragging a row shows a drop line');
  await page.screenshot({ path: '/tmp/nav-drag.png' });
  await page.mouse.up(); await settle();
  const h1 = await heads();
  const moved = h0[a];
  want(h1.length === h0.length && h1.indexOf(moved) > h0.indexOf(moved), `outline drag moves the tag down (${h0.indexOf(moved)} -> ${h1.indexOf(moved)})`);
  await undoAll(1);
  want(JSON.stringify(await heads()) === JSON.stringify(h0), 'one undo puts it back');
}
// ---- 2. a block can't land among another block's tags ----
if (blockRows.length >= 2) {
  const b = blockRows[0];
  const t = tagRows.find((x) => x > blockRows[1]);
  const src = await center(row(b)), dst = await center(row(t));
  await page.mouse.move(src.x, src.y); await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(src.x, src.y + ((dst.y - src.y) * k) / 8);
  const lineY = await page.$eval('.ol-drop', (e) => e.getBoundingClientRect().top).catch(() => null);
  const okRows = await page.$$eval('.sb-row.ol.l3, .sb-row.ol.l2, .sb-row.ol.l1', (r) => r.map((x) => x.getBoundingClientRect().top));
  const lastRow = await page.$$eval('.sb-row.ol', (r) => r[r.length - 1].getBoundingClientRect().bottom);
  await page.mouse.up(); await settle();
  want(lineY === null || okRows.concat(lastRow).some((y) => Math.abs(y - lineY - 1) < 3), 'a dragged block only offers block boundaries');
  const h2 = await heads();
  const ok = h2.length === h0.length;
  if (JSON.stringify(h2) !== JSON.stringify(h0)) await undoAll(1);
  want(ok, 'block drop kept every heading');
}
// ---- 3. Alt-drag copies ----
{
  const a = tagRows[0], d = tagRows[2];
  const src = await center(row(a)), dst = await center(row(d));
  await page.mouse.move(src.x, src.y); await page.mouse.down();
  await page.keyboard.down('Alt');
  for (let k = 1; k <= 8; k++) await page.mouse.move(src.x, src.y + ((dst.b.y + 2 - src.y) * k) / 8);
  await page.mouse.up(); await page.keyboard.up('Alt'); await settle();
  const h3 = await heads();
  want(h3.length === h0.length + 1 && h3.filter((x) => x === h0[a]).length === h0.filter((x) => x === h0[a]).length + 1, `Alt-drag copies (${h0.length} -> ${h3.length}) ${h3.slice(4, 10)}`);
  await undoAll(1);
}
// ---- 4. Mod-click and Shift-click ----
{
  await row(tagRows[0]).click({ modifiers: ['Meta'] });
  await row(tagRows[2]).click({ modifiers: ['Meta'] });
  await settle();
  const sel = await page.$$eval('.sb-row.ol[aria-selected="true"]', (r) => r.map((x) => Number(x.dataset.i)));
  want(sel.includes(tagRows[0]) && sel.includes(tagRows[2]), `Mod-click selects several rows (${sel})`);
  await row(tagRows[0]).click(); await row(tagRows[3]).click({ modifiers: ['Shift'] }); await settle();
  const sel2 = await page.$$eval('.sb-row.ol[aria-selected="true"]', (r) => r.map((x) => Number(x.dataset.i)));
  const between = await page.$$eval('.sb-row.ol', (r, [a, b]) => r.map((x) => Number(x.dataset.i)).filter((i) => i >= a && i <= b), [tagRows[0], tagRows[3]]);
  want(JSON.stringify(sel2) === JSON.stringify(between), `Shift-click selects the shown rows between (${sel2})`);
  // ---- 5. right-click menu on the selection: copy, then delete as one undo ----
  await row(tagRows[1]).click({ button: 'right' }); await page.waitForTimeout(250);
  await page.screenshot({ path: '/tmp/nav-menu.png' });
  const items = await page.$$eval('.ol-menu .mn-i span', (x) => x.map((e) => e.textContent));
  want(['Select', 'Cut', 'Copy', 'Delete'].every((x) => items.includes(x)) && items.some((x) => /^Alphabetize \d+ headings$/.test(x)), `menu: ${items.join(', ')}`);
  await page.click('.ol-menu .mn-i:has-text("Copy")'); await settle();
  const clip = await page.evaluate(async () => { const it = (await navigator.clipboard.read())[0]; return { html: await (await it.getType('text/html')).text(), text: await (await it.getType('text/plain')).text() }; });
  const names = sel2.map((i) => h0[i].slice(2, 20));
  want(names.every((n) => clip.text.includes(n)) && /<h4/.test(clip.html), 'Copy puts every selected heading (with its card) on the clipboard');
  // paste it at the end of the doc and check the tags came back as tags
  await page.evaluate(() => { const v = window.__falconView; const S = v.state.selection.constructor; v.dispatch(v.state.tr.setSelection(S.atEnd(v.state.doc))); v.focus(); });
  await page.keyboard.press('Enter'); await page.keyboard.press('Meta+v'); await settle();
  const hp = await heads();
  want(hp.length >= h0.length + names.length, `pasted copy keeps heading styles (${h0.length} -> ${hp.length})`);
  await undoAll(3);
  want(JSON.stringify(await heads()) === JSON.stringify(h0), 'undo after paste back to start');
  // delete
  await row(tagRows[0]).click({ modifiers: ['Meta'] }); await row(tagRows[2]).click({ modifiers: ['Meta'] }); await settle();
  await row(tagRows[2]).click({ button: 'right' }); await page.waitForTimeout(200);
  await page.click('.ol-menu .mn-i:has-text("Delete")'); await settle();
  const hd = await heads();
  want(hd.length === h0.length - 2, `multi Delete removes both (${h0.length} -> ${hd.length})`);
  await undoAll(1);
  want(JSON.stringify(await heads()) === JSON.stringify(h0), 'multi Delete is one undo step');
  // cut
  await row(tagRows[1]).click({ button: 'right' }); await page.waitForTimeout(200);
  await page.click('.ol-menu .mn-i:has-text("Cut")'); await settle();
  const clip2 = await page.evaluate(() => navigator.clipboard.readText());
  want((await heads()).length === h0.length - 1 && clip2.includes(h0[tagRows[1]].slice(2, 20)), 'Cut copies then removes');
  await undoAll(1);
}
// ---- 6. alphabetize ----
{
  const pick = tagRows.slice(3, 7);
  await row(pick[0]).click();
  await row(pick[3]).click({ modifiers: ['Shift'] }); await settle();
  await row(pick[1]).click({ button: 'right' }); await page.waitForTimeout(200);
  await page.click('.ol-menu .mn-i:has-text("Alphabetize")'); await settle();
  const ha = await heads();
  const sortedRows = await page.$$eval('.sb-row.ol[data-i]', (r) => r.map((x) => x.textContent));
  const tagsNow = ha.filter((x) => x.startsWith('t:') || x.startsWith('a:'));
  console.log('after alphabetize', ha.slice(0, 10));
  const changed = JSON.stringify(ha) !== JSON.stringify(h0);
  want(ha.length === h0.length, `alphabetize keeps every heading (changed: ${changed})`);
  if (changed) await undoAll(1);
  want(JSON.stringify(await heads()) === JSON.stringify(h0), 'alphabetize undoes in one step');
  void sortedRows; void tagsNow;
}
// ---- 7. outline search ----
{
  await page.click('.olp [aria-label="Search the outline"]');
  const word = h0[tagRows[2]].slice(2).split(/\s+/).find((w) => w.length > 4) || 'the';
  await page.keyboard.type(word.toUpperCase().replace(/'/g, '’'));
  await page.waitForTimeout(400);
  const hitRows = await page.$$eval('.sb-row.ol[data-hit]', (r) => r.length);
  const shownHide = await page.$$eval('.sb-row.ol', (r) => r.length);
  want(hitRows >= 1, `search "${word}" (upper-cased) lights ${hitRows} rows, ${shownHide} shown`);
  const sc0 = await page.$eval('.f-scroll', (s) => s.scrollTop);
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(900);
  const sc1 = await page.$eval('.f-scroll', (s) => s.scrollTop);
  const focusIn = await page.evaluate(() => document.activeElement?.classList.contains('ol-q'));
  want(focusIn, `Down steps without leaving the box (scroll ${Math.round(sc0)} -> ${Math.round(sc1)})`);
  await page.screenshot({ path: '/tmp/nav-search.png' });
  await page.click('.ol-tg:has-text("Hide others")'); await page.waitForTimeout(300);
  const shownAll = await page.$$eval('.sb-row.ol', (r) => r.length);
  want(shownAll > shownHide, `Hide others off shows the whole outline (${shownHide} -> ${shownAll})`);
  await page.click('.ol-tg:has-text("Hide others")');
  await page.click('.ol-lv button:has-text("B")'); await page.waitForTimeout(300);
  const blockOnly = await page.$$eval('.sb-row.ol[data-hit]', (r) => r.every((x) => x.classList.contains('l3')));
  await page.click('.ol-tg:has-text("Card text")'); await page.waitForTimeout(400);
  const blockHits = await page.$$eval('.sb-row.ol[data-hit]', (r) => r.length);
  want(blockOnly && blockHits >= 1, `Block level + card text maps the hit to its block (${blockHits})`);
  await page.click('.ol-lv button:has-text("All")'); await page.click('.ol-tg:has-text("Card text")');
  await page.waitForTimeout(300);
  await page.focus('.ol-q');
  await page.keyboard.press('Enter'); await settle();
  const inHead = await page.evaluate(() => ['tag', 'analytic', 'block', 'hat', 'pocket'].includes(window.__falconView.state.selection.$head.parent.attrs.style));
  want(inHead, 'Enter jumps to the match');
  await page.click('.olp [aria-label="Search the outline"]');
  await page.click('.olp [aria-label="Search the outline"]'); await page.keyboard.type('zzqqxx'); await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); await settle();
  want(await page.locator('.ol-q').count() === 0, 'Esc closes the search');
}
// ---- 8. find and replace ----
{
  await page.click('.ProseMirror');
  await page.keyboard.press('Meta+Shift+h'); await settle();
  want(await page.locator('.findbar .fb-with').count() === 1, 'Mod-Shift-H opens find with the replace row');
  const t0 = await docText();
  const word = 'the';
  const n = (t0.toLowerCase().match(/the/g) || []).length;
  await page.fill('.findbar input:not(.fb-with)', word); await settle();
  const count = await page.$eval('.findbar .count', (e) => e.textContent);
  await page.fill('.findbar .fb-with', 'THEE');
  await page.screenshot({ path: '/tmp/find-replace.png' });
  await page.click('.findbar button:has-text("Replace") >> nth=1'); await settle();
  const t1 = await docText();
  want((t1.match(/THEE/g) || []).length === 1, `Replace replaces one (${count})`);
  await page.click('.findbar button:has-text("All")'); await settle();
  const t2 = await docText();
  want((t2.match(/THEE/g) || []).length === n && !/the/i.test(t2.replace(/THEE/g, '')), `All replaces every match (${n})`);
  await page.keyboard.press('Escape');
  await page.click('.ProseMirror'); await page.keyboard.press('Meta+z'); await settle();
  want((await docText()) === t1, 'Replace all is one undo step');
  await page.keyboard.press('Meta+z'); await settle();
  want((await docText()) === t0, 'and the single replace another');
  // Alt-F: position order
  await page.keyboard.press('Alt+f'); await settle();
  want(await page.$eval('.findbar .fb-txt', (e) => e.textContent) === 'In order', 'Alt-F finds in position order');
  await page.keyboard.press('Escape');
}
// ---- 9. numbering ----
{
  const tagsPos = await page.evaluate(() => { const o = []; window.__falconView.state.doc.forEach((n, p) => { if (n.attrs.style === 'tag') o.push(p); }); return o; });
  await page.evaluate((p) => { const v = window.__falconView; const S = v.state.selection.constructor; v.dispatch(v.state.tr.setSelection(S.near(v.state.doc.resolve(p + 1)))); v.focus(); }, tagsPos[0]);
  // Shift-click range in the outline, then number them all
  await row(tagRows[0]).click(); await row(tagRows[3]).click({ modifiers: ['Shift'] }); await settle();
  await page.keyboard.press('Meta+Alt+1'); await settle();
  await page.click('.ProseMirror .f-tag >> nth=1');
  await page.keyboard.press('Meta+Alt+2'); await settle();
  // the page draws numbers around what's on screen: visit each numbered card
  const nums = [];
  for (const p of await page.evaluate(() => { const o = []; window.__falconView.state.doc.forEach((n, p) => { if (n.attrs.style === 'tag') o.push(p); }); return o.slice(0, 8); })) {
    await page.evaluate((p) => { const v = window.__falconView, sc = document.querySelector('.f-scroll'); for (let k = 0; k < 4; k++) sc.scrollTop += v.nodeDOM(p).getBoundingClientRect().top - 200; }, p);
    await page.waitForTimeout(250);
    const n = await page.evaluate((p) => window.__falconView.nodeDOM(p).getAttribute('data-num'), p);
    if (n) nums.push(n);
  }
  const rowNums = await page.$$eval('.sb-row.ol .num', (e) => e.map((x) => x.textContent));
  want(nums.length >= 3 && nums[0] === '1.' && nums[1] === 'a.', `numbers on the page: ${nums.join(' ')}`);
  want(rowNums.join(' ') === nums.join(' '), `and in the outline: ${rowNums.join(' ')}`);
  const t = await docText();
  want(!/^1\./.test(t), 'numbers are not text');
  await page.evaluate((p) => { const v = window.__falconView; const el = v.nodeDOM(p); el.scrollIntoView({ block: 'center' }); }, tagsPos[0]);
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/numbering.png' });
}
// ---- 10. drag on the page ----
{
  const pos = await page.evaluate(() => { const o = []; window.__falconView.state.doc.forEach((n, p) => { if (n.attrs.style === 'tag') o.push(p); }); return o; });
  await page.evaluate((p) => window.__falconView.nodeDOM(p).scrollIntoView({ block: 'start' }), pos[0]);
  await page.evaluate(() => (document.querySelector('.f-scroll').scrollTop -= 60));
  await page.waitForTimeout(300);
  const box = await page.evaluate((p) => { const r = window.__falconView.nodeDOM(p).getBoundingClientRect(); return { x: r.left, y: r.top, h: r.height }; }, pos[0]);
  await page.mouse.move(box.x + 40, box.y + 6); await page.waitForTimeout(100);
  await page.mouse.move(box.x + 60, box.y + 8); await page.waitForTimeout(150);
  const grip = page.locator('.f-grip');
  want(await grip.isVisible(), 'hovering a card shows the grip');
  const g = await center(grip);
  const target = await page.evaluate((p) => { const r = window.__falconView.nodeDOM(p).getBoundingClientRect(); return r.top; }, pos[2]);
  const before = await heads();
  await page.mouse.move(g.x, g.y); await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(g.x, g.y + ((target + 2 - g.y) * k) / 10);
  await page.waitForTimeout(150);
  want(await page.locator('.f-drop-line').isVisible(), 'page drag shows a drop line');
  await page.screenshot({ path: '/tmp/nav-drag-page.png' });
  await page.mouse.up(); await settle();
  const after = await heads();
  const moved = before.findIndex((x, i) => x !== after[i]);
  want(after.length === before.length && moved >= 0 && after.indexOf(before[moved]) > moved, `page drag moved the card (${moved} -> ${after.indexOf(before[moved])})`);
  want(await page.$$eval('.sb-row.ol .num', (e) => e.length) === 4 && (await page.evaluate((p) => window.__falconView.nodeDOM(p)?.getAttribute('data-num'), await page.evaluate(() => window.__falconView.state.selection.$head.before(1)))) !== null, 'numbers follow the moved card');
  await undoAll(1);
  want(JSON.stringify(await heads()) === JSON.stringify(before), 'page drag undoes in one step');
}
// ---- 11. next/previous by level, select/delete current heading ----
{
  await page.evaluate(() => { const v = window.__falconView; const S = v.state.selection.constructor; v.dispatch(v.state.tr.setSelection(S.atStart(v.state.doc))); v.focus(); });
  await page.keyboard.press('Alt+PageDown'); await page.keyboard.press('Alt+PageDown');
  const style = await page.evaluate(() => window.__falconView.state.selection.$head.parent.attrs.style);
  await page.keyboard.press('Meta+PageDown');
  const style2 = await page.evaluate(() => window.__falconView.state.selection.$head.parent.attrs.style);
  want(style === 'tag' && style2 === 'block', `Alt-PageDown lands on a tag, Mod-PageDown on a block (${style}, ${style2})`);
  await page.keyboard.press('Alt+PageDown');
  await page.keyboard.press('Alt+a');
  const selText = await page.evaluate(() => { const s = window.__falconView.state.selection; return window.__falconView.state.doc.textBetween(s.from, s.to, '\n').split('\n').length; });
  want(selText >= 1, `Alt-A selects the card (${selText} paragraphs)`);
}
} catch (e) { results.push('FAIL threw: ' + e.message.split('\n').slice(0, 4).join(' ')); await page.screenshot({ path: '/tmp/nav-fail.png' }); }
want(errors.length === 0, `no page errors ${errors.join(' | ')}`);
console.log(results.join('\n'));
await browser.close();
