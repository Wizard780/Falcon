// Opens a real .docx in Falcon (web build) and measures open time and per-keystroke latency.
import { chromium } from 'playwright';
const file = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
await p.goto(process.env.FALCON_URL || 'http://localhost:5173/'); await p.waitForSelector('.ProseMirror');
const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.keyboard.press('Meta+o')]);
const t0 = Date.now();
await chooser.setFiles(file);
await p.waitForFunction(() => window.__falconView.state.doc.childCount > 50, null, { timeout: 120000 });
await p.evaluate(() => new Promise(requestAnimationFrame));
console.log('open+render ms', Date.now() - t0, 'paragraphs', await p.evaluate(() => window.__falconView.state.doc.childCount));
// type in the middle of the document
await p.evaluate(() => { const v = window.__falconView; const S = v.state.selection.constructor; const pos = v.state.doc.resolve(Math.floor(v.state.doc.content.size / 2)); v.dispatch(v.state.tr.setSelection(S.near(pos)).scrollIntoView()); v.focus(); });
const lat = await p.evaluate(async () => {
  const out = [];
  const v = window.__falconView;
  for (let i = 0; i < 30; i++) {
    const t = performance.now();
    v.dispatch(v.state.tr.insertText('x'));
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    out.push(performance.now() - t);
  }
  out.sort((a, b) => a - b);
  return { median: out[15].toFixed(1), p90: out[27].toFixed(1), max: out[29].toFixed(1) };
});
console.log('keystroke ms (dispatch → next frame)', lat);
await p.screenshot({ path: 'shots/falcon-bigdoc.png' });
await b.close();
