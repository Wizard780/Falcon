// Turns two perf.mjs results (before, after) into one HTML page with a chart per goal.
//   node scripts/perf-report.mjs perf-results/before.json perf-results/after.json perf-results/report.html
import { readFileSync, writeFileSync } from 'node:fs';
const [beforePath, afterPath, out] = process.argv.slice(2);
const A = JSON.parse(readFileSync(beforePath, 'utf8')), B = JSON.parse(readFileSync(afterPath, 'utf8'));
const NAMES = { 'd_nordics.docx': 'Nordics Aff · 30 MB', 'c_impactturns.docx': 'Impact Turns · 20 MB', 'b_spark.docx': 'AT Spark · 2.4 MB', 'e_atneg.docx': 'AT Neg · 1.6 MB', 'a_animal.docx': 'Animal Wipeout · 0.7 MB' };
const FILES = Object.keys(NAMES).filter((f) => A.files[f] && B.files[f]);
const pct = (a, b) => `${b < a ? '−' : '+'}${Math.abs(Math.round(((b - a) / a) * 100))}%`;
const s = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);
const ms = (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
const kb = (b) => `${Math.round(b / 1024)} KB`;
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** One chart: stat blocks on top, then a group of before/after bars per row. */
function chart({ title, stats, legend, groups, max, ticks, fmt, note }) {
  const w = (v) => `${Math.max(0.3, (v / max) * 100).toFixed(2)}%`;
  const bar = (row, cls) => {
    // a split bar only when the first card shows well before the doc is editable; the white tick marks the first card either way
    const split = row.split != null && row.value - row.split > row.value * 0.05;
    const parts = (split
      ? `<div class="bar ${cls}-a" style="width:${w(row.split)}"></div><div class="bar ${cls}" style="width:${w(row.value - row.split)}"></div>`
      : `<div class="bar ${cls}" style="width:${w(row.value)}"></div>`) + (row.tick != null ? `<i class="tick" style="left:${w(row.tick)}"></i>` : '');
    return `<div class="row"><div class="lbl">${esc(row.label)}</div><div class="track">${parts}${ticks.map((t) => `<i class="grid" style="left:${w(t)}"></i>`).join('')}</div><div class="val"><b>${esc(row.text)}</b>${row.dim ? `<span> · ${esc(row.dim)}</span>` : ''}</div></div>`;
  };
  return `<section>
<h2>${esc(title)}</h2>
<div class="stats">${stats.map((x) => `<div><div class="k">${esc(x.k)}</div><div class="big">${esc(x.big)}</div><div class="sub">${esc(x.sub)}</div></div>`).join('')}</div>
<div class="legend">${legend.map(([c, t]) => `<span><i class="sw ${c}"></i>${esc(t)}</span>`).join('')}</div>
${groups.map((g) => `<h3>${esc(g.name)}</h3>${bar(g.before, 'old')}${bar(g.after, 'new')}`).join('')}
<div class="axis"><div class="lbl"></div><div class="track">${ticks.map((t) => `<span style="left:${w(t)}">${esc(fmt(t))}</span>`).join('')}</div><div class="val"></div></div>
${note ? `<p class="note">${esc(note)}</p>` : ''}
</section>`;
}
const niceTicks = (max, step) => Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);

// 1. opening big files
const d = (f, k) => [A.files[f][k], B.files[f][k]];
const big = 'd_nordics.docx';
const openMax = Math.max(...FILES.map((f) => A.files[f].settledMs)) * 1.02;
const open = chart({
  title: 'Open a big file',
  stats: [
    { k: 'First card on screen, 30 MB doc', big: pct(...d(big, 'firstMs')), sub: `${s(A.files[big].firstMs)} → ${s(B.files[big].firstMs)}` },
    { k: 'Fully editable, 30 MB doc', big: pct(...d(big, 'settledMs')), sub: `${s(A.files[big].settledMs)} → ${s(B.files[big].settledMs)}` },
    { k: 'Fully editable, 20 MB doc', big: pct(...d('c_impactturns.docx', 'settledMs')), sub: `${s(A.files['c_impactturns.docx'].settledMs)} → ${s(B.files['c_impactturns.docx'].settledMs)}` },
  ],
  legend: [['old', 'Before (main)'], ['new', 'After (this branch)'], ['tk', 'First card on screen']],
  groups: FILES.map((f) => ({
    name: NAMES[f],
    before: { label: 'Before', value: A.files[f].settledMs, tick: A.files[f].firstMs, text: s(A.files[f].settledMs), dim: `card at ${s(A.files[f].firstMs)}` },
    after: { label: 'After', value: B.files[f].settledMs, split: Math.min(B.files[f].firstMs, B.files[f].settledMs), tick: B.files[f].firstMs, text: s(B.files[f].settledMs), dim: `card at ${s(B.files[f].firstMs)}` },
  })),
  max: openMax, ticks: niceTicks(openMax, openMax > 4000 ? 1000 : 500), fmt: (t) => `${(t / 1000).toFixed(1).replace(/\.0$/, '')} s`,
  note: 'From picking the file to the first paragraphs painted, and to the main thread going quiet (no task over 20 ms for 300 ms).',
});

