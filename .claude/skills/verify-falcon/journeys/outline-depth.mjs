// The outline's 1-4 buttons, as CardMirror has them: clicking a number always re-folds the outline to that level
// (the same number again too, closing what you opened by hand) and brings the heading you're in to the top of
// the list. The 1-4 buttons and the search box stay at the top while a long outline scrolls under them.
import { openFalcon } from '../lib/falcon.mjs';

const f = await openFalcon('outline-depth', { viewport: { width: 1400, height: 760 } });
const { page, want } = f;
// a big file: 4 pockets x 3 hats x 3 blocks x 4 tags, pasted as Falcon's own copy
let html = '';
for (let p = 1; p <= 4; p++) {
  html += `<h1 class="f-pocket">Pocket ${p}</h1>`;
  for (let h = 1; h <= 3; h++) {
    html += `<h2 class="f-hat">Hat ${p}.${h}</h2>`;
    for (let b = 1; b <= 3; b++) {
      html += `<h3 class="f-block">Block ${p}.${h}.${b}</h3>`;
      for (let t = 1; t <= 4; t++) html += `<h4 class="f-tag">Tag ${p}.${h}.${b}.${t}</h4><p class="f-normal">card text</p>`;
    }
  }
}
await page.click('.ProseMirror');
await page.evaluate((html) => {
  const dt = new DataTransfer();
  dt.setData('text/html', html); dt.setData('text/plain', 'x');
  window.__falconView.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, html);
await page.waitForTimeout(500);
if (!(await page.$('.olp.shown'))) await page.click('[aria-label*="utline"]').catch(() => {});
await page.waitForSelector('.olp.shown');
const rows = () => page.$$eval('.sb-row.ol', (r) => r.map((x) => x.querySelector('.nm').textContent.trim()));
const lv = (n) => page.click(`.lv [data-lv="${n}"]`);

await lv(2); await page.waitForTimeout(300);
let r = await rows();
want(r.length === 16 && !r.some((x) => x.startsWith('Block')), `2 shows pockets and hats only: ${r.length} rows`);
// open one hat by hand, then click 2 again: it folds back, like CardMirror
await page.click('.sb-row.ol.l2:has(.nm:text-is("Hat 3.2")) [data-tw]'); await page.waitForTimeout(300);
want((await rows()).includes('Block 3.2.1'), 'a hat opened by hand shows its blocks');
await lv(2); await page.waitForTimeout(300);
want(!(await rows()).includes('Block 3.2.1'), 'clicking 2 again folds it back');

// the caret deep in the file: picking a level brings its heading to the top of the list
await page.evaluate(() => {
  const v = window.__falconView; let at = -1;
  v.state.doc.forEach((n, pos) => { if (n.textContent === 'Tag 2.2.2.1') at = pos + 1; });
  v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(at))).scrollIntoView());
  v.focus();
});
await page.waitForTimeout(300);
await lv(4); await page.waitForTimeout(400);
const geo = await page.evaluate(() => {
  const s = document.querySelector('.olp .sb-scroll'), lit = document.querySelector('.sb-row.ol[data-on]'), top = document.querySelector('.ol-top');
  const st = s.getBoundingClientRect(), lt = lit.getBoundingClientRect(), tt = top.getBoundingClientRect();
  return { lit: lit.querySelector('.nm').textContent, litTop: Math.round(lt.top - st.top), headBottom: Math.round(tt.bottom - st.top), scrolled: Math.round(s.scrollTop) };
});
want(geo.lit === 'Tag 2.2.2.1' && geo.scrolled > 0 && geo.litTop >= geo.headBottom && geo.litTop - geo.headBottom < 40, `4 brings the heading you're in to the top, under the buttons: ${JSON.stringify(geo)}`);
// the 1-4 buttons stay in view while the list is scrolled
const pinned = await page.evaluate(() => {
  const s = document.querySelector('.olp .sb-scroll'), b = document.querySelector('.lv [data-lv="1"]');
  return Math.round(b.getBoundingClientRect().top - s.getBoundingClientRect().top);
});
want(pinned >= 0 && pinned < 20, `the 1-4 buttons stay at the top of the pane while it's scrolled: ${pinned}px from the top`);
await f.shot('scrolled-pinned');
// and they're clickable there
await lv(3); await page.waitForTimeout(300);
r = await rows();
want(!r.some((x) => x.startsWith('Tag')) && r.length === 4 + 12 + 36, `3 from the scrolled list shows down to blocks: ${r.length} rows`);
await lv(1); await page.waitForTimeout(300);
want((await rows()).length === 4, '1 shows pockets only');
await f.done();
