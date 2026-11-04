// The falcon on launch: Falcon starts on Home, the falcon sweeps in over it and lands on its perch above the
// date, and nothing on Home moves. A key lands it at once; the setting and Reduce motion skip the flight.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const URL = process.env.FALCON_URL;
const out = path.join(process.env.FALCON_EVIDENCE, 'launch-falcon');
fs.mkdirSync(out, { recursive: true });
const results = [];
const want = (ok, what) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`); return ok; };
const browser = await chromium.launch();
const errors = [];
/** A fresh start of the app on Home (no Escape, unlike openFalcon), with these stored settings. */
async function start(storage = {}) {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.evaluate((s) => { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, storage);
  await page.reload();
  await page.waitForSelector('.home.open .hm-perch');
  return page;
}
const flying = (page) => page.evaluate(() => !!document.querySelector('.falcon-flight svg'));
const perched = (page) => page.evaluate(() => !!document.querySelector('.hm-perch svg'));
/** Where Home's own parts sit: these must not move for the falcon. */
const layout = (page) => page.evaluate(() => ['.hm-perch', '.hm-title', '.hm-acts', '.hm-clock', '.hm-main']
  .map((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? `${s} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}` : `${s} missing`; }).join('\n'));

// 1. a normal launch: the flight, filmed
let page = await start();
want(await flying(page), 'the falcon is in flight right after launch');
const during = await layout(page);
const t0 = Date.now();
for (const t of [250, 600, 950, 1300, 1700, 1950, 2150, 2350, 2550, 2750, 2950, 3300]) {
  const w = t - (Date.now() - t0); if (w > 0) await page.waitForTimeout(w);
  await page.screenshot({ path: `${out}/flight-${String(t).padStart(4, '0')}.png` });
}
want(!(await flying(page)) && await perched(page), 'it lands on the perch and the flight layer is gone');
const after = await layout(page);
want(during === after, 'nothing on Home moved while it flew');
const perch = await page.evaluate(() => { const p = document.querySelector('.hm-perch').getBoundingClientRect(), t = document.querySelector('.hm-title').getBoundingClientRect(); return { right: Math.round(p.right), titleLeft: Math.round(t.left), mid: Math.round((p.top + p.bottom) / 2), words: Math.round((t.top + t.bottom) / 2) }; });
want(perch.right < perch.titleLeft && Math.abs(perch.mid - perch.words) < 6, `the logo sits left of the name, centered on it: ${JSON.stringify(perch)}`);
want(await page.evaluate(() => document.querySelector('.hm-title').textContent === 'Falcon' && !document.querySelector('.hm-date, .hm-sub')), 'Home says Falcon, with no date or file counts');
want(await page.evaluate(() => !document.querySelector('.hm-hi') && !/Good (morning|afternoon|evening)|Up late/.test(document.querySelector('.hm-head').textContent)), 'no greeting');
want(await page.evaluate(() => !!document.querySelector('.hm-perch svg.falcon-logo') && !document.querySelector('.hm-perch .falcon-bird')), 'what lands is the logo, not the flying bird');
await page.screenshot({ path: `${out}/perched.png`, clip: { x: 0, y: 0, width: 900, height: 330 } });

// 2. the same Home with the setting off: no flight, the falcon already perched, Home identical
page = await start({ 'falcon.launchFalcon': 'off' });
want(!(await flying(page)) && await perched(page), 'setting off: no flight, the falcon is perched from the start');
want(await layout(page) === after, 'Home is laid out exactly as with the setting on');

// 3. Reduce motion: no flight
page = await start({ 'falcon.reduceMotion': 'on' });
want(!(await flying(page)) && await perched(page), 'Reduce motion: no flight');

// 4. a key mid-flight lands it at once
page = await start();
await page.waitForTimeout(500);
await page.keyboard.press('Shift');
await page.waitForTimeout(120);
want(!(await flying(page)) && await perched(page), 'a key mid-flight lands it straight away');

fs.writeFileSync(`${out}/layout.txt`, after + '\n');
if (errors.length) results.push(`FAIL page errors: ${errors.join(' | ')}`);
fs.writeFileSync(`${out}/results.txt`, results.join('\n') + '\n');
console.log(results.join('\n') + `\nevidence: ${out}`);
await browser.close();
if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
