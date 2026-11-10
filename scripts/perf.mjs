// Falcon performance bench: serves a built dist/ (gzip, like a real host) and measures it in headless Chromium.
//   node scripts/perf.mjs <dist> <out.json> <file.docx...>   (RUNS=5 by default)
// Per file: open (first screen painted, fully settled), typing in the middle (latency and main-thread CPU per key),
// save freeze, JS heap. Once per build: bundle bytes, cold load on a slow 3G link, idle CPU (editor and Home).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { gzipSync } from 'node:zlib';

const [dist, out, ...files] = process.argv.slice(2);
const RUNS = Number(process.env.RUNS ?? 5);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const gz = new Map();
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(dist, p);
  if (!existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
  const type = TYPES[extname(f)] ?? 'application/octet-stream';
  let body = readFileSync(f);
  const headers = { 'content-type': type, 'cache-control': p.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' };
  if (/text|javascript|svg|json|manifest/.test(type)) { if (!gz.has(f)) gz.set(f, gzipSync(body, { level: 9 })); body = gz.get(f); headers['content-encoding'] = 'gzip'; }
  res.writeHead(200, headers); res.end(body);
});
await new Promise((r) => server.listen(0, r));
const URL0 = `http://localhost:${server.address().port}/`;

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const browser = await chromium.launch();

async function freshPage() {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  // no first-run Home or tips, so every run starts on the editor
  await ctx.addInitScript(() => { try { localStorage.setItem('falcon.tips.v1', '{"seen":true}'); } catch {} });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('PAGEERR', e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  return { ctx, page, cdp };
}
const metrics = async (cdp) => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
// Rendering work off the main thread's script: a trace over `fn`, summed by event name (ms).
// paint = the main thread drawing (pre-paint, paint, layerize, commit); gpu = raster tasks plus the GPU process's tasks.
const PAINT = new Set(['PrePaint', 'Paint', 'Layerize', 'Commit', 'UpdateLayerTree']);
const GPU = new Set(['RasterTask', 'GPUTask', 'ImageDecodeTask']);
const LAYOUT = new Set(['Layout', 'UpdateLayoutTree']);
async function traced(page, fn) {
  await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'gpu'] });
  await fn();
  const events = JSON.parse((await browser.stopTracing()).toString()).traceEvents;
  let paint = 0, gpu = 0, layout = 0, frames = 0;
  for (const e of events) {
    if (e.ph !== 'X') { if (e.name === 'DrawFrame') frames++; continue; }
    const ms = (e.dur ?? 0) / 1000;
    if (PAINT.has(e.name)) paint += ms; else if (GPU.has(e.name)) gpu += ms; else if (LAYOUT.has(e.name)) layout += ms;
  }
  return { paint, gpu, layout, frames };
}
const heapAfterGc = async (cdp) => { await cdp.send('HeapProfiler.collectGarbage'); return (await metrics(cdp)).JSHeapUsedSize / 1048576; };
const settle = (page) => page.evaluate(async () => {
  // fully settled: no main-thread task over 20 ms for 300 ms
  let last = performance.now();
  for (;;) {
    const a = performance.now();
    await new Promise((r) => setTimeout(r, 50));
    if (performance.now() - a - 50 > 20) last = performance.now();
    if (performance.now() - last > 300) return last;
  }
});
async function editorReady(page) {
  await page.goto(URL0, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__falconView);
  // close Home if it opened
  if (await page.locator('.home.open').count()) { await page.keyboard.press('Escape'); }
  await settle(page);
}

