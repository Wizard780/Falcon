// Headless checks of the paragraph window (src/editor/window.ts) on a big file: typing at the window's edges, the
// caret after scrolling away, outline jumps, find, Select All / cut, fast scrolling with nothing blank, scroll
// anchoring, tab switches, read mode, split panes. Exits 1 on any FAIL.
//   node tests/window-big-file.mjs <dist> <big.docx> <small.docx> [check,check...]
// e.g. a build from `npx vite build --outDir /tmp/dist-x` and a 15k-paragraph file
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
async function start(dist, opts = {}) {
  const server = createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = join(dist, p); if (!existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f)); });
  await new Promise((r) => server.listen(0, r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(() => { try { localStorage.setItem('falcon.tips.v1', '{"seen":true}'); } catch {} });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('PAGEERR', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('CONSOLE', m.text()); });
  await page.goto(`http://localhost:${server.address().port}/`);
  await page.waitForFunction(() => window.__falconView);
  if (await page.locator('.home.open').count()) await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const open = async (f) => { let c = null; for (let i = 0; i < 5 && !c; i++) { await page.evaluate(() => window.__falconView.focus()); c = await Promise.all([page.waitForEvent('filechooser', { timeout: 4000 }), page.keyboard.press('Meta+o')]).then(([x]) => x, () => null); } const n = basename(f).replace(/\.docx$/, ''); await c.setFiles(f); await page.waitForFunction((n) => document.querySelector(`.doc-nm[aria-label="${n}"]`) && window.__falconView.state.doc.childCount > 20, n); await page.waitForTimeout(1200); };
  return { browser, ctx, page, open, close: async () => { await browser.close(); server.close(); } };
}
const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));

const [dist, BIG, SMALL, only] = process.argv.slice(2);
const results = [];
const report = (name, ok, detail) => { results.push([name, ok, detail]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); };
const want = (n) => !only || only.split(',').includes(n);

async function boot(opts) {
  const s = await start(dist, opts);
  await s.page.addInitScript(() => { window.__errs = []; addEventListener('error', (e) => window.__errs.push(String(e.message))); });
  await s.page.evaluate(() => { window.__errs = []; addEventListener('error', (e) => window.__errs.push(String(e.message))); });
  await s.open(BIG);
  await s.page.evaluate(() => {
    // what's on screen: each top-level child crossing the viewport, and whether it shows its text
    window.__screen = () => {
      const v = window.__falconView, sc = window.__falconView.dom.closest('.f-scroll'), box = sc.getBoundingClientRect(), kids = v.dom.children, doc = v.state.doc;
      const bad = [];
      let shown = 0;
      for (let i = 0; i < doc.childCount; i++) {
        const r = kids[i].getBoundingClientRect();
        if (r.bottom <= box.top || r.top >= box.bottom) continue;
        shown++;
        const n = doc.child(i), el = kids[i];
        if (el.classList.contains('f-far')) { bad.push([i, 'placeholder on screen']); continue; }
        if (n.type.name === 'paragraph' && !document.querySelector('.f-read') && el.textContent !== n.textContent && !el.querySelector('img,.f-footnote')) bad.push([i, 'text differs', el.textContent.slice(0, 30), n.textContent.slice(0, 30)]);
        if (getComputedStyle(el).contentVisibility === 'hidden') bad.push([i, 'skipped on screen']);
      }
      return { shown, bad };
    };
    window.__top = () => { // first child starting on screen: index, offset from the scroller's top, text
      const v = window.__falconView, sc = window.__falconView.dom.closest('.f-scroll'), box = sc.getBoundingClientRect(), kids = v.dom.children;
      for (let i = 0; i < kids.length; i++) { const r = kids[i].getBoundingClientRect(); if (r.top >= box.top) return { i, off: Math.round(r.top - box.top), text: v.state.doc.child(i)?.textContent.slice(0, 40), scrollTop: sc.scrollTop }; }
      return null;
    };
    window.__win = () => window.__falconView.state['window$'];
  });
  return s;
}
const settleScroll = (page) => page.evaluate(async () => { const sc = window.__falconView.dom.closest('.f-scroll'); let last = -1, still = 0; for (let i = 0; i < 300 && still < 10; i++) { await new Promise((r) => requestAnimationFrame(r)); if (Math.abs(sc.scrollTop - last) < 0.5) still++; else still = 0; last = sc.scrollTop; } });

