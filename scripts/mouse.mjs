// Mouse gestures against CardMirror (cm) or Falcon: reports the selected text after each.
import { chromium } from 'playwright';
const which = process.argv[2] || 'falcon';
const url = which === 'cm' ? 'http://localhost:5301/' : (process.env.FALCON_URL || 'http://localhost:5173/');
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
await p.goto(url); await p.waitForTimeout(1500);
if (which === 'cm') { await p.keyboard.press('Escape'); await p.getByText('New document', { exact: true }).first().click(); await p.waitForTimeout(1000); }
else { await p.keyboard.press('Escape'); await p.waitForTimeout(400); } // close Home
await p.locator('.ProseMirror').first().click();
await p.keyboard.press(`${MOD}+a`); await p.keyboard.press('Backspace');
await p.keyboard.type('The rapid expansion of artificial intelligence workloads has pushed utilities to their limits.');
await p.keyboard.press('Enter');
await p.keyboard.type('Second paragraph of body text here.');
await p.keyboard.press('Enter');
await p.keyboard.type('Allies across the globe, had an impact on trade.');
// pixel box of a substring
const box = (text, off = 0) => p.evaluate(([text, off]) => {
  const root = document.querySelector('.ProseMirror');
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const i = w.currentNode.data.indexOf(text); if (i >= 0) { const r = document.createRange(); r.setStart(w.currentNode, i + off); r.setEnd(w.currentNode, i + off + 1); const b = r.getBoundingClientRect(); return { x: b.left + 1, y: b.top + b.height / 2 }; } }
}, [text, off]);
const selected = () => p.evaluate(() => getSelection().toString());
const out = {};
let a = await box('expansion', 3), z = await box('expansion', 6);
await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(z.x, z.y, { steps: 5 }); await p.mouse.up();
out.dragInsideWord = await selected();
a = await box('expansion', 3); z = await box('intelligence', 4);
await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(z.x, z.y, { steps: 8 }); await p.mouse.up();
out.dragAcrossWords = await selected();
a = await box('pushed', 4); z = await box('artificial', 2);
await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(z.x, z.y, { steps: 8 }); await p.mouse.up();
out.dragBackward = await selected();
a = await box('artificial', 4);
await p.mouse.dblclick(a.x, a.y); out.doubleClick = await selected();
await p.mouse.click(a.x, a.y, { clickCount: 3 }); out.tripleClick = (await selected()).trim();
a = await box('rapid', 2); await p.mouse.click(a.x, a.y);
z = await box('utilities', 3); await p.keyboard.down('Shift'); await p.mouse.click(z.x, z.y); await p.keyboard.up('Shift');
out.shiftClickChar = await selected();
a = await box('rapid', 2); await p.mouse.dblclick(a.x, a.y);
z = await box('utilities', 3); await p.keyboard.down('Shift'); await p.mouse.click(z.x, z.y); await p.keyboard.up('Shift');
out.shiftClickAfterDouble = await selected();
a = await box('rapid', 2); await p.mouse.click(a.x, a.y); await p.mouse.down(); await p.mouse.up();
out.clickCaret = JSON.stringify(await selected());
// a press on a word's edge, dragged away from that word, leaves the word out
const drag = async (from, to) => { await p.mouse.move(from.x, from.y); await p.mouse.down(); await p.mouse.move(to.x, to.y, { steps: 4 }); await p.mouse.up(); return selected(); };
const edge = {
  endToComma: [await drag(await box('globe,', 5), await box('globe,', 6)), ','],
  commaBackToEnd: [await drag(await box('globe,', 6), await box('globe,', 5)), ','],
  endAcrossWords: [await drag(await box('globe,', 5), await box('impact', 3)), ', had an impact'],
  endOntoSpace: [await drag(await box('Second ', 6), await box('paragraph', 0)), ' '],
  startOntoSpace: [await drag(await box('paragraph', 0), await box('Second ', 6)), ' '],
  startAcrossWords: [await drag(await box('paragraph', 0), await box('Second', 2)), 'Second '],
};
a = await box('globe,', 5); await p.mouse.click(a.x, a.y);
z = await box('impact', 3); await p.keyboard.down('Shift'); await p.mouse.click(z.x, z.y); await p.keyboard.up('Shift');
edge.shiftFromEnd = [await selected(), ', had an impact'];
for (const [k, [got, want]] of Object.entries(edge)) if (got !== want) { console.log(`EDGE ${k}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); process.exitCode = 1; }
console.log(JSON.stringify(out, null, 1));
if (which !== 'cm') {
  const fs = await import('node:fs');
  const cm = JSON.parse(fs.readFileSync('tests/cardmirror/mouse.json', 'utf8'));
  const diffs = Object.keys(cm).filter((k) => cm[k] !== out[k]);
  console.log(diffs.length ? `MOUSE DIFFERS from CardMirror: ${diffs.join(', ')}` : `mouse: all ${Object.keys(cm).length} gestures match CardMirror`);
  if (diffs.length) process.exitCode = 1;
}
await b.close();
