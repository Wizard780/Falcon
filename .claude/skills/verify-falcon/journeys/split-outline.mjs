// Three files split side by side: the outline gives each file its own part of the pane, and each part scrolls on
// its own, like CardMirror's (before, the whole stack scrolled as one list). Also: the speech doc key from the
// command center.
import { openFalcon } from '../lib/falcon.mjs';

const f = await openFalcon('split-outline', { viewport: { width: 1500, height: 820 } });
const { page, want } = f;
const big = (tag) => {
  let html = '';
  for (let b = 1; b <= 6; b++) { html += `<h3 class="f-block">${tag} block ${b}</h3>`; for (let t = 1; t <= 6; t++) html += `<h4 class="f-tag">${tag} tag ${b}.${t}</h4><p class="f-normal">text</p>`; }
  return html;
};
const paste = (html) => page.evaluate((html) => {
  const dt = new DataTransfer(); dt.setData('text/html', html); dt.setData('text/plain', 'x');
  window.__falconView.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, html);
const newDoc = async () => { await page.click('.tools [aria-label="New document"]'); await page.click('.cf .sa-mode:has-text("Blank Doc")'); await page.waitForTimeout(200); };
await page.click('.ProseMirror');
await paste(big('One'));
await newDoc(); await page.click('.ProseMirror'); await paste(big('Two'));
await newDoc(); await page.click('.ProseMirror'); await paste(big('Three'));
await page.waitForTimeout(300);
const rows = page.locator('.fs-docs .doc-row');
want((await rows.count()) === 3, 'three files open');
await rows.nth(0).locator('.doc-nm').click();
await rows.nth(1).locator('.doc-nm').click({ modifiers: ['Shift'] });
await rows.nth(2).locator('.doc-nm').click({ modifiers: ['Shift'] });
await page.mouse.move(900, 700);
await page.waitForTimeout(500);
if (!(await page.$('.olp.shown'))) await page.keyboard.press('Meta+\\');
await page.waitForSelector('.olp.shown[data-stack]');
for (const sec of await page.$$('.olp .ol-sec')) await (await sec.$('.lv [data-lv="4"]')).click();
await page.waitForTimeout(400);

const geo = () => page.evaluate(() => {
  const pane = document.querySelector('.olp .sb-scroll');
  return {
    pane: { scrolls: pane.scrollHeight > pane.clientHeight + 2, top: pane.scrollTop },
    secs: [...document.querySelectorAll('.olp .ol-sec')].map((s) => { const b = s.querySelector('.ol-body'); const r = s.getBoundingClientRect(); return { name: s.querySelector('.sb-label').textContent, h: Math.round(r.height), scrolls: b.scrollHeight > b.clientHeight + 2, top: Math.round(b.scrollTop) }; }),
  };
});
let g = await geo();
want(g.secs.length === 3 && g.secs.every((s) => s.scrolls) && !g.pane.scrolls, `each file's outline scrolls in its own part, the pane itself doesn't: ${JSON.stringify(g)}`);
want(Math.max(...g.secs.map((s) => s.h)) - Math.min(...g.secs.map((s) => s.h)) < 12, `the three parts share the height: ${g.secs.map((s) => s.h)}`);
// scroll the middle file's outline: only it moves (each starts at its own file's current heading)
const before = g.secs.map((s) => s.top);
const bodies = await page.$$('.olp .ol-sec .ol-body');
const box = await bodies[1].boundingBox();
await page.mouse.move(box.x + 60, box.y + box.height / 2);
await page.mouse.wheel(0, -600);
await page.waitForTimeout(400);
g = await geo();
want(g.secs[1].top !== before[1] && g.secs[0].top === before[0] && g.secs[2].top === before[2] && g.pane.top === 0, `scrolling the middle one scrolls only it: ${JSON.stringify(before)} -> ${JSON.stringify(g.secs.map((s) => s.top))}`);
// its header (name, 1-4) stays in view above its list
const head = await page.$eval('.olp .ol-sec:nth-child(2) .ol-head', (h) => { const r = h.getBoundingClientRect(), s = h.closest('.ol-sec').getBoundingClientRect(); return r.top >= s.top - 1 && r.bottom <= s.bottom; });
want(head, 'its name and 1-4 stay at the top of its part');
await f.shot('split-outline');

// the speech doc key, through the command center
await page.keyboard.press('Meta+Shift+Space');
await page.keyboard.type('speech doc, or stop');
await page.waitForTimeout(300);
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
const toast = await page.textContent('.toast').catch(() => '');
want(/is the speech doc now/.test(toast), `the command makes the open file the speech doc: ${toast}`);
await f.done();