const s = await boot();
const { page } = s;
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

if (want('edge')) {
  // type, split and join right at the edges of the drawn range
  await page.evaluate(() => { window.__falconView.dom.closest('.f-scroll').scrollTop = 250000; });
  await settleScroll(page);
  const setup = await page.evaluate(() => {
    const v = window.__falconView, doc = v.state.doc, w = window.__win();
    // the last normal paragraph inside the window, with text
    let i = w.to - 1; while (i > w.from && !(doc.child(i).type.name === 'paragraph' && doc.child(i).attrs.style === 'normal' && doc.child(i).textContent.length > 5)) i--;
    let pos = 0; for (let k = 0; k < i; k++) pos += doc.child(k).nodeSize;
    const S = v.state.selection.constructor;
    v.dispatch(v.state.tr.setSelection(S.near(doc.resolve(pos + doc.child(i).nodeSize - 1))));
    v.focus();
    return { i, from: w.from, to: w.to, text: doc.child(i).textContent, next: doc.child(i + 1).textContent, count: doc.childCount };
  });
  await page.keyboard.type('EDGE');
  await page.keyboard.press('Enter');
  await page.keyboard.type('NEWP');
  await page.keyboard.press('Enter');
  await page.keyboard.type('NEWQ');
  const after = await page.evaluate((i) => { const d = window.__falconView.state.doc; return [d.child(i).textContent, d.child(i + 1).textContent, d.child(i + 2).textContent, d.child(i + 3).textContent, d.childCount]; }, setup.i);
  const okModel = after[0] === setup.text + 'EDGE' && after[1] === 'NEWP' && after[2] === 'NEWQ' && after[3] === setup.next && after[4] === setup.count + 2;
  // now move the caret away (a click on the paragraph at the top of the screen), scroll the new lines into view, and look
  await page.evaluate(() => { const v = window.__falconView; v.dom.children[window.__top().i].scrollIntoView({ block: 'start' }); });
  const t = await page.evaluate(() => window.__top());
  const box = await page.evaluate((i) => { const r = window.__falconView.dom.children[i].getBoundingClientRect(); return { x: r.left + 20, y: r.top + 5 }; }, t.i);
  await page.mouse.click(box.x, box.y);
  await page.evaluate((i) => window.__falconView.dom.children[i + 1].scrollIntoView({ block: 'center' }), setup.i);
  await settleScroll(page);
  const dom = await page.evaluate((i) => [1, 2, 3].map((k) => window.__falconView.dom.children[i + k - 1].textContent.slice(-12)), setup.i);
  const scr = await page.evaluate(() => window.__screen());
  report('edge: type + Enter at the window end', okModel && dom[1] === 'NEWP' && dom[2] === 'NEWQ' && !scr.bad.length, { setup: { i: setup.i, from: setup.from, to: setup.to }, after: after.map((x) => String(x).slice(-12)), dom, bad: scr.bad });
  // Backspace at the start of the first paragraph past the window: joins it to the one above
  const j = await page.evaluate(() => {
    const v = window.__falconView, doc = v.state.doc, w = window.__win();
    let i = w.to; while (i < doc.childCount - 1 && !(doc.child(i).type.name === 'paragraph' && doc.child(i - 1).type.name === 'paragraph' && doc.child(i).textContent.length > 3)) i++;
    let pos = 0; for (let k = 0; k < i; k++) pos += doc.child(k).nodeSize;
    const S = v.state.selection.constructor;
    v.dispatch(v.state.tr.setSelection(S.near(doc.resolve(pos + 1))));
    v.focus();
    return { i, a: doc.child(i - 1).textContent, b: doc.child(i).textContent, count: doc.childCount, to: w.to };
  });
  await page.keyboard.press('Backspace');
  await page.keyboard.type('J');
  await frame(page);
  const jr = await page.evaluate((i) => { const v = window.__falconView, d = v.state.doc; return { text: d.child(i - 1).textContent, count: d.childCount, dom: v.dom.children[i - 1].textContent, far: v.dom.children[i - 1].classList.contains('f-far') }; }, j.i);
  report('edge: Backspace join past the window end', jr.text === j.a + 'J' + j.b && jr.count === j.count - 1 && jr.dom === jr.text && !jr.far, { i: j.i, to: j.to, ok: jr.text === j.a + 'J' + j.b, dom: jr.dom === jr.text, far: jr.far });
  // Enter at the first paragraph of the window (top edge) then Backspace back
  const k = await page.evaluate(() => {
    const v = window.__falconView, doc = v.state.doc, w = window.__win();
    let i = w.from; while (!(doc.child(i).type.name === 'paragraph' && doc.child(i).textContent.length > 3)) i++;
    let pos = 0; for (let k = 0; k < i; k++) pos += doc.child(k).nodeSize;
    const S = v.state.selection.constructor;
    v.dispatch(v.state.tr.setSelection(S.near(doc.resolve(pos + 1))));
    v.focus();
    return { i, text: doc.child(i).textContent, count: doc.childCount, json: JSON.stringify(doc.toJSON()).length };
  });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Backspace');
  const kr = await page.evaluate((i) => { const v = window.__falconView, d = v.state.doc; return { text: d.child(i).textContent, count: d.childCount, dom: v.dom.children[i].textContent }; }, k.i);
  report('edge: Enter + Backspace at the window start', kr.text === k.text && kr.count === k.count && kr.dom === kr.text, { i: k.i, ...kr, text: kr.text.slice(0, 20) });
}

