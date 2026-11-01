// Ctrl/Cmd-click multi-selection against CardMirror (cm) or Falcon: formats several stretches at once.
import { chromium } from 'playwright';
const which = process.argv[2] || 'falcon';
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
await p.goto(which === 'cm' ? 'http://localhost:5301/' : (process.env.FALCON_URL || 'http://localhost:5173/')); await p.waitForTimeout(1500);
if (which === 'cm') { await p.keyboard.press('Escape'); await p.getByText('New document', { exact: true }).first().click(); await p.waitForTimeout(1000); }
else { await p.keyboard.press('Escape'); await p.waitForTimeout(400); } // close Home
await p.locator('.ProseMirror').first().click();
await p.keyboard.press(`${mod}+a`); await p.keyboard.press('Backspace');
await p.keyboard.type('Grid tag'); await p.keyboard.press('F7'); await p.waitForTimeout(150); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
await p.keyboard.type('The rapid expansion of artificial intelligence workloads has pushed utilities to their limits.');
const box = (text, off = 0) => p.evaluate(([text, off]) => {
  const w = document.createTreeWalker(document.querySelector('.ProseMirror'), NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const i = w.currentNode.data.indexOf(text); if (i >= 0) { const r = document.createRange(); r.setStart(w.currentNode, i + off); r.setEnd(w.currentNode, i + off + 1); const b = r.getBoundingClientRect(); return { x: b.left + 1, y: b.top + b.height / 2 }; } }
}, [text, off]);
const map = () => p.evaluate(() => {
  if (window.__falconMarkMap) return window.__falconMarkMap().split('\n')[1];
  const para = document.querySelectorAll('.ProseMirror p')[0]; let out = '';
  const w = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const c = w.currentNode.parentElement.closest('.pmd-underline,.pmd-highlight,.pmd-emphasis'); out += c && c !== para ? `[${w.currentNode.data}]` : w.currentNode.data; }
  return out;
});
const click = async (t, o, mods = []) => { const a = await box(t, o); for (const m of mods) await p.keyboard.down(m); await p.mouse.click(a.x, a.y); for (const m of mods) await p.keyboard.up(m); await p.waitForTimeout(60); };
const out = {};
// plain click, then Cmd-click two more words → three stretches → F9
await click('rapid', 1); await p.mouse.dblclick((await box('rapid', 1)).x, (await box('rapid', 1)).y);
await click('artificial', 3, [mod]); await click('utilities', 2, [mod]);
await p.keyboard.press('F9'); await p.waitForTimeout(100);
out.cmdClickWordsF9 = await map();
// Cmd-click a selected stretch drops it: select three, drop the middle, F11
await click('expansion', 1); await p.mouse.dblclick((await box('expansion', 1)).x, (await box('expansion', 1)).y);
await click('workloads', 2, [mod]); await click('limits', 2, [mod]); await click('workloads', 3, [mod]);
await p.keyboard.press('F11'); await p.waitForTimeout(100);
out.dropMiddleThenF11 = await map();
// Cmd-drag adds exactly the dragged characters
await click('The', 1);
const a = await box('intelligence', 2), z = await box('intelligence', 7);
await p.keyboard.down(mod); await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(z.x, z.y, { steps: 5 }); await p.mouse.up(); await p.keyboard.up(mod);
out.cmdDragChars = JSON.stringify(await p.evaluate(() => getSelection().toString()));
console.log(JSON.stringify(out, null, 1));
await b.close();