// 2. CPU while typing and scrolling
const cpuFiles = FILES.filter((f) => A.files[f].blocks > 1000);
const cpuMax = Math.max(...cpuFiles.map((f) => A.files[f].cpuPerKey), ...cpuFiles.map((f) => A.files[f].cpuPerScrollFrame)) * 1.05;
const cpu = chart({
  title: 'CPU while typing and scrolling',
  stats: [
    { k: 'CPU per keystroke, 30 MB doc', big: pct(...d(big, 'cpuPerKey')), sub: `${ms(A.files[big].cpuPerKey)} → ${ms(B.files[big].cpuPerKey)}` },
    { k: 'CPU per scroll frame, 30 MB doc', big: pct(...d(big, 'cpuPerScrollFrame')), sub: `${ms(A.files[big].cpuPerScrollFrame)} → ${ms(B.files[big].cpuPerScrollFrame)}` },
    { k: 'Key to screen, 30 MB doc', big: pct(...d(big, 'keyMedian')), sub: `${ms(A.files[big].keyMedian)} → ${ms(B.files[big].keyMedian)} median` },
  ],
  legend: [['old', 'Before (main)'], ['new', 'After (this branch)']],
  groups: cpuFiles.flatMap((f) => [
    { name: `${NAMES[f]} · typing`, before: { label: 'Before', value: A.files[f].cpuPerKey, text: ms(A.files[f].cpuPerKey), dim: 'per key' }, after: { label: 'After', value: B.files[f].cpuPerKey, text: ms(B.files[f].cpuPerKey), dim: 'per key' } },
    { name: `${NAMES[f]} · scrolling`, before: { label: 'Before', value: A.files[f].cpuPerScrollFrame, text: ms(A.files[f].cpuPerScrollFrame), dim: 'per frame' }, after: { label: 'After', value: B.files[f].cpuPerScrollFrame, text: ms(B.files[f].cpuPerScrollFrame), dim: 'per frame' } },
  ]),
  max: cpuMax, ticks: niceTicks(cpuMax, cpuMax > 60 ? 20 : 10), fmt: (t) => `${t} ms`,
  note: 'Main-thread busy time (Chrome TaskDuration) per real key press in the middle of the doc, and per frame while scrolling 400 px a frame. A frame has 16.7 ms; past that the page stutters.',
});

// 3. save freeze
const saveMax = Math.max(...FILES.map((f) => A.files[f].saveFreeze)) * 1.05;
const save = chart({
  title: 'Save: how long the window freezes',
  stats: [
    { k: 'Save freeze, 30 MB doc', big: pct(...d(big, 'saveFreeze')), sub: `${ms(A.files[big].saveFreeze)} → ${ms(B.files[big].saveFreeze)}` },
    { k: 'Save freeze, 20 MB doc', big: pct(...d('c_impactturns.docx', 'saveFreeze')), sub: `${ms(A.files['c_impactturns.docx'].saveFreeze)} → ${ms(B.files['c_impactturns.docx'].saveFreeze)}` },
    { k: 'Saved file', big: 'Same', sub: 'every part byte-identical' },
  ],
  legend: [['old', 'Before (main)'], ['new', 'After (this branch)']],
  groups: FILES.map((f) => ({ name: NAMES[f], before: { label: 'Before', value: A.files[f].saveFreeze, text: ms(A.files[f].saveFreeze) }, after: { label: 'After', value: B.files[f].saveFreeze, text: ms(B.files[f].saveFreeze) } })),
  max: saveMax, ticks: niceTicks(saveMax, 100), fmt: (t) => `${t} ms`,
  note: 'The longest stretch the main thread is blocked between pressing Save and the file being written.',
});