if (want('caret')) {
  // caret placed, then the page scrolled 3+ screens away without a click: arrows still move one line / paragraph
  for (const key of ['ArrowDown', 'ArrowUp', 'Shift+ArrowDown']) {
    const before = await page.evaluate(() => {
      const v = window.__falconView, sc = window.__falconView.dom.closest('.f-scroll');
      sc.scrollTop = 120000;
      return null;
    });
    void before;
    await settleScroll(page);
    const b = await page.evaluate(() => {
      const v = window.__falconView, t = window.__top(), doc = v.state.doc;
      let i = t.i + 3; while (!(doc.child(i).type.name === 'paragraph' && doc.child(i).textContent.length > 3)) i++;
      let pos = 0; for (let k = 0; k < i; k++) pos += doc.child(k).nodeSize;
      const S = v.state.selection.constructor;
      v.dispatch(v.state.tr.setSelection(S.near(doc.resolve(pos + 2))));
      v.focus();
      window.__falconView.dom.closest('.f-scroll').scrollTop += 3000;
      return { i, head: v.state.selection.head };
    });
    await settleScroll(page);
    // the first press only brings the caret back on screen (the same in the baseline build); the second moves it
    await page.keyboard.press(key); await frame(page); await settleScroll(page);
    await page.keyboard.press(key); await frame(page); await settleScroll(page);
    const a = await page.evaluate(() => { const v = window.__falconView; return { head: v.state.selection.head, anchor: v.state.selection.anchor, i: v.state.doc.resolve(v.state.selection.head).index(0), scr: window.__screen().bad }; });
    report(`caret: ${key} after scrolling away`, Math.abs(a.i - b.i) <= 1 && a.head !== b.head && Math.abs(a.head - b.head) < 400 && !a.scr.length, { before: b, after: a });
  }
  // Mod-Down / Mod-Up (mac: to the doc's end / start)
  await page.evaluate(() => { window.__falconView.dom.closest('.f-scroll').scrollTop += 5000; });
  await settleScroll(page);
  // Mod-Down / Mod-Up are the browser's own document-boundary moves; headless keys don't send them, so call the same move
  await page.evaluate(() => getSelection().modify('move', 'forward', 'documentboundary')); await frame(page); await settleScroll(page);
  const e = await page.evaluate(() => { const v = window.__falconView; return { head: v.state.selection.head, end: v.state.doc.content.size - 1, scr: window.__screen() }; });
  report('caret: move to the doc end (Mod-Down)', e.head === e.end && !e.scr.bad.length, { head: e.head, end: e.end, bad: e.scr.bad });
  await page.evaluate(() => getSelection().modify('move', 'backward', 'documentboundary')); await frame(page); await settleScroll(page);
  const st = await page.evaluate(() => { const v = window.__falconView; return { head: v.state.selection.head, scr: window.__screen(), top: window.__falconView.dom.closest('.f-scroll').scrollTop }; });
  report('caret: move to the doc start (Mod-Up)', st.head === 1 && !st.scr.bad.length, st);
}

