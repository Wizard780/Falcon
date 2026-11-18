// Rail on the desktop app: the window drags from the rail's empty space, but never from among the file icons. A drag
// spot there (the gaps between icons, a joined capsule's edge) swallows the click and takes the pointer from the page,
// so the files panel shuts under it and switching files (say, back to a split) misses. Checked by app-region per point.
import { openFalcon } from '../lib/falcon.mjs';
const f = await openFalcon('rail-drag');
const p = f.page;
await p.setViewportSize({ width: 1470, height: 900 });
for (let i = 0; i < 4; i++) { await p.click('.tools [aria-label="New document"]'); await p.click('.cf .sa-mode:has-text("Blank Doc")'); await p.keyboard.type('Doc ' + i); }
const tabs = p.locator('.fs-docs .doc-row .doc-nm');
await tabs.nth(0).click(); await tabs.nth(1).click({ modifiers: ['Shift'] }); await tabs.nth(2).click({ modifiers: ['Shift'] });
await tabs.nth(3).click(); await p.mouse.move(900, 600); await p.waitForTimeout(400);
await p.evaluate(() => document.documentElement.classList.add('desktop', 'mac'));
await p.waitForTimeout(200);
// a point drags the window when the nearest element (or ancestor) with an app-region says drag
const r = await p.evaluate(() => {
  const list = document.querySelector('.fs-docs'), rows = [...list.querySelectorAll('.doc-row')];
  const lb = list.getBoundingClientRect(), top = Math.max(lb.top, rows[0].getBoundingClientRect().top - 6), bottom = Math.min(lb.bottom - 1, rows.at(-1).getBoundingClientRect().bottom + 6);
  const xs = [...new Set(rows.map((row) => { const b = row.querySelector('.doc-nm').getBoundingClientRect(); return [b.left + 3, b.left + b.width / 2, b.right - 3]; }).flat().map(Math.round))];
  const drag = [];
  for (let y = Math.round(top); y <= bottom; y += 1) for (const x of xs) {
    let e = document.elementFromPoint(x, y), reg = 'none';
    while (e && reg === 'none') { reg = getComputedStyle(e).getPropertyValue('-webkit-app-region') || 'none'; if (reg === 'none') e = e.parentElement; }
    if (reg === 'drag') drag.push([x, y]);
  }
  return { checked: xs.length * Math.round(bottom - top), drag: drag.length, sample: drag.slice(0, 6) };
});
f.want(r.drag === 0, `no window-drag spots among the file icons (${r.drag} of ${r.checked} points drag the window: ${JSON.stringify(r.sample)})`);
// and the rail still drags the window from its empty space below the icons
const below = await p.evaluate(() => { const g = document.querySelector('.fstrip .grow').getBoundingClientRect(); let e = document.elementFromPoint(g.left + g.width / 2, g.top + g.height / 2), reg = 'none'; while (e && reg === 'none') { reg = getComputedStyle(e).getPropertyValue('-webkit-app-region') || 'none'; if (reg === 'none') e = e.parentElement; } return reg; });
f.want(below === 'drag', `the rail's empty space still moves the window: ${below}`);
await f.done();
