// Tables, pictures and footnotes, end to end: open a Word file that has all three (fixtures/media.docx),
// resize a column and a picture with the mouse, use the table bar and Tab, edit a footnote and add one,
// paste a table and a screenshot, insert a table from the Doc menu, then save, reopen the download in a
// fresh browser and check nothing was flattened or lost.
import fs from 'node:fs';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { openFalcon, MOD } from '../lib/falcon.mjs';

const MEDIA = path.join(process.env.FALCON_SKILL, 'fixtures/media.docx');
const f = await openFalcon('tables-images-footnotes');
const { page, want } = f;
const state = (fn) => page.evaluate(fn);
/** Table/picture/footnote facts from the live doc (read-only). */
const facts = () => state(() => {
  const out = { tables: 0, rows: [], widths: [], images: [], notes: [] };
  window.__falconView.state.doc.descendants((n) => {
    if (n.type.name === 'table') { out.tables++; out.rows.push(n.childCount); out.widths.push(n.firstChild.content.content.map((c) => c.attrs.colwidth?.[0] ?? null)); }
    if (n.type.name === 'image') out.images.push([n.attrs.width, n.attrs.height]);
    if (n.type.name === 'footnote') out.notes.push(n.attrs.content.map((c) => c.text ?? '\n').join(''));
    return true;
  });
  return out;
});
// a headless page has no OS focus, so End and the arrows don't move the caret: put it right after `text`
// (the same selection exception f.select uses)
const caretAfter = (text) => page.evaluate((text) => {
  const v = window.__falconView; let at = -1;
  v.state.doc.descendants((n, pos) => { if (at < 0 && n.isTextblock) { const i = n.textContent.indexOf(text); if (i >= 0) at = pos + 1 + i + text.length; } return at < 0; });
  if (at < 0) throw new Error(`text not in doc: ${text}`);
  const S = v.state.selection.constructor.near(v.state.doc.resolve(at)).constructor; v.dispatch(v.state.tr.setSelection(S.create(v.state.doc, at))); v.focus();
}, text);
const cellBox = (text) => page.locator('.ProseMirror td, .ProseMirror th', { hasText: text }).first().boundingBox();

// ---- open: nothing flattened ----
await f.open(MEDIA);
await page.waitForFunction(() => document.querySelector('.ProseMirror .f-img img')?.naturalWidth > 0);
const opened = await f.markMap();
fs.writeFileSync(`${f.out}/opened.markmap.txt`, opened + '\n');
want(await page.locator('.ProseMirror table').count() === 1, 'the Word table opens as a table');
want(await page.locator('.ProseMirror td[colspan="2"]').count() === 1 && await page.locator('.ProseMirror td[rowspan="2"]').count() === 1, 'its column span and row merge survive');
want(await page.locator('.ProseMirror th').count() === 3, 'its header row opens as header cells');
want(await page.locator('.ProseMirror .f-img img').evaluate((i) => Math.round(i.getBoundingClientRect().width)) === 360, 'the picture opens at its Word size (360px)');
want(JSON.stringify(await page.locator('.ProseMirror .f-footnote').evaluateAll((els) => els.map((e) => e.dataset.n))) === '["1","2"]', 'both footnotes show their numbers, 1 and 2');
want(await page.locator('.f-notes li').count() === 2 && (await page.locator('.f-notes li').first().textContent()).startsWith('Smith, J. (2024)'), 'the notes are listed under the document');
await f.shot('opened');
await page.locator('.ProseMirror table').scrollIntoViewIfNeeded();
await f.shot('opened-table-and-picture');

// ---- table: click into a cell, the bar appears ----
const c2030 = await cellBox('2030');
await page.mouse.click(c2030.x + 20, c2030.y + c2030.height / 2);
await page.waitForTimeout(150);
want(await page.locator('.f-tbar').isVisible(), 'clicking into a cell shows the table bar');
await f.shot('table-bar');