if (want('outline')) {
  const t = await page.evaluate(() => { const rows = [...document.querySelectorAll('.sb-row[data-i]')]; return { rows: rows.length, label: rows[rows.length - 1].textContent }; });
  await page.locator('.sb-row[data-i]').last().click();
  await settleScroll(page);
  const r = await page.evaluate(() => {
    const v = window.__falconView, doc = v.state.doc, sc = window.__falconView.dom.closest('.f-scroll');
    const last = doc.resolve(v.state.selection.head).index(0); // the outline puts the caret in the heading it jumps to
    const el = v.dom.children[last], r = el.getBoundingClientRect(), box = sc.getBoundingClientRect();
    return { last, text: doc.child(last).textContent.slice(0, 40), off: r.top - box.top, far: el.classList.contains('f-far'), atEnd: sc.scrollTop >= sc.scrollHeight - sc.clientHeight - 1, scr: window.__screen() };
  });
  report('outline: jump to the last heading lands', !r.far && (Math.abs(r.off - 16) < 4 || (r.atEnd && r.off >= 0 && r.off < 900)) && !r.scr.bad.length, { ...t, ...r, scr: r.scr.bad });
  // a heading in the middle
  const mi = await page.evaluate(() => Math.floor(document.querySelectorAll('.sb-row[data-i]').length * 0.6));
  const mid = await page.locator('.sb-row[data-i]').nth(mi).textContent();
  await page.locator('.sb-row[data-i]').nth(mi).click();
  await settleScroll(page);
  const m = await page.evaluate(() => { const t = window.__top(); return { t, scr: window.__screen() }; });
  report('outline: jump to a middle heading lands at 16px', m.t.off >= 12 && m.t.off <= 20 && mid.slice(0, 10) === m.t.text.slice(0, 10) && !m.scr.bad.length, { mid, ...m.t, bad: m.scr.bad });
}

