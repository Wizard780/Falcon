// Cards Claude added (a `_fcp_<id>` bookmark on the tag) open in light orange. Approve (button) keeps one and
// moves on; Reject (Mod-Shift-Backspace) deletes the next. The saved file has no orange and no pending marks.
// FALCON_DOC=<a copy of a block file with _fcp_ cards> (see progress.md, "pending cards", for a python-docx recipe).
import fs from 'node:fs';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { openFalcon, MOD } from '../lib/falcon.mjs';

const DOC = process.env.FALCON_DOC;
if (!DOC) { console.error('set FALCON_DOC to a .docx holding _fcp_ cards'); process.exit(2); }
const name = path.basename(DOC, '.docx');
const pending = (page) => page.evaluate(() => {
  const out = [];
  window.__falconView.state.doc.forEach((n) => { if (n.attrs.pending) out.push([n.attrs.card, n.textContent]); });
  return out;
});
const paraAtCaret = (page) => page.evaluate(() => window.__falconView.state.selection.$from.parent.textContent);

const f = await openFalcon('pending-cards');
const { page, want } = f;
await f.open(DOC);
const start = await pending(page);
want(start.length === 2, `opened with ${start.length} pending cards: ${start.map((p) => p[1].slice(0, 30)).join(' | ')}`);
want(await page.locator('.doc-row i[aria-label="unsaved"]').count() === 0, 'opening leaves the file clean');
const count = page.locator('.status .pend');
want((await count.textContent())?.trim() === '2 pending', 'status bar shows "2 pending"');

// the status bar button goes to the first one
await count.click();
await page.waitForTimeout(400);
want((await paraAtCaret(page)) === start[0][1], 'clicking "2 pending" puts the caret on the first pending card');
const head = page.locator('.ProseMirror .f-pending-head', { hasText: start[0][1] });
const bg = await page.locator('.ProseMirror .f-pending').first().evaluate((e) => getComputedStyle(e).backgroundColor);
want(/rgba?\(|color\(/.test(bg) && bg !== 'rgba(0, 0, 0, 0)', `pending paragraphs have a background (${bg})`);
want(await page.locator('.ProseMirror .f-pending').count() >= 3, 'the tag, cite and body of the card are all orange');
await f.shot('pending-orange');

// Approve with the button on the card
await head.locator('[aria-label="Approve card"]').click();
await page.waitForTimeout(300);
const afterApprove = await pending(page);
want(afterApprove.length === 1 && afterApprove[0][0] === start[1][0], 'Approve cleared the first card only');
want((await paraAtCaret(page)) === start[1][1], 'and moved the caret to the next pending card');
want(await page.locator('.doc-row i[aria-label="unsaved"]').count() === 1, 'approving marks the file unsaved');

// Reject the second with the key
await page.keyboard.press(`${MOD}+Shift+Backspace`);
await page.waitForTimeout(300);
const left = await page.evaluate(() => window.__falconView.state.doc.textContent);
want((await pending(page)).length === 0, 'Mod-Shift-Backspace rejected the last pending card');
want(!left.includes(start[1][1]) && !left.includes('This one gets rejected'), 'its tag and body are gone');
want(left.includes(start[0][1]), 'the approved card is still there');
want(await count.count() === 0, 'the status bar count is gone');
await page.locator('.ProseMirror h4', { hasText: start[0][1] }).scrollIntoViewIfNeeded();
await f.shot('reviewed');

const saved = await f.save(`${name}-saved.docx`);
const xml = strFromU8(unzipSync(fs.readFileSync(saved), { filter: (x) => x.name === 'word/document.xml' })['word/document.xml']);
want(!xml.includes('_fcp_'), 'saved file has no pending marks');
want(xml.includes(`w:name="_fc_${start[0][0]}"`), `the approved card keeps its id (_fc_${start[0][0]})`);
const card = xml.slice(xml.indexOf(`_fc_${start[0][0]}`), xml.indexOf('New body text Claude cut') + 200);
want(!/w:shd|w:highlight/.test(card), 'nothing orange (no shading or highlight) was written on the approved card');
await f.done();

const g = await openFalcon('pending-cards/reopen');
await g.open(saved);
g.want((await pending(g.page)).length === 0 && await g.page.locator('.ProseMirror .f-pending').count() === 0, 'the saved file reopens with no orange');
await g.shot('reopened');
await g.done();
