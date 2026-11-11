// Falcon idle bench: the real desktop app sitting on Home with no file open, with the user's own profile
// (card index, settings, Local Storage) copied in. Every Falcon process: average %CPU over the sample and
// its phys_footprint. macOS only (ps, footprint).
//   node scripts/idle-bench.mjs <app dir> <out.json>
// PROFILE   the profile to copy (default: ~/Library/Application Support/falcon). Only the copy is used, so the
//           user's own files are never written; Cache, Code Cache, the single-instance lock and crash-recovery
//           copies are left out.
// SETTLE_MS idle time before sampling (default 40000: the launch flight, and anything launch starts, are done)
// SAMPLE_MS how long to sample (default 30000)
// PROBE     turn one suspect off before sampling, to see what it costs: breathe (Home's glow), backdrop (the
//           caption's blur), willchange (any will-change), raf (stops every requestAnimationFrame loop)
// SHOT      save a screenshot of the page here, at rest, before sampling
// The window is FALCON_BENCH's: shown and painting at the display's rate, but see-through and click-through, so
// nothing appears on the screen. The probe checks it really paints (visible, rAF at the display's rate).
import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [appDir, out] = process.argv.slice(2);
if (!appDir || !out) { console.error('usage: node scripts/idle-bench.mjs <app dir> <out.json>'); process.exit(2); }
const SRC = process.env.PROFILE ?? path.join(os.homedir(), 'Library/Application Support/falcon');
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 40000), SAMPLE_MS = Number(process.env.SAMPLE_MS ?? 30000);
const PROBE = process.env.PROBE ?? '';
const { ELECTRON_RUN_AS_NODE, ...env } = process.env; // set by some hosts; it turns Electron into plain Node

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-idle-'));
const profile = path.join(tmp, 'profile');
const SKIP = /^(Cache|Code Cache|Singleton.*|recovery.*\.json)$/;
fs.cpSync(SRC, profile, { recursive: true, filter: (p) => p === SRC || !SKIP.test(path.basename(p)) });
for (const f of fs.readdirSync(profile)) if (f.endsWith('.json')) fs.chmodSync(path.join(profile, f), 0o644);