if (want('find')) {
  const word = await page.evaluate(() => {
    const doc = window.__falconView.state.doc, n = doc.childCount, firstSeen = new Map();
    doc.forEach((p, _o, i) => { for (const w of p.textContent.toLowerCase().match(/[a-z]{9,}/g) ?? []) if (!firstSeen.has(w)) firstSeen.set(w, i); });
    for (const [w, i] of firstSeen) if (i > n * 0.95) return w;
    return null;
  });
  await page.evaluate(() => { window.__falconView.dom.closest('.f-scroll').scrollTop = 0; });
  await settleScroll(page);
  await page.evaluate(() => window.__falconView.focus());
  await page.keyboard.press(`${mod}+f`);
  await page.waitForSelector('.findbar input');
  await page.fill('.findbar input', word);
  await page.keyboard.press('Enter');
  await settleScroll(page);
  const f = await page.evaluate((word) => {
    const v = window.__falconView, sel = v.state.selection, sc = window.__falconView.dom.closest('.f-scroll'), box = sc.getBoundingClientRect();
    const txt = v.state.doc.textBetween(sel.from, sel.to).toLowerCase();
    const c = v.coordsAtPos(sel.from);
    return { txt, onScreen: c.top >= box.top && c.bottom <= box.bottom, i: v.state.doc.resolve(sel.from).index(0), of: v.state.doc.childCount, scr: window.__screen() };
  }, word);
  report('find: a word only late in the file', f.txt === word && f.onScreen && !f.scr.bad.length, { word, ...f, scr: f.scr.bad });
  await page.keyboard.press('Escape');
}

if (want('copy')) {
  await page.evaluate(() => { window.__falconView.dom.closest('.f-scroll').scrollTop = 90000; });
  await settleScroll(page);
  const box = await page.evaluate(() => { const t = window.__top(); const r = window.__falconView.dom.children[t.i + 1].getBoundingClientRect(); return { x: r.left + 30, y: r.top + 5 }; });
  await page.mouse.click(box.x, box.y);
  await page.keyboard.press(`${mod}+a`);
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.keyboard.press(`${mod}+c`);
  await page.waitForTimeout(300);
  const c = await page.evaluate(async () => { const v = window.__falconView, t = await navigator.clipboard.readText(); return { clip: t.length, doc: v.state.doc.textBetween(0, v.state.doc.content.size, '\n\n').length, sel: v.state.selection.constructor.name, head5: t.slice(0, 20), tail: t.slice(-20) }; });
  report('copy: Select All then copy', c.clip > 0 && Math.abs(c.clip - c.doc) <= c.doc * 0.001, c);
  // a long selection across thousands of far paragraphs: cut, then undo
  const before = await page.evaluate(() => {
    const v = window.__falconView, doc = v.state.doc, S = v.state.selection.constructor;
    let a = 0, b = 0, pos = 0; doc.forEach((n, o, i) => { if (i === 60) a = o + 1; if (i === 9000) b = o + 1; });
    v.dispatch(v.state.tr.setSelection(window.__falconView.state.selection.constructor.create ? v.state.selection.constructor.create(doc, a, b) : S.near(doc.resolve(a))));
    window.__doc0 = doc;
    return { a, b, text: doc.textBetween(a, b, '\n\n').length, count: doc.childCount };
  });
  // TextSelection.create via the class of a text selection
  await page.evaluate(({ a, b }) => { const v = window.__falconView; const TS = v.state.selection.constructor; const doc = v.state.doc; const $a = doc.resolve(a); const sel = TS.between ? TS.between($a, doc.resolve(b)) : null; v.dispatch(v.state.tr.setSelection(sel)); v.focus(); }, before);
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.keyboard.press(`${mod}+x`);
  await page.waitForTimeout(300);
  const cut = await page.evaluate(async () => { const v = window.__falconView; return { clip: (await navigator.clipboard.readText()).length, count: v.state.doc.childCount, scr: window.__screen() }; });
  await page.keyboard.press(`${mod}+z`);
  await frame(page);
  const undone = await page.evaluate(() => window.__falconView.state.doc.eq(window.__doc0));
  report('copy: cut a long selection, then undo', Math.abs(cut.clip - before.text) <= 2 && cut.count === before.count - 8940 && undone && !cut.scr.bad.length, { before, cut: { ...cut, scr: cut.scr.bad }, undone });
}