// ---- table: drag the first column's edge 90px to the right ----
const before = (await facts()).widths[0];
const year = await cellBox('Year');
const edge = { x: year.x + year.width - 1, y: year.y + year.height / 2 };
await page.mouse.move(edge.x - 6, edge.y);
await page.mouse.move(edge.x, edge.y, { steps: 3 });
await page.waitForTimeout(100);
want(await page.locator('.ProseMirror .column-resize-handle').count() > 0, 'hovering a column edge shows the resize line');
await page.mouse.down();
await page.mouse.move(edge.x + 45, edge.y, { steps: 5 });
await page.mouse.move(edge.x + 90, edge.y, { steps: 5 });
await page.waitForTimeout(50);
const mid = await page.locator('.ProseMirror table').first().evaluate((t) => [...t.querySelectorAll('col')].map((c) => parseFloat(c.style.width)));
want(mid[0] - before[0] >= 80 && mid[0] + mid[1] === before[0] + before[1], `while dragging, column 2 already gives way on screen (${mid.join('+')})`);
await f.shot('column-resize-drag');
await page.mouse.up();
await page.waitForTimeout(100);
const after = (await facts()).widths[0];
want(after[0] - before[0] >= 80 && after[0] - before[0] <= 100, `dragging the edge widened column 1 (${before[0]} → ${after[0]}px)`);
want(after[0] + after[1] === before[0] + before[1] && after[2] === before[2], `column 2 gave up the width, so the table kept its size (${before.join('+')} → ${after.join('+')})`);
await f.shot('column-resized');

// ---- table: Row ↓ from the bar (under the cursor's row), then Tab out of the last cell adds a row ----
const r2030 = await cellBox('2030'); // the header row grew when its narrower column wrapped
await page.mouse.click(r2030.x + 20, r2030.y + r2030.height / 2);
await page.click('.f-tbar button:text-is("Row ↓")');
want((await facts()).rows[0] === 5 && (await f.markMap()).includes('cell r2c0 normal: \ncell r2c1 normal: '), 'Row ↓ adds an empty row under the 2030 row (4 → 5 rows)');
const smith = await cellBox('Smith 24');
await page.mouse.click(smith.x + smith.width - 10, smith.y + smith.height / 2);
await page.keyboard.press('Tab'); // the last cell of the table: Word adds a row and moves into it
want((await facts()).rows[0] === 6, 'Tab in the last cell adds a row, like Word (5 → 6)');
await page.keyboard.type('2070');
await page.keyboard.press('Tab');
await page.keyboard.type('3.0');
want((await f.markMap()).includes('cell r5c0 normal: 2070\ncell r5c1 normal: 3.0'), 'Tab moves cell to cell, typing fills them');
await page.keyboard.press('Shift+Tab');
const back = await state(() => { const s = window.__falconView.state; return s.doc.textBetween(s.selection.from, s.selection.to); });
want(back === '2070', `Shift-Tab goes back a cell and selects its text, like Word (${back})`);

// ---- table: format inside a cell with a Falcon key ----
await f.select('2070');
await page.keyboard.press('F9');
want((await f.markMap()).includes('cell r5c0 normal: [2070]{underline}'), 'F9 underlines text in a cell');

// ---- table: drag across two cells, Merge ----
const a = await cellBox('2070'), b = await cellBox('3.0');
await page.mouse.move(a.x + 8, a.y + a.height / 2);
await page.mouse.down();
await page.mouse.move(b.x + 8, b.y + b.height / 2, { steps: 6 });
await page.mouse.up();
want(await page.locator('.ProseMirror .selectedCell').count() === 2, 'dragging from one cell into the next selects both cells');
await f.shot('cells-selected');
await page.click('.f-tbar button:text-is("Merge")');
want((await f.markMap()).includes('cell r5c0 2x1 normal: [2070]{underline}\ncell r5c0 2x1 normal: 3.0'), 'Merge joins them into one cell spanning two columns, keeping both texts');
await f.shot('cells-merged');

