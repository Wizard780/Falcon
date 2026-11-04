// Playwright helpers for drive scripts started by `falcon-verify run`. They act through the real UI
// (keys, clicks, the Open file chooser, the Save download) and only read app state for evidence.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export const URL = process.env.FALCON_URL;
export const EVIDENCE = process.env.FALCON_EVIDENCE;
export const SEED = path.join(process.env.FALCON_SKILL ?? '', 'fixtures/seed.docx');
export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
if (!URL || !EVIDENCE) throw new Error('start drive scripts with: falcon-verify run <script.mjs>');

/** A fresh browser on a clean profile, Home dismissed, editor focused. `feature` names the evidence folder; `scale` is the device pixel ratio (2 for a retina screen). */
export async function openFalcon(feature, { viewport = { width: 1400, height: 900 }, storage = {}, scale = 1 } = {}) {
  const out = path.join(EVIDENCE, feature);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.evaluate((s) => { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, storage);
  await page.reload();
  await page.waitForSelector('.ProseMirror');
  await page.keyboard.press('Escape'); // Home opens at launch
  await page.waitForTimeout(300);
  const results = [];
  let step = 0;
  const f = {
    page, browser, out, errors, results,
    /** Record a pass/fail line; printed by done(). */
    want(ok, what) { results.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`); return ok; },
    /** Numbered screenshot in the feature's evidence folder. */
    async shot(name) { const p = path.join(out, `${String(++step).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: p }); return p; },
    /** Per-paragraph style and mark runs, e.g. `tag: Growth` / `normal: [Smith 24]{cite}`. */
    markMap: () => page.evaluate(() => window.__falconMarkMap()),
    /** Select the first occurrence of `text` (within one paragraph). A headless page has no OS focus, so
     *  Shift-Arrow does nothing; this sets the editor selection the way a mouse drag would end up. */
    select: (text) => page.evaluate((text) => {
      const v = window.__falconView; let at = -1;
      v.state.doc.descendants((n, pos) => { if (at < 0 && n.isTextblock) { const i = n.textContent.indexOf(text); if (i >= 0) at = pos + 1 + i; } return at < 0; });
      if (at < 0) throw new Error(`text not in doc: ${text}`);
      // TextSelection via Selection.near, so this also works after Select All (AllSelection) or a NodeSelection
      const S = v.state.selection.constructor.near(v.state.doc.resolve(at)).constructor; v.dispatch(v.state.tr.setSelection(S.create(v.state.doc, at, at + text.length))); v.focus();
    }, text),
    /** Open a .docx through the tool row's Open… button and its file chooser. */
    async open(file) {
      const before = await page.locator('.doc-row').count();
      const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.tools [aria-label="Open…"]')]);
      await fc.setFiles(file);
      await page.waitForFunction(([n, name]) => [...document.querySelectorAll('.doc-row .doc-nm')].some((b) => b.getAttribute('aria-label') === name) || document.querySelectorAll('.doc-row').length > n, [before, path.basename(file, '.docx')]);
      await page.waitForTimeout(400);
    },
    /** Save with Mod-S; the web build downloads the file. Returns the saved path in evidence. */
    async save(name) {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press(`${MOD}+s`)]);
      const p = path.join(out, name ?? dl.suggestedFilename());
      await dl.saveAs(p);
      return p;
    },
    /** Write results.txt (plus page errors), close the browser, set the exit code. */
    async done() {
      if (errors.length) results.push(`FAIL page errors: ${errors.join(' | ')}`);
      const text = results.join('\n');
      fs.writeFileSync(path.join(out, 'results.txt'), text + '\n');
      console.log(text + `\nevidence: ${out}`);
      await browser.close();
      if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
    },
  };
  return f;
}