if (want('blank')) {
  // fast scrolling: check what's on screen after every frame
  const r = await page.evaluate(async () => {
    const sc = window.__falconView.dom.closest('.f-scroll'); sc.scrollTop = 0;
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const bad = []; let frames = 0;
    while (sc.scrollTop < sc.scrollHeight - sc.clientHeight - 1) {
      sc.scrollTop += 3000;
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      frames++;
      const s = window.__screen(); if (s.bad.length || !s.shown) bad.push([sc.scrollTop, s.bad.slice(0, 2)]);
      if (frames > 2000) break;
    }
    return { frames, bad: bad.length, sample: bad.slice(0, 3) };
  });
  report('blank: 3000px a frame to the bottom', !r.bad, r);
  const j = await page.evaluate(async () => {
    const sc = window.__falconView.dom.closest('.f-scroll'); const out = [];
    for (const f of [0.5, 0, 1, 0.25, 0.8, 0.1]) { sc.scrollTop = f * (sc.scrollHeight - sc.clientHeight); await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); const s = window.__screen(); out.push([f, s.shown, s.bad.length]); }
    return out;
  });
  report('blank: scrollbar-style jumps', j.every(([, sh, b]) => sh && !b), j);
  // wheel
  await page.mouse.move(700, 450);
  let wb = 0;
  for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, -2500); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))); const s = await page.evaluate(() => window.__screen()); if (s.bad.length) wb++; }
  report('blank: mouse wheel 2500px', !wb, { badFrames: wb });
}

if (want('anchor')) {
  // fresh page so the text near the end is unvisited: scroll up 100px a frame; text must move exactly 100px
  const s2 = await boot();
  const r = await s2.page.evaluate(async () => {
    const sc = window.__falconView.dom.closest('.f-scroll'), v = window.__falconView;
    sc.scrollTop = sc.scrollHeight; await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    await new Promise((r) => setTimeout(r, 300));
    const bad = []; const h0 = sc.scrollHeight;
    for (let f = 0; f < 80; f++) {
      const t = window.__top(), el = v.dom.children[t.i], y = el.getBoundingClientRect().top;
      sc.scrollTop -= 100;
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      const d = el.isConnected ? el.getBoundingClientRect().top - y : v.dom.children[t.i].getBoundingClientRect().top - y;
      if (Math.abs(d - 100) > 1.5) bad.push([f, Math.round(d)]);
    }
    return { bad: bad.length, sample: bad.slice(0, 6), heightChange: Math.round(sc.scrollHeight - h0) };
  });
  report('anchor: scrolling up through unvisited text moves it 100px a frame', !r.bad, r);
  await s2.close();
}

if (want('tabs')) {
  await page.evaluate(() => { window.__falconView.dom.closest('.f-scroll').scrollTop = 333333; });
  await settleScroll(page);
  const a = await page.evaluate(() => window.__top());
  await s.open(SMALL);
  await page.evaluate(() => window.__falconView.dom.closest('.f-scroll').scrollTop = 5000);
  await settleScroll(page);
  const nm = basename(BIG).replace(/\.docx$/, '');
  await page.evaluate((nm) => document.querySelector(`.doc-nm[aria-label="${nm}"]`).click(), nm);
  await settleScroll(page);
  await page.waitForTimeout(300);
  const b = await page.evaluate(() => ({ ...window.__top(), scr: window.__screen() }));
  report('tabs: switch away and back keeps the place', a.i === b.i && Math.abs(a.off - b.off) <= 2 && a.text === b.text && !b.scr.bad.length, { a, b: { ...b, scr: b.scr.bad } });
}

