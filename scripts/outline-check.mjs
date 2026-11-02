// Clicks every outline row (depth 4) in a headless browser and checks the lit row is the one clicked,
// then scrolls away and checks the highlight follows. Usage: vite preview on :5190, then
//   node scripts/outline-check.mjs <file.docx>
import { chromium } from 'playwright';
const file = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('http://localhost:5190/');
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('falcon.depth', '4'); }); await page.reload();
await page.waitForSelector('.ProseMirror'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.tools [aria-label="Open…"]')]);
await fc.setFiles(file); await page.waitForTimeout(800);
const n = await page.$$eval('.sb-row.ol', (r) => r.length);
let bad = [];
const order = [...Array(n).keys()];
for (const k of [...order, ...order.reverse()]) {
  const rows = await page.$$('.sb-row.ol'); if (k >= rows.length) continue;
  const want = await rows[k].getAttribute('data-i');
  await rows[k].dispatchEvent('mousedown'); await page.waitForTimeout(900);
  const lit = await page.$eval('.sb-row.ol[data-on]', (r) => r.getAttribute('data-i')).catch(() => null);
  if (lit !== want) bad.push(`row ${k} (i=${want}) lit ${lit}`);
}
// scrolling far from the cursor still moves the highlight
const before = await page.$eval('.sb-row.ol[data-on]', (r) => r.getAttribute('data-i'));
await page.$eval('.f-scroll', (s) => (s.scrollTop = s.scrollHeight / 2)); await page.waitForTimeout(400);
const after = await page.$eval('.sb-row.ol[data-on]', (r) => r.getAttribute('data-i'));
if (bad.length || before === after) process.exitCode = 1;
console.log(`rows ${n}, mismatches ${bad.length}`, bad.slice(0, 8), `| scroll-follow: ${before} -> ${after}`);
await browser.close();
