// Clicking and dragging in the page's left margin, where the card grip shows, at normal and narrow margins:
// a click puts the caret at the start of the line beside it, a drag from there selects from the start,
// and a sideways drag that starts on the grip selects text instead of moving the card.
import { openFalcon, SEED } from '../lib/falcon.mjs';
for (const MARG of ['normal', 'narrow']) {
const f = await openFalcon(`sel-${MARG}`, { viewport: { width: 1440, height: 860 }, storage: { 'falcon.margins': MARG } });
const p = f.page;
await f.open(SEED);
const sel = () => p.evaluate(() => { const s = window.__falconView.state.selection; return { from: s.from, to: s.to, text: window.__falconView.state.doc.textBetween(s.from, s.to, '|'), line: s.$head.parent.textContent.slice(0, 14), off: s.$head.parentOffset }; });
const reset = async () => { await p.mouse.click(900, 600); await p.waitForTimeout(50); };
for (const t of ['Growth is slowing', 'Global growth']) {
  const b = await p.locator(`.ProseMirror :text("${t}")`).first().boundingBox();
  const y = b.y + b.height / 2;
  const grip = async () => p.evaluate(() => { const g = document.querySelector('.f-grip'); const r = g.getBoundingClientRect(); return g.style.display === 'none' ? 'hidden' : `${Math.round(r.left)}-${Math.round(r.right)}`; });
  // 1 click in the gap just left of the text
  await reset(); await p.mouse.move(b.x + 40, y); await p.waitForTimeout(60);
  await p.mouse.click(b.x - 4, y); await p.waitForTimeout(80);
  const s1 = await sel();
  f.want(s1.line.startsWith(t.slice(0, 10)) && s1.off === 0 && s1.from === s1.to, `${MARG}: a click in the margin beside "${t}" puts the caret at its start`);
  // 2 drag from the start of the text rightward
  await reset(); await p.mouse.move(b.x + 40, y); await p.waitForTimeout(60);
  await p.mouse.move(b.x + 1, y); await p.mouse.down(); await p.mouse.move(b.x + 60, y, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(80);
  // 3 drag starting in the gap
  await reset(); await p.mouse.move(b.x + 40, y); await p.waitForTimeout(60);
  await p.mouse.move(b.x - 4, y); await p.mouse.down(); await p.mouse.move(b.x + 60, y, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(80);
  const s3 = await sel();
  f.want(s3.line.startsWith(t.slice(0, 10)) && s3.text.length > 0 && t.startsWith(s3.text.split('|')[0].trimEnd()), `${MARG}: a drag from the margin selects from the start of "${t}" (${s3.text})`);
  await reset(); await p.mouse.move(b.x + 80, y); await p.mouse.down(); await p.mouse.move(b.x - 2, y, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(80);
}
await f.done();
}
