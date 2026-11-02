// Hover behavior: every button's tooltip, the hidden outline staying hidden, and a doc in the rail
// growing into a pill with its name. Usage: vite preview on :5190, then
//   node scripts/hover-check.mjs <a.docx> <b.docx> [shots dir]
import { chromium } from 'playwright';

const [a, b, shots = '/tmp/fhover'] = process.argv.slice(2);
const base = (f) => f.split('/').pop().replace(/\.docx$/i, '');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5190/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.ProseMirror');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

const results = [];
const want = (ok, what) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const tipText = () => page.$eval('.tip', (t) => t.innerText.replace(/\s+/g, ' ').trim()).catch(() => null);
const open = async (file) => {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.tools [aria-label="Open…"]')]);
  await fc.setFiles(file);
  await page.waitForTimeout(500);
};
await open(a);
await open(b);

// a tooltip under a button: name, key, and what it does
await page.hover('.tools [aria-label="Outline"]');
want(await tipText() === null, 'no tooltip before the delay');
await page.waitForTimeout(450);
let t = await tipText();
want(t?.startsWith('Outline') && t.includes('show or hide'), `Outline button explains itself: ${t}`);
want(await page.$eval('.tools [aria-label="Outline"]', (x) => !x.hasAttribute('title')), 'native title is gone, so the slow system tooltip never shows');
await page.screenshot({ path: `${shots}/1-tip-outline.png`, clip: { x: 0, y: 0, width: 700, height: 260 } });

// sliding to the next button shows its tip at once
await page.hover('.tools [aria-label="Find"]');
await page.waitForTimeout(60);
t = await tipText();
want(t?.startsWith('Find'), `moving to the next button swaps the tip at once: ${t}`);

const toolbarTips = [];
for (const label of ['Pocket', 'Hat', 'Block', 'Tag', 'Analytic', 'Undertag', 'Cite', 'Underline', 'Emphasis', 'Clear', 'Shrink', 'Read']) {
  await page.mouse.move(700, 600);
  await page.waitForTimeout(500);
  await page.hover(`.toolbar .b:has-text("${label}")`);
  await page.waitForTimeout(450);
  const x = await tipText();
  toolbarTips.push(x);
  want(x?.startsWith(label) && x.includes(':') === false && x.length > label.length + 8, `${label}: ${x}`);
}
await page.hover('.toolbar .b:has-text("Pocket")');
await page.waitForTimeout(450);
await page.screenshot({ path: `${shots}/2-tip-pocket.png`, clip: { x: 300, y: 0, width: 1100, height: 260 } });
// clicking hides it
await page.mouse.down(); await page.mouse.up();
want(await tipText() === null, 'clicking a button hides its tip');

// clicking Bigger changes its title ("now 12 pt"); the native title must not come back
await page.mouse.move(700, 600); await page.waitForTimeout(500);
await page.hover('.toolbar .b.sz >> nth=0');
await page.waitForTimeout(450);
const before = await page.$eval('.toolbar .b.sz', (x) => x.dataset.tip);
await page.mouse.down(); await page.mouse.up();
await page.waitForTimeout(300);
const after = await page.$eval('.toolbar .b.sz', (x) => ({ title: x.getAttribute('title'), tip: x.dataset.tip }));
want(after.title === null && after.tip !== before, `Bigger after a click: no native title, tip text updated (${before} -> ${after.tip})`);

// the outline hidden: no strip, nothing to hover, the page against the rail
await page.mouse.move(700, 600);
await page.click('.tools [aria-label="Outline"]');
await page.waitForTimeout(400);
want(await page.$('.olt') === null && await page.$('.rail-tick') === null, 'no tick strip when the outline is hidden');
const strip = await page.$eval('.fstrip', (x) => x.getBoundingClientRect().right);
await page.mouse.move(strip + 6, 500);
await page.waitForTimeout(400);
want(await page.$eval('.olp', (x) => getComputedStyle(x).opacity === '0' && getComputedStyle(x).pointerEvents === 'none'), 'hovering the left edge does not peek the outline');
await page.screenshot({ path: `${shots}/3-outline-hidden-hover.png` });
await page.click('.tools [aria-label="Outline"]');
await page.waitForTimeout(400);
want(await page.$eval('.olp', (x) => getComputedStyle(x).opacity === '1'), 'outline button brings it back');

// a doc in the rail grows into a pill with its name
await page.mouse.move(700, 600);
await page.waitForTimeout(300);
const rows = await page.$$('.doc-row');
const r0 = await rows[0].boundingBox();
await page.mouse.move(r0.x + r0.width / 2 - 6, r0.y + r0.height / 2 + 6);
await page.waitForTimeout(120);
await page.screenshot({ path: `${shots}/4-pill-mid.png`, clip: { x: 0, y: 0, width: 520, height: 260 } });
await page.waitForTimeout(300);
const pill = await page.$eval('.doc-tip', (x) => ({ text: x.innerText.trim(), left: x.getBoundingClientRect().left, top: x.getBoundingClientRect().top, w: x.getBoundingClientRect().width })).catch(() => null);
want(pill?.text.startsWith(base(a).slice(0, 12)), `hovered doc shows its name: ${pill?.text}`);
want(pill && Math.abs(pill.left - r0.x) < 1 && Math.abs(pill.top - r0.y) < 1 && pill.w > r0.width + 40, `the pill grows out of the doc button itself: ${JSON.stringify(pill)} vs ${JSON.stringify(r0)}`);
await page.screenshot({ path: `${shots}/5-pill.png`, clip: { x: 0, y: 0, width: 520, height: 260 } });
const r1 = await rows[1].boundingBox();
await page.mouse.move(r1.x + r1.width / 2 - 6, r1.y + r1.height / 2 + 6);
await page.waitForTimeout(400);
const pill2 = await page.$eval('.doc-tip', (x) => x.innerText.trim()).catch(() => null);
want(pill2?.startsWith(base(b).slice(0, 12)), `second doc shows its own name: ${pill2}`);
await page.mouse.move(700, 600);
await page.waitForTimeout(200);
want(await page.$('.doc-tip') === null, 'pill goes away when the pointer leaves');

want(errors.length === 0, `no page errors ${errors.join(' | ')}`);
console.log(results.join('\n'));
await browser.close();
process.exit(results.some((x) => x.startsWith('FAIL')) ? 1 : 0);