// ---- picture: click to select, drag the corner handle ----
const img = page.locator('.ProseMirror .f-img img');
await img.scrollIntoViewIfNeeded();
const ib = await img.boundingBox();
await page.mouse.click(ib.x + ib.width / 2, ib.y + ib.height / 2);
await page.waitForTimeout(100);
want(await page.locator('.ProseMirror .f-img.ProseMirror-selectednode').count() === 1 && await page.locator('.f-img-handle').isVisible(), 'clicking the picture selects it and shows its resize handle');
await f.shot('picture-selected');
const hb = await page.locator('.f-img-handle').boundingBox();
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
await page.mouse.down();
await page.mouse.move(hb.x + hb.width / 2 + 60, hb.y + 20, { steps: 4 });
await page.mouse.move(hb.x + hb.width / 2 + 120, hb.y + 30, { steps: 4 });
want((await page.locator('.f-img-size').textContent()) === '480 × 271', `the size shows while dragging (${await page.locator('.f-img-size').textContent()})`);
await f.shot('picture-resize-drag');
await page.mouse.up();
await page.waitForTimeout(100);
const [iw, ih] = (await facts()).images[0];
want(iw === 480 && ih === 271, `the picture is now 480 × 271, same shape as 360 × 203 (${iw} × ${ih})`);
await f.shot('picture-resized');
await page.keyboard.press(`${MOD}+z`);
want(JSON.stringify((await facts()).images[0]) === '[360,203]', 'one undo puts it back to 360 × 203');
await page.keyboard.press(`${MOD}+Shift+z`);

// ---- footnotes: click a number, edit the note ----
await page.locator('.ProseMirror .f-footnote').nth(1).scrollIntoViewIfNeeded();
await page.locator('.ProseMirror .f-footnote').nth(1).click();
await page.waitForTimeout(150);
want(await page.locator('.f-note-pop').isVisible() && (await page.locator('.f-note-pop .f-note-num').textContent()) === 'Footnote 2', 'clicking footnote 2 opens its editor');
want((await page.locator('.f-note-pop .f-note-text').textContent()).startsWith('Lenton et al. 2019'), 'the editor holds the note text');
await page.keyboard.type(' Cited in Smith.');
await f.shot('footnote-editing');
await page.keyboard.press('Escape');
want(!(await page.locator('.f-note-pop').isVisible()), 'Escape closes the footnote editor');
want((await facts()).notes[1].endsWith('Nature 575. Cited in Smith.'), 'the edit is saved into the footnote');

// ---- footnotes: Mod-Alt-F adds one at the cursor, numbers follow document order ----
await caretAfter('shows when.'); // the end of the paragraph, after footnote 2
await page.keyboard.press(`${MOD}+Alt+f`);
await page.waitForTimeout(150);
want(await page.locator('.f-note-pop').isVisible(), 'Mod-Alt-F inserts a footnote and opens its editor');
await page.keyboard.type('Added in Falcon.');
await page.keyboard.press('Enter');
const notes = await facts();
want(notes.notes.length === 3 && notes.notes[2] === 'Added in Falcon.', 'the new note holds what was typed');
want(JSON.stringify(await page.locator('.f-notes li').evaluateAll((els) => els.map((e) => e.dataset.n + ' ' + e.textContent.slice(0, 12)))) === JSON.stringify(['1 Smith, J. (2', '2 Lenton et al', '3 Added in Fal']), 'the list under the document shows all three, numbered in order');
await page.locator('.f-notes').scrollIntoViewIfNeeded();
await f.shot('footnotes-list');

// ---- paste a table from a spreadsheet, and a screenshot ----
await caretAfter('figure 3.');
await page.keyboard.press('Enter');
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData('text/html', `<meta charset="utf-8"><google-sheets-html-origin><table style="border-collapse:collapse"><tbody><tr><td style="width:140px;background-color:#d9ead3">Country</td><td style="width:90px">Emissions</td></tr><tr><td>China</td><td>12.7</td></tr><tr><td>US</td><td>5.9</td></tr></tbody></table>`);
  dt.setData('text/plain', 'Country\tEmissions\nChina\t12.7\nUS\t5.9');
  window.__falconView.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(200);
const pasted = await f.markMap();
want(pasted.includes('cell r0c0 bg#D9EAD3 normal: Country') && pasted.includes('cell r2c1 normal: 5.9'), 'a table pasted from a spreadsheet is a real table, shading kept');
want((await facts()).widths.some((w) => JSON.stringify(w) === '[140,90]'), 'and keeps its column widths');
await page.locator('.ProseMirror table').last().scrollIntoViewIfNeeded();
await f.shot('pasted-table');
// a pasted table is as editable as any: click a cell, drag its edge
const china = await cellBox('Country');
await page.mouse.click(china.x + 10, china.y + china.height / 2);
await page.click('.f-tbar button:text-is("Col →")');
want((await f.markMap()).includes('cell r0c2 normal: '), 'the pasted table takes a new column from the bar');

