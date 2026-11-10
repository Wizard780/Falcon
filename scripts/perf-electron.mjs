// Falcon desktop bench: the real Electron app (hidden window), every process counted.
//   node scripts/perf-electron.mjs <app dir> <out.json> <file.docx...>   (RUNS=3 by default)
// HOME_OPEN=1 measures idle with Home showing over the files. STRESS=1 adds a known GPU load (a full-window blurred, animated overlay) to check the GPU numbers can see one.
// Launch to a typed-in editor, then with the files open: memory (all processes), idle CPU (all processes),
// and the GPU process's CPU while idle and while scrolling. Run from anywhere; the app dir needs a built dist/.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [appDir, out, ...files] = process.argv.slice(2);
const RUNS = Number(process.env.RUNS ?? 3);
const { ELECTRON_RUN_AS_NODE, ...env } = process.env; // set by some hosts; it turns Electron into plain Node
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function run() {
  env.FALCON_USER_DATA = fs.mkdtempSync(`${os.tmpdir()}/falcon-perf-`);
  const t0 = Date.now();
  const app = await electron.launch({ cwd: resolve(appDir), args: ['.', ...files.map((f) => resolve(f))], env: { ...env, FALCON_HEADLESS: '1' } });
  const win = await app.firstWindow();
  await win.waitForFunction(() => window.__falconView);
  const shellMs = Date.now() - t0;
  await win.waitForFunction((n) => document.querySelectorAll('.doc-nm').length >= n && window.__falconView.state.doc.childCount > 20, files.length, { timeout: 180000 });
  const openMs = Date.now() - t0;
  if (process.env.STRESS) await win.evaluate(() => {
    const s = document.createElement('style');
    s.textContent = '@keyframes perf-spin { to { transform: rotate(360deg); } } .perf-stress { position: fixed; inset: 0; z-index: 99999; pointer-events: none; backdrop-filter: blur(30px); animation: perf-spin 2s linear infinite; }';
    const d = document.createElement('div'); d.className = 'perf-stress';
    document.head.append(s); document.body.append(d);
  });
  if (process.env.HOME_OPEN) await win.evaluate(() => document.querySelector('.sb-logo')?.click());
  await win.waitForTimeout(4000);
  // per process type: resident memory (MB) and CPU seconds used so far
  const snap = () => app.evaluate(({ app }) => app.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, name: m.name ?? m.serviceName ?? '', mb: m.memory.workingSetSize / 1024, cpu: m.cpu.cumulativeCPUUsage ?? 0 })));
  const sum = (s, pick, type) => s.filter((m) => !type || m.type === type).reduce((a, m) => a + pick(m), 0);
  const a = await snap();
  await win.waitForTimeout(5000);
  const b = await snap();
  const FRAMES = 90;
  // its wall time too: if 90 frames take far under 1.5 s, the hidden window isn't pacing frames to the display
  const scrollMs = await win.evaluate(async (n) => {
    const sc = document.querySelector('.f-scroll');
    sc.scrollTop = 0;
    const t = performance.now();
    for (let i = 0; i < n; i++) { sc.scrollTop += 400; await new Promise((r) => requestAnimationFrame(r)); }
    return performance.now() - t;
  }, FRAMES);
  const c = await snap();
  const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  // each process at the start of the idle window: type, name, MB, and its CPU ms per second while idle
  const procs = a.map((m, i) => ({ type: m.type, name: m.name, mb: Math.round(m.mb), idleMsPerSec: +((((b.find((x) => x.pid === m.pid)?.cpu ?? m.cpu) - m.cpu) * 1000) / 5).toFixed(2) }));
  await app.close();
  const d = (x, y, type) => (sum(y, (m) => m.cpu, type) - sum(x, (m) => m.cpu, type)) * 1000;
  return {
    shellMs, openMs,
    memMB: sum(a, (m) => m.mb), rendererMB: sum(a, (m) => m.mb, 'Tab'), gpuMB: sum(a, (m) => m.mb, 'GPU'),
    idleCpuMsPerSec: d(a, b) / 5, idleGpuMsPerSec: d(a, b, 'GPU') / 5,
    scrollCpuPerFrame: d(b, c) / FRAMES, scrollGpuPerFrame: d(b, c, 'GPU') / FRAMES,
    scrollMs, windows, processes: a.length, procs,
  };
}

const runs = [];
for (let i = 0; i < RUNS; i++) { const r = await run(); runs.push(r); console.error(i, JSON.stringify(r)); }
const result = Object.fromEntries(Object.keys(runs[0]).filter((k) => k !== 'procs').map((k) => [k, median(runs.map((r) => r[k]))]));
result.procs = runs.at(-1).procs; // the last run's processes, as a sample
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