// ---- processes ----
const ps = () => execFileSync('ps', ['-A', '-o', 'pid=,ppid=,time=,args='], { encoding: 'utf8' }).trim().split('\n').map((l) => {
  const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l);
  return { pid: +m[1], ppid: +m[2], cpu: secs(m[3]), args: m[4] };
});
// ps time: [[hh:]mm:]ss.cc, or d-hh:mm:ss
function secs(t) {
  let days = 0;
  if (t.includes('-')) { const [d, r] = t.split('-'); days = +d; t = r; }
  return days * 86400 + t.split(':').reduce((a, v) => a * 60 + Number(v), 0);
}
const tree = (root) => {
  const all = ps(), keep = new Set([root]);
  for (let grew = true; grew;) { grew = false; for (const p of all) if (!keep.has(p.pid) && keep.has(p.ppid)) { keep.add(p.pid); grew = true; } }
  return all.filter((p) => keep.has(p.pid));
};
const kind = (args) => (/--type=gpu-process/.test(args) ? 'gpu' : /--type=renderer/.test(args) ? 'renderer' : /--type=utility/.test(args) ? `utility:${/--utility-sub-type=(\S+)/.exec(args)?.[1] ?? '?'}` : /--type=(\S+)/.exec(args)?.[1] ?? 'main');
const UNIT = { B: 1 / 1048576, KB: 1 / 1024, MB: 1, GB: 1024 };
function footprint(pid) {
  try {
    const o = execFileSync('footprint', [String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = /phys_footprint:\s*([\d.]+)\s*(B|KB|MB|GB)/.exec(o);
    const peak = /phys_footprint_peak:\s*([\d.]+)\s*(B|KB|MB|GB)/.exec(o);
    return { mb: m ? +(m[1] * UNIT[m[2]]).toFixed(1) : null, peakMb: peak ? +(peak[1] * UNIT[peak[2]]).toFixed(1) : null };
  } catch { return { mb: null, peakMb: null }; }
}

// ---- the app ----
const app = await electron.launch({
  cwd: path.resolve(appDir), args: ['.'],
  env: { ...env, FALCON_BENCH: '1', FALCON_USER_DATA: profile, CARDMIRROR_BRIDGE_DIR: path.join(tmp, 'bridge') },
});
const mainPid = app.process().pid;
let result;
try {
  const win = await app.firstWindow();
  await win.waitForSelector('.home', { timeout: 60000 });
  const shown = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ visible: w.isVisible(), focused: w.isFocused(), opacity: w.getOpacity(), bounds: w.getBounds() })));
  if (shown.some((w) => w.opacity !== 0)) throw new Error(`a window could be seen: ${JSON.stringify(shown)}`);
  await win.waitForTimeout(SETTLE_MS);
  const docs = await win.evaluate(() => document.querySelectorAll('.doc-row').length);
  const homeOpen = await win.evaluate(() => !!document.querySelector('.home.open'));

  // what's animating and who is asking for frames, before anything of ours runs
  const page = await win.evaluate(async (ms) => {
    const anims = document.getAnimations().map((a) => {
      const t = a.effect?.target;
      return { name: a.animationName ?? a.constructor.name, play: a.playState, target: t ? `${t.tagName.toLowerCase()}${t.className && typeof t.className === 'string' ? `.${t.className.trim().split(/\s+/).join('.')}` : ''}${a.effect?.pseudoElement ?? ''}` : null };
    });
    let calls = 0;
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) => { calls++; return raf.call(window, cb); };
    await new Promise((r) => setTimeout(r, ms));
    window.requestAnimationFrame = raf;
    // our own loop: is the page really painting, and at what rate?
    const fps = await new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) raf(f); else r(n); }; raf(f); });
    return { visibility: document.visibilityState, hasFocus: document.hasFocus(), appRafPerSec: calls / (ms / 1000), probeFps: fps, animations: anims };
  }, 5000);

  if (PROBE) await win.evaluate((probe) => {
    const css = { breathe: '.hm-desk::before { animation: none !important; }', backdrop: '.hm-cap { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }', willchange: '* { will-change: auto !important; }' }[probe];
    if (css) { const s = document.createElement('style'); s.textContent = css; document.head.append(s); }
    else if (probe === 'raf') window.requestAnimationFrame = () => 0;
    else throw new Error(`unknown PROBE ${probe}`);
  }, PROBE);
  if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT });
  await win.waitForTimeout(2000);

  const t0 = Date.now(), a = tree(mainPid);
  await win.waitForTimeout(SAMPLE_MS);
  const t1 = Date.now(), b = tree(mainPid);
  const wall = (t1 - t0) / 1000;
  const procs = b.map((p) => {
    const was = a.find((x) => x.pid === p.pid);
    return { pid: p.pid, type: kind(p.args), cpuPct: was ? +(((p.cpu - was.cpu) / wall) * 100).toFixed(2) : null, ...footprint(p.pid) };
  }).filter((p) => p.type !== 'crashpad-handler' || p.mb);
  const sum = (k, f = () => true) => +procs.filter(f).reduce((s, p) => s + (p[k] ?? 0), 0).toFixed(1);
  result = {
    when: new Date().toISOString(), appDir: path.resolve(appDir), commit: execFileSync('git', ['-C', appDir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
    probe: PROBE || null, settleMs: SETTLE_MS, sampleMs: SAMPLE_MS, window: shown, openDocs: docs, homeOpen,
    page,
    cpuPctTotal: sum('cpuPct'), gpuCpuPct: sum('cpuPct', (p) => p.type === 'gpu'),
    footprintMbTotal: sum('mb'), mainFootprintMb: sum('mb', (p) => p.type === 'main'),
    procs,
  };
} finally {
  await app.close().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
}
fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, page: { ...result.page, animations: result.page.animations.length } }, null, 2));