const png = await page.evaluate(async () => {
  // a 1000 × 500 screenshot, wider than the page
  const c = document.createElement('canvas'); c.width = 1000; c.height = 500;
  const g = c.getContext('2d'); g.fillStyle = '#f3f4f6'; g.fillRect(0, 0, 1000, 500); g.fillStyle = '#ef4444'; g.fillRect(80, 120, 380, 260); g.fillStyle = '#111'; g.font = '48px sans-serif'; g.fillText('pasted screenshot', 480, 270);
  return c.toDataURL('image/png').split(',')[1];
});
await caretAfter('figure 3.');
await page.evaluate((b64) => {
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], 'Screenshot.png', { type: 'image/png' }));
  window.__falconView.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, png);
await page.waitForFunction(() => window.__falconMarkMap().split('[image').length > 2);
const shots = (await facts()).images;
want(shots.length === 2 && shots[1][0] === 624 && shots[1][1] === 312, `a pasted screenshot comes in at page width, same shape (${shots[1]})`);
await page.locator('.ProseMirror .f-img').nth(1).scrollIntoViewIfNeeded();
await f.shot('pasted-screenshot');

// ---- Doc menu: Insert Table ----
await caretAfter('figure 3.');
await page.keyboard.press('Enter');
await page.locator('button[data-pop="doc"]').dispatchEvent('mousedown');
await page.waitForTimeout(150);
await f.shot('doc-menu-insert');
await page.locator('.pop .mn-i', { hasText: 'Insert Table' }).dispatchEvent('mousedown');
await page.waitForTimeout(150);
want((await facts()).tables === 3, 'Doc ▸ Insert Table adds a table');
await page.keyboard.type('Claim');
await page.keyboard.press('Tab');
await page.keyboard.type('Warrant');
want((await f.markMap()).includes('cell r0c0 normal: Claim') && (await f.markMap()).includes('cell r0c1 normal: Warrant'), 'the new table takes typing, Tab moves on');
await page.locator('.ProseMirror table').last().scrollIntoViewIfNeeded();
await f.shot('inserted-table');

// ---- find reaches table cells ----
await page.keyboard.press(`${MOD}+f`);
await page.fill('input[placeholder="Find"]', 'middle scenario');
await page.waitForTimeout(200);
want((await page.locator('.findbar .count').textContent()).trim() === '1/1', 'Find finds text inside a table cell');
await page.keyboard.press('Escape');

// ---- save, check the file, reopen in a fresh browser ----
const edited = await f.markMap();
fs.writeFileSync(`${f.out}/edited.markmap.txt`, edited + '\n');
const saved = await f.save('media-saved.docx');
const zip = unzipSync(fs.readFileSync(saved));
const xml = strFromU8(zip['word/document.xml']);
want((xml.match(/<w:tbl>/g) ?? []).length === 3 && (xml.match(/<w:drawing>/g) ?? []).length === 2, 'the saved file has 3 tables and 2 pictures');
want(Object.keys(zip).filter((k) => k.startsWith('word/media/')).length === 2, 'both pictures are embedded in word/media');
want((strFromU8(zip['word/footnotes.xml']).match(/<w:footnote w:id="[1-9]/g) ?? []).length === 3, 'footnotes.xml has the 3 notes');
await f.done();

const g = await openFalcon('tables-images-footnotes/reopen');
await g.open(saved);
await g.page.waitForFunction(() => [...document.querySelectorAll('.ProseMirror .f-img img')].every((i) => i.naturalWidth > 0));
const reopened = await g.markMap();
fs.writeFileSync(`${g.out}/reopened.markmap.txt`, reopened + '\n');
g.want(reopened === edited, 'the reopened file matches the edited document: tables, spans, shading, pictures, footnotes');
const widths = await g.page.evaluate(() => { const w = []; window.__falconView.state.doc.descendants((n) => { if (n.type.name === 'image') w.push([n.attrs.width, n.attrs.height]); return true; }); return w; });
g.want(JSON.stringify(widths) === '[[480,271],[624,312]]', `picture sizes survive the save (${JSON.stringify(widths)})`);
await g.shot('reopened');
await g.page.locator('.ProseMirror table').first().scrollIntoViewIfNeeded();
await g.shot('reopened-table');
await g.done();
