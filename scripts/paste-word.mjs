// Pastes Word clipboard HTML (tests/fixtures/word-clipboard.html) through the browser's real paste event.
import { chromium } from 'playwright';
import fs from 'node:fs';
const html = fs.readFileSync('tests/fixtures/word-clipboard.html', 'utf8');
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const b = await chromium.launch(); const p = await b.newPage();
await p.goto(process.env.FALCON_URL || 'http://localhost:5173/'); await p.waitForSelector('.ProseMirror'); await p.keyboard.press('Escape'); await p.waitForTimeout(400); // close Home
await p.locator('.ProseMirror').click(); await p.keyboard.press(`${MOD}+a`); await p.keyboard.press('Backspace');
await p.evaluate((html) => {
  const dt = new DataTransfer();
  dt.setData('text/html', html);
  dt.setData('text/plain', 'plain fallback');
  document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, html);
await p.waitForTimeout(200);
const map = await p.evaluate(() => window.__falconMarkMap());
console.log(map);
const want = [
  'tag: Data centers cause blackouts',
  'normal: [Smith 24]{cite}, Professor at MIT, "The Crunch"',
  // the 8pt (shrunk) card text keeps its size
  'normal: [The rapid expansion of AI has ]{size:8pt}[pushed utilities]{highlight:yellow+underline}[ to their limits]{underline}[ and ]{size:8pt}[rolling blackouts]{emphasis+highlight:cyan}[ loom.]{size:8pt}',
];
const ok = want.every((line) => map.split('\n').includes(line));
console.log(ok ? 'Word paste: structure, cite, underline, emphasis, highlights and shrunk text all kept' : 'WORD PASTE MISMATCH');
if (!ok) process.exitCode = 1;
await b.close();