async function openChooser(page) {
  // Cmd-O can land before the page has focus: try again
  let chooser = null;
  for (let i = 0; i < 4 && !chooser; i++) {
    if (await page.locator('.home.open').count()) await page.keyboard.press('Escape');
    chooser = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), page.keyboard.press('Meta+o')]).then(([c]) => c, () => null);
  }
  if (!chooser) throw new Error('no file chooser');
  return chooser;
}
async function openRun(file) {
  const { ctx, page, cdp } = await freshPage();
  await editorReady(page);
  const chooser = await openChooser(page);
  const before = await page.evaluate(() => window.__falconView.state.doc);
  await page.evaluate(() => { window.__t0 = performance.now(); });
  // first screen: the editor shows the new doc's first paragraphs and a frame has painted
  const first = page.evaluate(async () => {
    const pm = document.querySelector('.ProseMirror');
    const start = performance.now();
    for (;;) {
      if (pm.childElementCount > 20 && window.__falconView.state.doc.childCount > 20) break;
      if (performance.now() - start > 120000) return -1;
      await new Promise((r) => setTimeout(r, 2));
    }
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    return performance.now() - window.__t0;
  });
  await chooser.setFiles(file);
  const firstMs = await first;
  const settled = await settle(page);
  const settledMs = settled - (await page.evaluate(() => window.__t0));
  const blocks = await page.evaluate(() => window.__falconView.state.doc.childCount);
  void before;
  // typing in the middle of the doc: real key presses, timed to the next frame, and the main thread's CPU per key
  await page.evaluate(() => {
    const v = window.__falconView, S = v.state.selection.constructor;
    v.dispatch(v.state.tr.setSelection(S.near(v.state.doc.resolve(Math.floor(v.state.doc.content.size / 2)))).scrollIntoView());
    v.focus();
  });
  await settle(page);
  const lat = [];
  const m0 = await metrics(cdp);
  const KEYS = 30;
  for (let i = 0; i < KEYS; i++) {
    await page.evaluate(() => { window.__k = performance.now(); });
    await page.keyboard.press('x');
    lat.push(await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(() => r(performance.now() - window.__k), 0)))));
  }
  await page.waitForTimeout(400); // the debounced outline refresh after the last key counts too
  const m1 = await metrics(cdp);
  const cpuPerKey = ((m1.TaskDuration - m0.TaskDuration) * 1000) / KEYS;
  const scriptPerKey = ((m1.ScriptDuration - m0.ScriptDuration) * 1000) / KEYS;
  const heapMB = await heapAfterGc(cdp);
  const domNodes = (await metrics(cdp)).Nodes;
  // scrolling: main-thread CPU per frame while the page scrolls 400px a frame for 90 frames
  await settle(page);
  const s0 = await metrics(cdp);
  const FRAMES = 90;
  const scroll = () => page.evaluate(async (n) => {
    const sc = document.querySelector('.f-scroll');
    sc.scrollTop = 0;
    for (let i = 0; i < n; i++) { sc.scrollTop += 400; await new Promise((r) => requestAnimationFrame(r)); }
  }, FRAMES);
  await scroll();
  const s1 = await metrics(cdp);
  const cpuPerScrollFrame = ((s1.TaskDuration - s0.TaskDuration) * 1000) / FRAMES;
  // the same scroll again under a trace (tracing itself costs CPU, so it's kept out of the number above)
  await settle(page);
  const tr = await traced(page, scroll);
  const paintPerScrollFrame = tr.paint / FRAMES, gpuPerScrollFrame = tr.gpu / FRAMES;
  // save: how long the window is frozen (the longest main-thread block while saving)
  await settle(page);
  const freeze = await page.evaluate(async () => {
    let worst = 0, last = performance.now(), on = true;
    const tick = () => { const n = performance.now(); worst = Math.max(worst, n - last); last = n; if (on) setTimeout(tick, 0); };
    setTimeout(tick, 0);
    return new Promise((resolve) => {
      const orig = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        HTMLAnchorElement.prototype.click = orig;
        const done = performance.now();
        setTimeout(() => { on = false; resolve({ worst, total: done - window.__s0 }); }, 50);
      };
      window.__s0 = performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', metaKey: true, ctrlKey: !/Mac/.test(navigator.platform), bubbles: true, cancelable: true }));
    });
  });
  await ctx.close();
  lat.sort((a, b) => a - b);
  return { firstMs, settledMs, blocks, keyMedian: lat[KEYS >> 1], keyP90: lat[Math.floor(KEYS * 0.9)], cpuPerKey, scriptPerKey, cpuPerScrollFrame, paintPerScrollFrame, gpuPerScrollFrame, heapMB, domNodes, saveFreeze: freeze.worst, saveTotal: freeze.total };
}

async function multi(list) {
  // many files at once: open every file in one window, then sit idle, then walk the tabs
  const { ctx, page, cdp } = await freshPage();
  await editorReady(page);
  const t0 = Date.now();
  const m0 = await metrics(cdp);
  for (const f of list) {
    const chooser = await openChooser(page);
    const name = basename(f).replace(/\.docx$/, '');
    await chooser.setFiles(f);
    await page.waitForFunction((n) => document.querySelector(`.doc-nm[aria-label="${n}"]`) && window.__falconView.state.doc.childCount > 20, name, { timeout: 120000 });
    await settle(page);
  }
  const openAllMs = Date.now() - t0;
  const m1 = await metrics(cdp);
  const openAllCpu = (m1.TaskDuration - m0.TaskDuration) * 1000;
  const heapMB = await heapAfterGc(cdp);
  const domNodes = (await metrics(cdp)).Nodes;
  await page.waitForTimeout(1500);
  const a = await metrics(cdp);
  let idleTrace;
  idleTrace = await traced(page, () => page.waitForTimeout(5000));
  const b = await metrics(cdp);
  const idleMsPerSec = ((b.TaskDuration - a.TaskDuration) * 1000) / 5;
  // tab switches: click each open file's row twice round; time to the frame that shows it, and the CPU it took
  const names = list.map((f) => basename(f).replace(/\.docx$/, ''));
  const sw = [];
  const c0 = await metrics(cdp);
  let n = 0;
  for (let round = 0; round < 2; round++) for (const name of names) {
    if (await page.evaluate((nm) => document.querySelector(`.doc-row[data-on] .doc-nm[aria-label="${nm}"], .doc-row.on .doc-nm[aria-label="${nm}"]`) !== null, name)) continue;
    const before = await page.evaluate(() => { window.__k = performance.now(); return window.__falconView.state.doc; }).catch(() => null);
    void before;
    await page.evaluate((nm) => { window.__k = performance.now(); document.querySelector(`.doc-nm[aria-label="${nm}"]`).click(); }, name);
    sw.push(await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(() => r(performance.now() - window.__k), 0)))));
    await settle(page);
    n++;
  }
  const c1 = await metrics(cdp);
  await ctx.close();
  return { files: list.length, openAllMs, openAllCpu, heapMB, domNodes, idleMsPerSec, idleGpuMsPerSec: (idleTrace.gpu + idleTrace.paint) / 5, switchMedian: median(sw), switchCpu: ((c1.TaskDuration - c0.TaskDuration) * 1000) / n };
}

