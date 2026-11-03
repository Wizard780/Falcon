// Enter and Backspace in a long file: the paragraph that was split or joined stays drawn. (Reported:
// Enter at the end of a body paragraph blanked that paragraph. window.ts mapped its near-screen mark
// through the edit, the split dropped it, and the next measure found the same range and never put it
// back, so content-visibility: hidden skipped the paragraph.)
// The caret moves by clicks only: in a headless page End/Home also smooth-scroll the page to its end.
import { openFalcon, SEED } from '../lib/falcon.mjs';

const f = await openFalcon('typing-new-paragraphs');
const { page } = f;
await f.open(SEED);

// a long file, like a real one: the near-screen range must end before the last paragraph
await f.select('The needle finds this line.');
await page.keyboard.press('ArrowRight');
for (let i = 1; i <= 400; i++) { await page.keyboard.press('Enter'); await page.keyboard.insertText(`filler ${i}`); }
// back to the top with the wheel, as a user scrolls, so the range is measured there
await page.mouse.move(700, 450);
const scrollY = () => page.evaluate(() => document.querySelector('.f-scroll').scrollTop);
for (let i = 0; i < 200 && (await scrollY()) > 0; i++) { await page.mouse.wheel(0, -3000); await page.waitForTimeout(30); }
await page.waitForTimeout(400);
f.want((await scrollY()) === 0, 'wheel scrolled back to the top');

const BODY = 'Global growth will fall to two percent next year.';
const para = (text) => page.locator('.f-page-text > *', { hasText: text }).first();
const clickEnd = async (text) => { const b = await para(text).boundingBox(); await page.mouse.click(b.x + b.width - 3, b.y + b.height / 2); };
const clickStart = async (text) => { const b = await para(text).boundingBox(); await page.mouse.click(b.x + 1, b.y + b.height / 2); };
/** Paragraphs among `texts` that the off-screen skip is hiding, one frame after the last key and again
 *  after a pause (the report: it stayed blank). */
const skipped = async (texts) => {
  const now = () => page.evaluate((texts) => [...document.querySelectorAll('.f-page-text > *')]
    .filter((el) => texts.includes(el.textContent) && getComputedStyle(el).contentVisibility === 'hidden').map((el) => el.textContent), texts);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  const first = await now();
  await page.waitForTimeout(400);
  return [...new Set([...first, ...(await now())])];
};

f.want((await skipped([BODY, 'Smith 24'])).length === 0, 'top of a long file drawn after scrolling back');

// the reported gesture: click at the end of a body paragraph, Enter
await clickEnd(BODY);
await page.keyboard.press('Enter');
let hid = await skipped([BODY]);
await f.shot('enter-at-end-of-body');
f.want(hid.length === 0, `paragraph Enter split at its end stays drawn (skipped: ${JSON.stringify(hid)})`);

// type on the new line, Enter, type more, then click away
await page.keyboard.type('first typed line');
await page.keyboard.press('Enter');
await page.keyboard.type('second typed line');
await clickEnd('Smith 24');
hid = await skipped([BODY, 'first typed line', 'second typed line']);
f.want(hid.length === 0, `typed lines stay drawn after the caret leaves (skipped: ${JSON.stringify(hid)})`);

// Backspace at the start of a line joins it onto the one above
await clickStart('second typed line');
await page.keyboard.press('Backspace');
await clickEnd('Smith 24');
hid = await skipped([BODY, 'first typed linesecond typed line']);
await f.shot('joined-caret-moved-away');
f.want(hid.length === 0, `joined line stays drawn after the caret leaves (skipped: ${JSON.stringify(hid)})`);

const text = await page.evaluate(() => window.__falconView.state.doc.textBetween(0, 300, '|'));
f.want(text.includes(`${BODY}|first typed linesecond typed line|`), `typed text in the document (${text.slice(60, 170)})`);
f.want((await scrollY()) < 50, 'page stayed at the top');
await f.done();
