// Same keystrokes against CardMirror (cm) or Falcon; screenshots the editor.
import { chromium } from 'playwright';
const which = process.argv[2] || 'cm';
const url = which === 'cm' ? 'http://localhost:5301/' : (process.argv[3] || 'http://localhost:5173/');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.on('console', m => { if (m.type()==='error') console.log('ERR', m.text()) });
p.on('pageerror', e => console.log('PAGEERR', e.message));
await p.goto(url);
await p.waitForTimeout(1500);
if (which === 'cm') {
  // (same keystrokes in both apps from here on)
  await p.keyboard.press('Escape');
  await p.getByText('New document', { exact: true }).first().click();
  await p.waitForTimeout(1000);
}
await p.locator('.ProseMirror').first().click();
await p.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a'); await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace');
const k = async (key, n=1) => { for (let i=0;i<n;i++) { await p.keyboard.press(key); await p.waitForTimeout(40); } };
const t = s => p.keyboard.type(s, { delay: 5 });
// select the nth occurrence of text inside the editor via a DOM range
const sel = (text) => p.evaluate((text) => {
  const root = document.querySelector('.ProseMirror');
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let full = '', nodes = [];
  while (w.nextNode()) { nodes.push([w.currentNode, full.length]); full += w.currentNode.data; }
  const i = full.indexOf(text); if (i < 0) throw new Error('no ' + text);
  const at = off => { for (const [n, s] of nodes) if (off >= s && off <= s + n.data.length) return [n, off - s]; };
  const r = document.createRange(); r.setStart(...at(i)); r.setEnd(...at(i + text.length));
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}, text).then(() => p.waitForTimeout(80));
await t('Grid DA'); await k('F6'); await p.waitForTimeout(100); await k('Enter'); await p.waitForTimeout(100);
await t('Data center demand overwhelms the grid and causes blackouts'); await k('F7'); await p.waitForTimeout(100); await k('Enter'); await p.waitForTimeout(100);
await t('Smith 24, Professor of Energy Policy at MIT, 3-14-2024, "The Coming Crunch," Energy Journal'); await k('Enter');
await t('The rapid expansion of artificial intelligence workloads has pushed utilities to their limits. Grid operators across the country warn that new data centers are consuming power faster than generation can be built, and that rolling blackouts are increasingly likely during summer peaks.');
await sel('Smith 24'); await k('F8');
await sel('pushed utilities to their limits'); await k('F9');
await sel('new data centers are consuming power faster than generation'); await k('F9');
await sel('rolling blackouts'); await k('F10');
await sel('utilities to their limits'); await k('F11');
await sel('consuming power faster'); await k('F11');
await sel('rolling blackouts'); await k('F11');
await sel('increasingly likely'); await k('F9');
await p.mouse.click(5, 5); 
await sel('summer'); 
await p.screenshot({ path: `shots/${which}-scenario-a.png` });
const html = await p.evaluate(() => document.querySelector('.ProseMirror').innerHTML.slice(0, 3000));
console.log(html);
await b.close();
