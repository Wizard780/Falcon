// Outline folds: a chevron opens only the heading it belongs to (not every heading with the same
// name), and a fast double-click on the chevron doesn't flicker it open-closed-open.
import { openFalcon, MOD } from '../lib/falcon.mjs';

const f = await openFalcon('outline-folds');
const { page, want } = f;
const k = (key) => page.keyboard.press(key);
await page.click('.ProseMirror');
await k(`${MOD}+a`); await k('Backspace');
const lines = [['Uniqueness', 'F5'], ['Main', 'F6'], ['U1', 'F7'], ['Answers', 'F6'], ['U2', 'F7'], ['Link', 'F5'], ['Main', 'F6'], ['L1', 'F7'], ['Impact', 'F5'], ['Main', 'F6'], ['I1', 'F7']];
for (const [i, [l]] of lines.entries()) { await page.keyboard.type(l); if (i < lines.length - 1) await k('Enter'); }
// style each heading from its own line (same-named lines: walk the doc by position, caret only)
const todo = await page.evaluate((lines) => {
  const v = window.__falconView; let i = 0; const todo = [];
  v.state.doc.forEach((n, pos) => { if (i < lines.length && n.textContent === lines[i][0]) { todo.push([pos + 1, lines[i][1]]); i++; } });
  return todo;
}, lines);
for (const [pos, key] of todo) {
  await page.evaluate((p) => { const v = window.__falconView; v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(p)))); }, pos);
  await k(key);
}
await page.waitForTimeout(400);
const rows = () => page.$$eval('.sb-row.ol', (r) => r.map((x) => `${x.className.match(/l\d/)[0]} ${x.querySelector('.nm').textContent.trim()}${x.getAttribute('aria-expanded') ? ' ' + x.getAttribute('aria-expanded') : ''}`));
let r = await rows();
want(r.length === 7 && r.filter((x) => x.startsWith('l3 Main')).length === 3, `depth 3 lists three Main blocks: ${JSON.stringify(r)}`);
await f.shot('before');
const mains = () => page.$$('.sb-row.ol.l3:has(.nm:text-is("Main")) [data-tw]');
let m = await mains();
await m[0].click();
await page.waitForTimeout(300);
r = await rows();
await f.shot('opened-one');
const openMains = r.filter((x) => x.startsWith('l3 Main') && x.endsWith('true'));
want(openMains.length === 1 && r.includes('l4 U1') && !r.includes('l4 L1') && !r.includes('l4 I1'), `only the Main under Uniqueness opened: ${JSON.stringify(r)}`);
m = await mains();
await m[0].click();
await page.waitForTimeout(300);
r = await rows();
want(!r.includes('l4 U1') && r.length === 7, `clicking the chevron again closes it: ${JSON.stringify(r)}`);
m = await mains();
await m[0].dblclick();
await page.waitForTimeout(300);
r = await rows();
await f.shot('after-dblclick');
want(!r.includes('l4 U1'), `double-clicking the chevron ends closed, no flicker back open: ${JSON.stringify(r)}`);
m = await mains();
await m[1].click();
await page.waitForTimeout(300);
r = await rows();
want(r.includes('l4 L1') && !r.includes('l4 U1') && !r.includes('l4 I1'), `only Link's Main opened: ${JSON.stringify(r)}`);
await f.shot('link-main');
await f.done();