async function idle() {
  // idle CPU: main-thread busy time per second, editor showing a small doc, then Home
  const { ctx, page, cdp } = await freshPage();
  await editorReady(page);
  await page.waitForTimeout(3000);
  const busy = async (ms) => { const a = await metrics(cdp); await page.waitForTimeout(ms); const b = await metrics(cdp); return ((b.TaskDuration - a.TaskDuration) * 1000) / (ms / 1000); };
  const editor = await busy(5000);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+h' : 'Control+Shift+h').catch(() => {});
  await page.evaluate(() => document.querySelector('.sb-logo')?.click());
  await page.waitForTimeout(3000); // past Home's one-time opening sweep: steady state only
  const home = await busy(5000);
  await ctx.close();
  return { editorMsPerSec: editor, homeMsPerSec: home };
}

async function coldLoad() {
  // first visit, nothing cached, on a slow 3G link: time until the editor can be typed in, and bytes sent
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 });
  let bytes = 0;
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; });
  const t0 = Date.now();
  await page.goto(URL0, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__falconView && document.querySelector('.toolbar'), null, { timeout: 180000 });
  const ready = Date.now() - t0;
  await page.waitForLoadState('networkidle').catch(() => {});
  const all = Date.now() - t0;
  await ctx.close();
  return { readyMs: ready, networkIdleMs: all, bytes };
}

function bundle() {
  const a = join(dist, 'assets');
  let js = 0, jsGz = 0, css = 0, cssGz = 0, fonts = 0, total = 0;
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else total += statSync(p).size; } };
  walk(dist);
  for (const f of readdirSync(a)) {
    const b = readFileSync(join(a, f));
    if (f.endsWith('.js')) { js += b.length; jsGz += gzipSync(b, { level: 9 }).length; }
    else if (f.endsWith('.css')) { css += b.length; cssGz += gzipSync(b, { level: 9 }).length; }
    else if (/\.woff2?$/.test(f)) fonts += b.length;
  }
  // what the first screen loads: index.html's own script and style tags (and their static imports)
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const entry = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
  let initial = 0, initialGz = 0;
  const seen = new Set();
  const add = (p) => {
    if (seen.has(p)) return; seen.add(p);
    const b = readFileSync(join(dist, p)); initial += b.length; initialGz += gzipSync(b, { level: 9 }).length;
    if (p.endsWith('.js')) for (const m of b.toString().matchAll(/from"\.\/([^"]+\.js)"|import"\.\/([^"]+\.js)"/g)) add(`assets/${m[1] ?? m[2]}`);
  };
  entry.forEach(add);
  return { js, jsGz, css, cssGz, fonts, total, initialJsCss: initial, initialJsCssGz: initialGz };
}

const result = { bundle: bundle(), files: {} };
console.error('bundle', result.bundle);
for (const f of files) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) { const r = await openRun(f); runs.push(r); console.error(basename(f), i, JSON.stringify(r)); }
  result.files[basename(f)] = Object.fromEntries(Object.keys(runs[0]).map((k) => [k, median(runs.map((r) => r[k]))]));
}
if (files.length > 1) {
  const ms = []; for (let i = 0; i < Math.min(RUNS, 3); i++) { const r = await multi(files); ms.push(r); console.error('multi', i, JSON.stringify(r)); }
  result.multi = Object.fromEntries(Object.keys(ms[0]).map((k) => [k, median(ms.map((r) => r[k]))]));
}
const idles = []; for (let i = 0; i < 3; i++) idles.push(await idle());
result.idle = { editorMsPerSec: median(idles.map((x) => x.editorMsPerSec)), homeMsPerSec: median(idles.map((x) => x.homeMsPerSec)) };
const colds = []; for (let i = 0; i < 3; i++) colds.push(await coldLoad());
result.cold = { readyMs: median(colds.map((x) => x.readyMs)), networkIdleMs: median(colds.map((x) => x.networkIdleMs)), bytes: median(colds.map((x) => x.bytes)) };
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
server.close();
