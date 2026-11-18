// Split files: backspacing away the last heading of a file (its text, then the empty line) while that row
// is lit in its outline section. The outline used to light a row past the end of the shrunk list and crash
// the app ("Cannot read properties of undefined (reading 'level')").
import { openFalcon, SEED } from '../lib/falcon.mjs';

const f = await openFalcon('outline-last-heading');
const { page, want } = f;
const errors = [];
// a headless page has no OS caret moves (End lands mid-line): put the caret where a click past the last word would
const caretAtEnd = () => page.evaluate(() => { const v = window.__falconView; const S = v.state.selection.constructor; v.dispatch(v.state.tr.setSelection(S.atEnd(v.state.doc))); v.focus(); });
page.on('pageerror', (e) => errors.push(e.message));
await f.open(SEED);
await page.click('.tools [aria-label="New document"]');
await page.click('.cf .sa-mode:has-text("Blank Doc")');
await page.waitForTimeout(200);
await page.locator('.fs-docs .doc-row .doc-nm[aria-label="seed"]').click();
await page.locator('.fs-docs .doc-row .doc-nm[aria-label="Untitled"]').click({ modifiers: ['Shift'] });
await page.mouse.move(900, 700);
await page.waitForTimeout(400);
want(await page.evaluate(() => document.querySelector('.app').hasAttribute('data-split')), 'seed and Untitled split side by side');

// in seed: a new last line, made a tag, "2NR"
await page.locator('.split .pane').nth(0).locator('.ProseMirror :text("The needle finds")').click();
await caretAtEnd();
await page.keyboard.press('Enter');
await page.keyboard.press('F7');
await page.keyboard.type('2NR');
const sec = page.locator('.olp .ol-sec').nth(0);
await sec.locator('.lv button[data-lv="4"]').click();
await caretAtEnd();
await page.waitForTimeout(500); // typing paused: the outline caught up
const lit = await sec.locator('.sb-row.ol[data-on]').textContent();
want(/2NR/.test(lit ?? ''), `the 2NR row is lit: ${JSON.stringify(lit)}`);
const n0 = await sec.locator('.sb-row.ol').count();
await f.shot('before');

for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace', { delay: 15 });
await page.waitForTimeout(600);
await f.shot('after');
const crashed = await page.locator('text=Falcon hit a problem').count();
want(crashed === 0, 'no "Falcon hit a problem" screen');
want(errors.length === 0, `no page errors: ${JSON.stringify(errors)}`);
const n1 = await sec.locator('.sb-row.ol').count().catch(() => -1);
want(n1 === n0 - 1, `the outline drops the 2NR row: ${n0} -> ${n1}`);
want((await f.markMap()).trim().endsWith('The needle finds this line.'), 'seed ends at its last body line again');
await f.done();