if (want('read')) {
  await page.evaluate(() => { window.__falconView.dom.closest('.f-scroll').scrollTop = 0; window.__falconView.focus(); });
  await page.keyboard.press(`${mod}+Shift+r`);
  await page.waitForTimeout(500);
  const r = await page.evaluate(async () => {
    const sc = window.__falconView.dom.closest('.f-scroll'), v = window.__falconView;
    const on = !!document.querySelector('.f-read');
    const h0 = sc.scrollHeight; const bad = []; let frames = 0;
    while (sc.scrollTop < sc.scrollHeight - sc.clientHeight - 1 && frames < 3000) {
      sc.scrollTop += 1500; frames++;
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      const s = window.__screen(); if (s.bad.length || !s.shown) bad.push(sc.scrollTop);
    }
    return { on, h0, h1: sc.scrollHeight, frames, bad: bad.length };
  });
  report('read mode: scroll to the bottom, nothing blank', r.on && !r.bad, r);
  const ri = await page.evaluate(() => Math.floor(document.querySelectorAll('.sb-row[data-i]').length * 0.7));
  const rows = await page.locator('.sb-row[data-i]').nth(ri).textContent();
  await page.locator('.sb-row[data-i]').nth(ri).click();
  await settleScroll(page);
  const m = await page.evaluate(() => ({ t: window.__top(), scr: window.__screen() }));
  report('read mode: outline jump lands', m.t.off >= 10 && m.t.off <= 22 && rows.slice(0, 10) === m.t.text.slice(0, 10) && !m.scr.bad.length, { rows, t: m.t, bad: m.scr.bad });
  await page.evaluate(() => window.__falconView.focus());
  await page.keyboard.press(`${mod}+Shift+r`);
  await page.waitForTimeout(300);
}

if (want('split')) {
  // two files side by side: the big one in a narrower pane, a view of its own
  await s.open(SMALL);
  const row = (n) => page.locator('.fs-docs .doc-row', { has: page.locator(`.doc-nm[aria-label="${n}"]`) });
  const big = basename(BIG).replace(/\.docx$/, ''), small = basename(SMALL).replace(/\.docx$/, '');
  await row(big).locator('.doc-nm').click({ modifiers: ['Shift'] });
  await row(small).locator('.doc-nm').click({ modifiers: ['Shift'] });
  await page.mouse.move(900, 700);
  await row(small).click({ button: 'right' });
  await page.waitForTimeout(200);
  await page.click('.rail-menu .mn-i:has-text("Join")');
  await page.mouse.move(900, 700);
  await page.waitForTimeout(800);
  const panes = await page.$$eval('.split .pane', (ps) => ps.map((p) => ({ name: p.querySelector('.pane-h .nm')?.textContent, w: Math.round(p.getBoundingClientRect().width), kids: p.querySelector('.ProseMirror').childElementCount })));
  const bi = panes.findIndex((p) => p.name === big);
  const pm = page.locator('.split .pane').nth(bi).locator('.ProseMirror');
  const bb = await pm.boundingBox();
  await page.mouse.click(bb.x + 40, bb.y + 40);
  await page.waitForTimeout(300);
  const r = await page.evaluate(async () => {
    const v = window.__falconView, sc = v.dom.closest('.f-scroll'); sc.scrollTop = 0;
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const bad = []; let frames = 0;
    while (sc.scrollTop < sc.scrollHeight - sc.clientHeight - 1 && frames < 3000) {
      sc.scrollTop += 3000; frames++;
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      const s = window.__screen(); if (s.bad.length || !s.shown) bad.push([sc.scrollTop, s.bad.slice(0, 2)]);
    }
    return { count: v.state.doc.childCount, width: v.dom.clientWidth, frames, bad: bad.length, sample: bad.slice(0, 3) };
  });
  report('split: the big file in a pane scrolls with nothing blank', panes.length === 2 && r.count > 15000 && !r.bad, { panes, ...r });
  // and the other pane (the small file) still shows its own text
  const other = await page.locator('.split .pane').nth(1 - bi).locator('.ProseMirror').evaluate((el) => ({ kids: el.childElementCount, far: el.querySelectorAll('.f-far').length, text: el.textContent.length }));
  report('split: the other pane is drawn', other.kids > 100 && other.text > 1000, other);
}

const errs = await page.evaluate(() => window.__errs);
report('no window errors (ResizeObserver loop etc.)', !errs.length, errs.slice(0, 5));
await s.close();
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} passed`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
