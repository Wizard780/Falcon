// Hover behavior: every button's tooltip, the hidden outline staying hidden, and the rail's doc
// icons opening the files panel. Usage: vite preview on :5190, then
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

// hovering the doc icons slides the files panel out: every open file by name, each row level with its icon
await page.mouse.move(700, 600);
await page.waitForTimeout(300);
const panelOpen = () => page.$eval('.files', (x) => x.hasAttribute('data-open') && getComputedStyle(x).pointerEvents === 'auto');
want(!(await panelOpen()), 'files panel closed at rest');
await page.screenshot({ path: `${shots}/4-rail-rest.png`, clip: { x: 0, y: 0, width: 520, height: 300 } });
const rows = await page.$$('.doc-row');
const r0 = await rows[0].boundingBox();
await page.mouse.move(r0.x + r0.width / 2, r0.y + r0.height / 2);
await page.waitForTimeout(80);
await page.screenshot({ path: `${shots}/5-panel-mid.png`, clip: { x: 0, y: 0, width: 520, height: 300 } });
await page.waitForTimeout(300);
want(await panelOpen(), 'hovering a doc icon opens the files panel');
const names = await page.$$eval('.files-r .nm', (xs) => xs.map((x) => x.textContent));
want(names.length === 2 && names[0].startsWith(base(a).slice(0, 12)) && names[1].startsWith(base(b).slice(0, 12)), `panel lists every open file by name: ${JSON.stringify(names)}`);
const level = await page.evaluate(() => {
  const icons = [...document.querySelectorAll('.doc-row')].map((x) => x.getBoundingClientRect());
  const rs = [...document.querySelectorAll('.files-r')].map((x) => x.getBoundingClientRect());
  return icons.map((r, i) => Math.abs(r.top - rs[i].top));
});
want(level.every((d) => d < 1), `each panel row is level with its icon: ${JSON.stringify(level)}`);
const on = await page.$eval('.files-r[data-on] .nm', (x) => x.textContent).catch(() => null);
want(on?.startsWith(base(b).slice(0, 12)), `the open file is lit: ${on}`);
await page.screenshot({ path: `${shots}/6-panel.png`, clip: { x: 0, y: 0, width: 520, height: 300 } });
// the pointer can cross from the rail into the panel and click a file there
const p0 = await page.$('.files-r >> nth=0');
const pb = await p0.boundingBox();
await page.mouse.move(pb.x + 60, pb.y + pb.height / 2, { steps: 8 });
await page.waitForTimeout(250);
want(await panelOpen(), 'panel stays open while the pointer moves into it');
await page.mouse.click(pb.x + 60, pb.y + pb.height / 2);
await page.waitForTimeout(250);
const on2 = await page.$eval('.files-r[data-on] .nm', (x) => x.textContent).catch(() => null);
want(on2?.startsWith(base(a).slice(0, 12)), `clicking a row switches to that file: ${on2}`);
await page.mouse.move(700, 600);
await page.waitForTimeout(400);
want(!(await panelOpen()), 'panel closes when the pointer leaves');
want(errors.length === 0, `no page errors ${errors.join(' | ')}`);
console.log(results.join('\n'));
await browser.close();
process.exit(results.some((x) => x.startsWith('FAIL')) ? 1 : 0);
