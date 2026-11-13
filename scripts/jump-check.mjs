// An outline click from the top of a long file to a heading near its end, in the real app (hidden window): every
// frame of the scroll is checked just before it's painted for paragraphs on screen that aren't drawn (a blank page),
// and the outline's lit row is recorded each frame (it should go straight to the clicked heading).
// FALCON_DOC=<a long .docx> node scripts/jump-check.mjs   (a copy: nothing is saved)
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const doc = process.env.FALCON_DOC;
if (!doc) { console.error('FALCON_DOC=<file.docx> please'); process.exit(2); }
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
env.FALCON_USER_DATA = fs.mkdtempSync(`${os.tmpdir()}/falcon-jump-`);
env.CARDMIRROR_BRIDGE_DIR = fs.mkdtempSync(`${os.tmpdir()}/falcon-jump-bridge-`);
const want = (cond, msg) => { console.log(cond ? 'ok  ' : 'FAIL', msg); if (!cond) process.exitCode = 1; };
const app = await electron.launch({ env: { ...env, FALCON_HEADLESS: '1' }, args: ['.', doc] });
const win = await app.firstWindow();
await win.setViewportSize({ width: 1400, height: 900 });
await win.waitForSelector('.ProseMirror');
await win.waitForFunction(() => document.querySelectorAll('.sb-row.ol').length > 20, null, { timeout: 30000 });
await win.waitForTimeout(1500);

for (const run of [1, 2]) {
  // from the top: the outline's first row, then the last row the outline shows
  await win.evaluate(() => { const sc = document.querySelector('.f-scroll'); sc.scrollTop = 0; document.querySelector('.sb-scroll').scrollTop = 0; });
  await win.waitForTimeout(600);
  const rows = win.locator('.sb-row.ol');
  const n = await rows.count();
  const target = rows.nth(n - 2);
  const label = (await target.textContent()).trim();
  await target.scrollIntoViewIfNeeded();
  await win.waitForTimeout(400);
  await win.evaluate(() => {
    window.__jump = new Promise((done) => {
      const sc = document.querySelector('.f-scroll'), pm = document.querySelector('.ProseMirror:not(.hm-doc)');
      const out = [];
      let last = -1, still = 0;
      const probe = () => {
        const box = sc.getBoundingClientRect();
        let shown = 0, blank = 0;
        for (const el of pm.children) {
          const r = el.getBoundingClientRect();
          if (r.bottom <= box.top || r.top >= box.bottom) continue;
          const h = Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top);
          if (el.classList.contains('f-near') || el.tagName === 'TABLE' || el.childNodes.length) shown += h; else blank += h;
        }
        out.push({ t: performance.now(), top: Math.round(sc.scrollTop), blank: Math.round((100 * blank) / Math.max(1, shown + blank)), lit: document.querySelector('.sb-row.ol[data-on]')?.textContent.trim() ?? '' });
        still = Math.abs(sc.scrollTop - last) < 1 ? still + 1 : 0;
        last = sc.scrollTop;
        if (still < 20 && out.length < 400) requestAnimationFrame(probe); else done(out);
      };
      // after the app's own click handler (React's, at its root) has started the scroll: each frame this runs after
      // the scroll's step has moved the page, and before the frame is painted
      addEventListener('click', () => { out.push({ top: Math.round(sc.scrollTop), blank: 0, lit: '' }); requestAnimationFrame(probe); }, { once: true });
    });
  });
  await target.click();
  const frames = await win.evaluate(() => window.__jump);
  const moving = frames.filter((f, i) => i > 0 && f.top !== frames[i - 1].top);
  const blankFrames = moving.filter((f) => f.blank >= 50);
  const start = frames[1]?.lit; // lit at the click, until the app's next render
  const lits = [...new Set(frames.slice(1).map((f) => f.lit).filter((l, i, a) => a.slice(0, i + 1).some((x) => x !== start)))];
  console.log(`run ${run}: clicked "${label}", ${moving.length} moving frames, scrollTop ${frames[0].top} -> ${frames.at(-1).top}`);
  console.log('   frames (scrollTop:blank%):', moving.map((f) => `${f.top}:${f.blank}`).join(' '));
  console.log('   outline lit rows seen:', lits.join(' | '));
  const gaps = frames.slice(2).map((f, i) => f.t - frames[i + 1].t).filter((g) => g > 0).sort((a, b) => a - b);
  if (gaps.length) console.log(`   frame time: median ${gaps[gaps.length >> 1].toFixed(1)} ms, worst ${gaps.at(-1).toFixed(1)} ms, ${gaps.filter((g) => g > 34).length} frames over 34 ms`);
  want(blankFrames.length === 0, `no frame painted with half or more of the screen blank (${blankFrames.length} of ${moving.length})`);
  want(lits.every((l) => l === label), `the outline goes straight from "${start}" to the clicked heading (${lits.length} rows lit after the start: ${lits.slice(0, 4).join(' | ')})`);
  want(frames.at(-1).lit === label, `and ends on it: ${frames.at(-1).lit}`);
  // the outline pane itself stays on the row you clicked (it used to slide off toward the row lit before the click)
  await win.waitForTimeout(1200);
  const seen = await win.evaluate(() => {
    const s = document.querySelector('.sb-scroll').getBoundingClientRect(), r = document.querySelector('.sb-row.ol[data-on]')?.getBoundingClientRect();
    return !!r && r.top >= s.top && r.bottom <= s.bottom;
  });
  want(seen, 'the clicked row is still in view in the outline a second later');
  if (process.env.FALCON_SHOTS) await win.screenshot({ path: path.join(process.env.FALCON_SHOTS, `jump-${run}.png`) });
}
await app.evaluate(() => { globalThis.falconSkipUnloadGuard = true; });
await app.close();
for (const d of [env.FALCON_USER_DATA, env.CARDMIRROR_BRIDGE_DIR]) fs.rmSync(d, { recursive: true, force: true });