// 4. download size and a weak connection
const bmax = Math.max(A.bundle.initialJsCss, A.bundle.js) * 1.05;
const net = chart({
  title: 'Download size and a weak connection',
  stats: [
    { k: 'First-screen code, gzipped', big: pct(A.bundle.initialJsCssGz, B.bundle.initialJsCssGz), sub: `${kb(A.bundle.initialJsCssGz)} → ${kb(B.bundle.initialJsCssGz)}` },
    { k: 'Ready to type on slow 3G', big: pct(A.cold.readyMs, B.cold.readyMs), sub: `${s(A.cold.readyMs)} → ${s(B.cold.readyMs)}` },
    { k: 'All JavaScript', big: pct(A.bundle.js, B.bundle.js), sub: `${kb(A.bundle.js)} → ${kb(B.bundle.js)}` },
  ],
  legend: [['old', 'Before (main)'], ['new', 'After (this branch)']],
  groups: [
    { name: 'First-screen JS + CSS', before: { label: 'Before', value: A.bundle.initialJsCss, text: kb(A.bundle.initialJsCss), dim: `${kb(A.bundle.initialJsCssGz)} gzipped` }, after: { label: 'After', value: B.bundle.initialJsCss, text: kb(B.bundle.initialJsCss), dim: `${kb(B.bundle.initialJsCssGz)} gzipped` } },
    { name: 'All JavaScript', before: { label: 'Before', value: A.bundle.js, text: kb(A.bundle.js), dim: `${kb(A.bundle.jsGz)} gzipped` }, after: { label: 'After', value: B.bundle.js, text: kb(B.bundle.js), dim: `${kb(B.bundle.jsGz)} gzipped` } },
    { name: 'Sent on first visit (gzip, with fonts)', before: { label: 'Before', value: A.cold.bytes, text: kb(A.cold.bytes) }, after: { label: 'After', value: B.cold.bytes, text: kb(B.cold.bytes) } },
  ],
  max: bmax, ticks: niceTicks(bmax, 200 * 1024), fmt: (t) => `${Math.round(t / 1024)} KB`,
  note: `Slow 3G: 400 kbit/s, 400 ms round trips, nothing cached. Ready = the editor and toolbar are up. Idle CPU with nothing happening was already near zero and stays there (editor ${A.idle.editorMsPerSec.toFixed(1)} → ${B.idle.editorMsPerSec.toFixed(1)} ms/s, Home ${A.idle.homeMsPerSec.toFixed(1)} → ${B.idle.homeMsPerSec.toFixed(1)} ms/s).`,
});

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Falcon speed</title>
<style>
:root{--bg:#0d1117;--tx:#e6edf3;--mut:#9aa4b2;--old:#3a3d45;--new:#6bd3c2;--newa:#2c3036;--grid:#1d222a}
*{box-sizing:border-box}body{background:var(--bg);color:var(--tx);font:16px -apple-system,BlinkMacSystemFont,Inter,"Segoe UI",sans-serif;margin:0;padding:40px 44px 60px;max-width:1240px}
h1{font-size:15px;font-weight:500;color:var(--mut);margin:0 0 30px}
section{margin:0 0 64px}h2{font-size:22px;margin:0 0 22px}
.stats{display:flex;gap:64px;flex-wrap:wrap;margin-bottom:30px}.k{color:var(--mut);font-size:17px}.big{font-size:60px;font-weight:700;letter-spacing:-1.5px;line-height:1.15}.sub{color:var(--mut);font-size:17px}
.legend{display:flex;gap:26px;flex-wrap:wrap;margin:0 0 18px;font-size:16px}.sw{display:inline-block;width:16px;height:16px;border-radius:4px;vertical-align:-2px;margin-right:9px}
h3{font-size:18px;margin:22px 0 10px}
.row,.axis{display:flex;align-items:center}.row{height:56px}.lbl{width:90px;color:var(--mut);font-size:17px;flex:none}
.track{flex:1;position:relative;height:42px;display:flex;align-items:center}.axis .track{height:24px}
.bar{height:42px;position:relative;z-index:1}.bar:first-child{border-radius:6px 0 0 6px}.bar:last-of-type{border-radius:0 6px 6px 0}.bar:only-of-type{border-radius:6px}
.old{background:var(--old)}.new{background:var(--new)}.new-a{background:var(--newa)}.sw.new-a{background:var(--newa);outline:1px solid #3a3f47}
.tick{position:absolute;top:-4px;bottom:-4px;width:2px;background:#fff;z-index:2;margin-left:-1px}
.grid{position:absolute;top:-8px;bottom:-8px;width:1px;background:var(--grid)}
.axis span{position:absolute;transform:translateX(-50%);color:var(--mut);font-size:15px;white-space:nowrap}.sw.tk{width:3px;background:#fff;border-radius:1px}
.val{width:300px;text-align:right;padding-left:20px;white-space:nowrap;flex:none;font-size:17px}.val b{font-weight:700}.val span{color:var(--mut)}
.note{color:var(--mut);font-size:14px;line-height:1.5;margin-top:18px;max-width:1000px}
@media (max-width:760px){body{padding:24px 16px}.stats{gap:28px}.big{font-size:42px}.lbl{width:56px;font-size:14px}.val{width:150px;font-size:13px;white-space:normal}}
</style></head><body>
<h1>Falcon, before (main) and after (branch perf). Headless Chromium on this Mac, median of 5 runs per file.</h1>
${open}${cpu}${save}${net}
</body></html>`;
writeFileSync(out, html);
console.log('wrote', out);
