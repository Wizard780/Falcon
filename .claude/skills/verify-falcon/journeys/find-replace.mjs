// Find from the tool row: the match is counted and selected; Replace all swaps every match in one
// undo step.
import { openFalcon, SEED, MOD } from '../lib/falcon.mjs';

const f = await openFalcon('find-replace');
const { page, want } = f;
await f.open(SEED);
await page.click('.tools [aria-label="Find"]');
want(await page.locator('.findbar').isVisible(), 'the Find button opens the find bar');
await page.fill('.findbar input[placeholder="Find"]', 'needle');
await page.waitForTimeout(300);
want((await page.textContent('.findbar .count')).trim() === '1/1', `counter reads 1/1 (${await page.textContent('.findbar .count')})`);
want(await page.evaluate(() => { const v = window.__falconView, s = v.state.selection; return v.state.doc.textBetween(s.from, s.to); }) === 'needle', 'the match is selected in the page');
await page.fill('.findbar input[placeholder="Find"]', 'Block');
await page.waitForTimeout(300);
want((await page.textContent('.findbar .count')).trim().endsWith('/2'), `"Block" counts two matches (${await page.textContent('.findbar .count')})`);
await f.shot('found');

await page.click('.findbar button[title^="Replace (⌘⇧H)"], .findbar button[title^="Replace (Ctrl+H)"]');
await page.fill('.findbar .fb-with', 'Section');
await page.click('.findbar button[title^="Replace all"]');
await page.waitForTimeout(300);
const map = await f.markMap();
want(map.includes('block: Economy Section') && map.includes('block: Warming Section') && !map.includes('Block'), 'Replace all changed both blocks');
await f.shot('replaced');
await page.keyboard.press('Escape');
await page.click('.ProseMirror');
await page.keyboard.press(`${MOD}+z`);
await page.waitForTimeout(200);
const undone = await f.markMap();
want(undone.includes('Economy Block') && undone.includes('Warming Block'), 'one undo restores both');
// Stepping scrolls the page to each match, even far off screen in a paragraph the window hasn't drawn.
// Setup only: a 3000-paragraph file built in the page, saved, and opened through Open… like any .docx.
await page.evaluate(() => {
  const v = window.__falconView, s = v.state.schema, hits = { 2: 'top', 1500: 'middle', 2900: 'bottom' };
  const filler = (i) => ` Filler for paragraph ${i}.` + ' More words here.'.repeat(i % 7);
  const ps = Array.from({ length: 3000 }, (_, i) => s.nodes.paragraph.create(null, s.text((hits[i] ? `quokka ${hits[i]}` : '') + filler(i))));
  v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, ps));
});
const big = await f.save('big.docx');
await f.open(big);
await page.click('.tools [aria-label="Find"]');
const where = () => page.evaluate(() => {
  const v = window.__falconView, sc = document.querySelector('.f-scroll'), s = v.state.selection;
  const r = v.coordsAtPos(s.from), box = sc.getBoundingClientRect();
  return { text: v.state.doc.resolve(s.from).parent.textContent.split(' ').slice(0, 2).join(' '), seen: r.top >= box.top && r.bottom <= box.bottom, top: Math.round(sc.scrollTop) };
});
// the match the next step lands on is in a paragraph the window hasn't drawn
const undrawn = (k) => page.evaluate((k) => { const v = window.__falconView; let i = -1; v.state.doc.forEach((n, _, j) => { if (n.textContent.startsWith(`quokka ${k}`)) i = j; }); return !v.dom.children[i].classList.contains('f-near'); }, k);
want(await undrawn('middle') && await undrawn('bottom'), 'the middle and bottom matches start in undrawn paragraphs');
await page.fill('.findbar input[placeholder="Find"]', 'quokka');
await page.waitForTimeout(300);
let w = await where();
want(w.seen && w.text === 'quokka top', `typing scrolls to the first match (${w.text}, scrollTop ${w.top})`);
for (const [key, k] of [['Enter', 'middle'], ['Enter', 'bottom'], ['Enter', 'top'], ['Shift+Enter', 'bottom'], ['Shift+Enter', 'middle']]) {
  const cold = await undrawn(k);
  await page.keyboard.press(key);
  await page.waitForTimeout(300);
  w = await where();
  want(w.seen && w.text === `quokka ${k}`, `${key} scrolls to the ${k} match${cold ? ' (was undrawn)' : ''} (scrollTop ${w.top})`);
}
await f.shot('scrolled-to-match');
await f.done();
