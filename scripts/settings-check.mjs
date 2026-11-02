// Every Settings row, changed in the Settings panel and checked in the app or the editor.
// Usage: vite preview, then  node scripts/settings-check.mjs <a.docx> [port=5190] [shots dir=/tmp]
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [file, port = '5190', shots = '/tmp'] = process.argv.slice(2);
const URL = `http://localhost:${port}/`;
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const browser = await chromium.launch();
const results = [];
const want = (ok, what) => results.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
const errors = [];
// ONLY=editor (or general, reopen, appearance, read, timers) runs one part
const part = (name) => !process.env.ONLY || process.env.ONLY === name;

async function fresh(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  if (opts.init) await ctx.addInitScript(opts.init.fn, opts.init.arg);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: URL });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  if (opts.clock) await page.clock.install();
  await page.goto(URL);
  if (!opts.keep) { await page.evaluate(() => localStorage.clear()); await page.reload(); }
  await page.waitForSelector('.ProseMirror');
  if (await page.$('.home.open')) await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return page;
}

// ---- helpers: Settings controls, and the doc ----
const open = async (p, title) => {
  if (!(await p.$('.st'))) { await p.keyboard.press(`${mod}+,`); await p.waitForSelector('.st'); }
  await p.click(`.st-navb:has-text("${title}")`);
};
const close = async (p) => { await p.keyboard.press('Escape'); await p.waitForTimeout(80); if (await p.$('.st')) { await p.keyboard.press('Escape'); await p.waitForTimeout(80); } };
const row = (label) => `.st-row:has(.st-txt > span:text-is("${label}"))`;
const tog = (p, label) => p.click(`${row(label)} .st-tog`);
const seg = (p, label, text) => p.click(`${row(label)} .st-seg button:text-is("${text}")`);
const sel = (p, label, value) => p.selectOption(`${row(label)} select`, String(value));
/** Replace the doc with [style, text] paragraphs. */
const setDoc = (p, paras) => p.evaluate((paras) => {
  const v = window.__falconView, s = v.state.schema;
  v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, paras.map(([st, t]) => s.node('paragraph', { style: st }, t ? [s.text(t)] : []))));
}, paras);
/** Select `text` (or put the caret `off` characters into it when off is a number). */
const pick = (p, text, off) => p.evaluate(([text, off]) => {
  const v = window.__falconView;
  let from = -1;
  v.state.doc.descendants((n, pos) => { if (from < 0 && n.isTextblock && n.textContent.includes(text)) from = pos + 1 + n.textContent.indexOf(text); return from < 0; });
  const TS = v.state.selection.constructor;
  v.dispatch(v.state.tr.setSelection(off === undefined ? TS.create(v.state.doc, from, from + text.length) : TS.create(v.state.doc, from + off)));
  v.focus();
}, [text, off]);
const mm = (p) => p.evaluate(() => window.__falconMarkMap());
const css = (p, selector, prop, pseudo) => p.$eval(selector, (el, [prop, pseudo]) => getComputedStyle(el, pseudo)[prop], [prop, pseudo]);
const key = async (p, k) => { await p.keyboard.press(k); await p.waitForTimeout(60); };
const STYLES = [['pocket', 'Pocket line'], ['hat', 'Hat line'], ['block', 'Block line'], ['tag', 'Tag line'], ['normal', 'Smith 24 cite text'], ['normal', 'body text [Table Omitted] more'], ['analytic', 'Analytic line'], ['undertag', 'Undertag line']];
const markAll = async (p) => {
  await setDoc(p, STYLES);
  await pick(p, 'Smith 24'); await key(p, 'F8');
  await pick(p, 'body'); await key(p, 'F10');
  await pick(p, 'more'); await key(p, `${mod}+F11`);
};

// =============== General ===============
if (part('general')) {
  const p = await fresh();
  await open(p, 'General');
  await sel(p, 'Open on launch', 'doc');
  await p.reload(); await p.waitForSelector('.ProseMirror'); await p.waitForTimeout(200);
  want(!(await p.$('.home.open')), 'Open on launch Last document: launches straight to the document');
  await open(p, 'General'); await sel(p, 'Open on launch', 'home');
  await p.reload(); await p.waitForSelector('.ProseMirror'); await p.waitForTimeout(200);
  want(!!(await p.$('.home.open')), 'Open on launch Home: launches on Home');
  await p.keyboard.press('Escape');

  // ask before closing
  await p.keyboard.type('x');
  await p.waitForTimeout(100);
  await p.keyboard.press(`${mod}+w`); await p.waitForTimeout(150);
  want(!!(await p.$('.cf')), 'Unsaved changes confirmation on: closing asks');
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  await open(p, 'General'); await tog(p, 'Unsaved changes confirmation'); await close(p);
  await p.keyboard.press(`${mod}+w`); await p.waitForTimeout(150);
  want(!(await p.$('.cf')) && !(await mm(p)).includes('x'), 'Unsaved changes confirmation off: closes without asking');
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);

  // crash recovery
  await p.focus('.ProseMirror'); await p.keyboard.type('keep me'); await p.waitForTimeout(1500);
  want(!!(await p.evaluate(() => localStorage.getItem('falcon.autosave.v2'))), 'Crash recovery on: a backup is kept');
  await open(p, 'General'); await tog(p, 'Crash recovery'); await close(p);
  await p.focus('.ProseMirror'); await p.keyboard.type(' more'); await p.waitForTimeout(1500);
  want(!(await p.evaluate(() => localStorage.getItem('falcon.autosave.v2'))), 'Crash recovery off: no backup is kept');

  // recent files
  await p.evaluate(() => localStorage.setItem('falcon.recents.v1', JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ name: `File ${i}`, folder: '', cards: 0, blocks: [], when: Date.now() })))));
  await p.reload(); await p.waitForSelector('.home.open');
  const homeRows = () => p.$$eval('.hm-row', (r) => r.length);
  const n12 = await homeRows();
  await p.keyboard.press(`${mod}+,`); await p.waitForSelector('.st'); await open(p, 'General');
  await seg(p, 'Recent files', '6');
  const n6 = await homeRows();
  await seg(p, 'Recent files', '24');
  const n24 = await homeRows();
  want(n12 === 12 && n6 === 6 && n24 === 20, `Recent files: Home lists 12, then 6, then all 20 (${n12}, ${n6}, ${n24})`);
  await seg(p, 'Recent files', '6'); await close(p);
  await p.reload(); await p.waitForSelector('.home.open'); await p.waitForTimeout(200);
  want((await p.evaluate(() => JSON.parse(localStorage.getItem('falcon.recents.v1')).length)) === 20, 'Recent files 6 keeps the rest of the list for later');
  await p.keyboard.press(`${mod}+,`); await p.waitForSelector('.st'); await open(p, 'General'); await seg(p, 'Recent files', '12');
  await close(p); await p.keyboard.press('Escape');

  // name for new files
  await open(p, 'General'); await sel(p, 'Name new files', 'date'); await close(p);
  await p.keyboard.press(`${mod}+n`); await p.waitForTimeout(100);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press(`${mod}+s`)]);
  want(/^\d{4}-\d\d-\d\d\.docx$/.test(dl.suggestedFilename()), `Name new files: an Untitled doc saves as the date (${dl.suggestedFilename()})`);
  await open(p, 'General'); await sel(p, 'Name new files', 'speech'); await close(p);
  await p.keyboard.press(`${mod}+n`); await p.waitForTimeout(100);
  const [dl2] = await Promise.all([p.waitForEvent('download'), p.keyboard.press(`${mod}+s`)]);
  want(/^Speech \d+-\d+ \d+-\d\d[AP]M\.docx$/.test(dl2.suggestedFilename()), `Name new files: or as Speech and the time (${dl2.suggestedFilename()})`);

  // outline
  await open(p, 'Editor'); await tog(p, 'Show outline pane');
  want(await p.$eval('.app', (x) => x.classList.contains('no-outline')), 'Show outline pane off hides the outline');
  await tog(p, 'Show outline pane');
  await p.click(`${row('Outline depth')} button:text-is("2")`);
  want(await p.$eval('.lv [data-lv="2"]', (x) => x.hasAttribute('data-on')), 'Outline depth sets the outline depth');
  await seg(p, 'Depth for opened files', '1'); await close(p);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('.tools [aria-label="Open…"]')]);
  await fc.setFiles(file); await p.waitForTimeout(600);
  want(await p.$eval('.lv [data-lv="1"]', (x) => x.hasAttribute('data-on')), 'Depth for opened files: an opened file shows depth 1');
  await p.screenshot({ path: `${shots}/settings-check-opened.png` });
  await p.context().close();
}

// reopen last files, with a stand-in for the desktop bridge
if (part('reopen')) {
  const data = [...readFileSync(file)];
  const name = file.split('/').pop();
  const init = { fn: ([data, name]) => {
    window.falcon = { openPath: async (path) => ({ name, path, data: new Uint8Array(data) }) };
  }, arg: [data, name] };
  const p = await fresh({ init });
  await open(p, 'General'); await tog(p, 'Restore open files');
  await p.evaluate((name) => localStorage.setItem('falcon.session', JSON.stringify([`/files/${name}`])), name);
  await p.reload(); await p.waitForSelector('.ProseMirror'); await p.waitForTimeout(800);
  const rows = await p.$$eval('.doc-row .doc-nm', (r) => r.map((x) => x.getAttribute('aria-label')));
  want(rows.includes(name.replace(/\.docx$/, '')), `Restore open files: the last session's file opens at launch (${rows})`);
  await p.context().close();
}

// =============== Appearance, Text and styles ===============
if (part('appearance')) {
  const p = await fresh();
  await markAll(p);
  await open(p, 'Appearance');
  await p.click(`${row('Highlighter')} [aria-label="Green"]`);
  want((await p.$eval('.app', (x) => x.style.getPropertyValue('--ink'))).toUpperCase() === '#00FF00', 'Highlighter picks the pen (and the outline color)');
  await p.click('[aria-label="More zoom"]');
  want((await p.evaluate(() => document.documentElement.style.getPropertyValue('--zoom'))) === '1.1', 'Zoom + makes the page 110%');
  await p.click('[aria-label="Less zoom"]');
  await tog(p, 'Zoom with the scroll wheel'); await close(p);
  await p.mouse.move(800, 400);
  await p.keyboard.down('Control'); await p.mouse.wheel(0, -120); await p.keyboard.up('Control'); await p.waitForTimeout(100);
  want((await p.$eval('.status .zoom', (x) => x.textContent)) === '110%', 'Zoom with the scroll wheel: Ctrl+scroll zooms in');
  await p.keyboard.press(`${mod}+0`);

  await open(p, 'Appearance');
  await seg(p, 'Document paper', 'Dark');
  want((await css(p, '.f-scroll', 'backgroundColor')) === 'rgb(30, 30, 32)' && (await css(p, '.ProseMirror p', 'color')) === 'rgb(230, 230, 230)', 'Dark page: dark page, light text');
  want((await css(p, '.f-shading', 'color')) === 'rgb(17, 17, 17)', 'Dark page: shaded text keeps dark ink');
  await p.screenshot({ path: `${shots}/settings-check-dark.png` });
  await seg(p, 'Document paper', 'White');
  await seg(p, 'Text width', 'Narrow');
  want((await css(p, '.page', 'maxWidth')) === '680px', 'Text width Narrow caps the text at 680px');
  await seg(p, 'Margins', 'Wide');
  want((await css(p, '.page', 'paddingLeft')) === '72px', 'Margins Wide gives 72px margins');
  await seg(p, 'Text width', 'Full'); await seg(p, 'Margins', 'Normal');
  want((await css(p, '.page', 'maxWidth')) === 'none' && (await css(p, '.page', 'paddingLeft')) === '30px', 'Full width and Normal margins put the page back');

  await p.click(`${row('Cursor color')} button:text-is("Red")`);
  want((await css(p, '.ProseMirror', 'caretColor')) === 'rgb(225, 29, 72)', 'Cursor color Red');
  await p.click(`${row('Selection color')} button:text-is("Gray")`);
  want((await css(p, '.ProseMirror p', 'backgroundColor', '::selection')) === 'rgba(0, 0, 0, 0.16)', 'Selection color Gray');
  await close(p);
  await pick(p, 'body', 0);
  want((await css(p, '.f-cur-card', 'display', '::before')) !== 'none', 'the current card is marked');
  await open(p, 'Appearance'); await tog(p, 'Mark the current card');
  want((await css(p, '.f-cur-card', 'display', '::before')) === 'none', 'Mark the current card off hides the line');
  await tog(p, 'Reduce motion');
  want((await css(p, '.toast', 'transitionDuration')) === '0s', 'Reduce motion turns off transitions');
  await tog(p, 'Reduce motion');
  want((await css(p, '.toast', 'transitionDuration')) !== '0s', 'Reduce motion off: transitions are back');

  await open(p, 'Formatting');
  await sel(p, 'Font', 'verdana');
  want((await css(p, '.ProseMirror', 'fontFamily')).startsWith('Verdana'), 'Font Verdana');
  await seg(p, 'Line spacing', '1.5');
  want((await css(p, '.ProseMirror', 'lineHeight')) === `${(11 * 4 / 3) * 1.5}px`, `Line spacing 1.5 (${await css(p, '.ProseMirror', 'lineHeight')})`);
  for (const [label, selector, pt] of [['Body text', '.ProseMirror', 11], ['Pocket', '.f-pocket', 26], ['Hat', '.f-hat', 22], ['Block', '.f-block', 16], ['Tag', '.f-tag', 13], ['Cite', '.f-cite', 13], ['Analytic', '.f-analytic', 13], ['Undertag', '.f-undertag', 11]]) {
    await sel(p, label, pt + 2);
    const px = parseFloat(await css(p, selector, 'fontSize'));
    want(Math.abs(px - (pt + 2) * 4 / 3) < 0.05, `${label} at ${pt + 2} pt shows ${label.toLowerCase()} at ${pt + 2} pt (${px}px)`);
  }
  await p.fill(`${row('Analytic color')} input`, '#aa0000');
  want((await css(p, '.f-analytic', 'color')) === 'rgb(170, 0, 0)', 'Analytic color');
  await p.fill(`${row('Undertag color')} input`, '#0000aa');
  want((await css(p, '.f-undertag', 'color')) === 'rgb(0, 0, 170)', 'Undertag color');
  await tog(p, 'Bold cites');
  want((await css(p, '.f-cite', 'fontWeight')) === '400', 'Bold cites off: cites at normal weight');
  await sel(p, 'Emphasis', 'bold');
  want((await css(p, '.f-emphasis', 'borderTopWidth')) === '0px', 'Emphasis Bold only: no box');
  await tog(p, 'Box around pockets');
  want((await css(p, '.f-pocket', 'borderTopWidth')) === '0px', 'Box around pockets off');
  await seg(p, 'Hat underline', 'Single');
  want((await css(p, '.f-hat', 'textDecorationStyle')) === 'solid', 'Hat underline Single');
  await tog(p, 'Dots on background color');
  want((await css(p, '.f-shading', 'backgroundImage')).includes('radial-gradient'), 'Dots on background color');
  await close(p);
  await p.screenshot({ path: `${shots}/settings-check-styles.png` });
  want(!(await mm(p)).includes('size:'), 'display settings leave the document untouched');

  // search and restore defaults
  await open(p, 'General');
  const found = async (q) => { await p.fill('.st-search input', q); return (await p.$$eval('.st-row .st-txt > span', (x) => x.map((e) => e.textContent))).join(','); };
  await p.keyboard.press('/');
  for (const [q, rows] of [['dark', 'Document paper'], ['¶', 'F3 condenses to,Small ¶ marks'], ['words per minute', 'Reader 1,Reader 2'], ['marker', 'Marker color,Marker shows the time,Read marker']]) {
    const got = await found(q);
    want(got === rows, `search "${q}" finds ${rows} (${got})`);
  }
  await p.screenshot({ path: `${shots}/settings-search.png` });
  await p.fill('.st-search input', '');
  await p.click('.st-restore'); await p.waitForTimeout(100);
  const left = await p.evaluate(() => Object.keys(localStorage).filter((k) => /^falcon\.(font|sz\.|color\.|citeBold|emphasisBox|pocketBox|hatLine|shadingDots|caret|cardBar|lineHeight)/.test(k)));
  want(left.length === 0 && (await css(p, '.ProseMirror', 'fontFamily')).startsWith('Calibri') && (await css(p, '.f-cite', 'fontWeight')) === '700'
    && (await css(p, '.f-pocket', 'borderTopWidth')) === '3px' && (await css(p, '.f-analytic', 'color')) === 'rgb(31, 63, 138)', `Restore defaults clears every setting and puts the look back (${left})`);
  await p.context().close();
}

// =============== Editor ===============
if (part('editor')) {
  const p = await fresh();
  const card = [['tag', 'Tag one'], ['normal', 'Smith 24'], ['normal', 'Professor, MIT'], ['normal', 'first   para'], ['normal', 'second para'], ['tag', 'Tag two'], ['normal', '']];
  const body = async () => (await mm(p)).split('\n');
  await setDoc(p, card); await pick(p, 'second', 1); await key(p, 'F3');
  want((await body())[3] === 'normal: first para' && (await body())[4] === 'normal: second para', 'F3 keeps paragraphs by default');
  await open(p, 'Editor'); await seg(p, 'F3 condenses to', 'Merge'); await close(p);
  await setDoc(p, card); await pick(p, 'second', 1); await key(p, 'F3');
  want((await body())[1] === 'normal: Smith 24' && (await body())[2] === 'normal: Professor, MIT first para second para', `F3 condenses to Merge, leaving the cite line (${(await body())[2]})`);
  await open(p, 'Editor'); await seg(p, 'F3 condenses to', 'Merge with ¶'); await tog(p, 'Small ¶ marks'); await close(p);
  await setDoc(p, card); await pick(p, 'second', 1); await key(p, 'F3');
  want((await body())[2] === 'normal: Professor, MIT[ ¶ ]{size:6pt}first para[ ¶ ]{size:6pt}second para', `F3 merges with small ¶ marks (${(await body())[2]})`);

  await open(p, 'Editor'); await seg(p, 'F3 condenses to', 'Merge'); await tog(p, 'Condense after Paste Text'); await close(p);
  await setDoc(p, [['tag', 'T'], ['normal', '']]);
  await p.evaluate(() => navigator.clipboard.writeText('one   two\nthree'));
  await pick(p, 'T', 1); await key(p, 'ArrowDown'); await key(p, 'F2'); await p.waitForTimeout(150);
  want((await body())[1] === 'normal: one two three', `Condense after Paste Text: F2 pastes condensed (${(await body())[1]})`);

  // shrink
  await setDoc(p, [['tag', 'T'], ['normal', 'cite'], ['normal', 'read this [Table Omitted] not this']]);
  await pick(p, 'read this'); await key(p, 'F9');
  await open(p, 'Formatting'); await sel(p, 'Unread text', 8); await close(p);
  await pick(p, 'not', 1); await key(p, `${mod}+8`);
  const once = (await body())[2];
  await key(p, `${mod}+8`);
  want(once.includes('{size:8pt}') && !(await body())[2].includes('size:'), `Shrink down to 8 pt: the second Shrink starts over (${once})`);
  await open(p, 'Editor'); await tog(p, 'Keep omission notes full size'); await close(p);
  await key(p, `${mod}+8`);
  want((await body())[2].includes('[ [Table Omitted] not this]{size:8pt}'), `Keep omission notes off: the note shrinks too (${(await body())[2]})`);

  // smart paste
  const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office"><body><p><span class="Emphasis">big</span> words</p></body></html>';
  const paste = () => p.evaluate((html) => {
    const v = window.__falconView, dt = new DataTransfer();
    dt.setData('text/html', html); dt.setData('text/plain', 'big words');
    v.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, html);
  await setDoc(p, [['normal', '']]); await pick(p, '', 0).catch(() => {});
  await p.evaluate(() => { const v = window.__falconView; v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, 1))); v.focus(); });
  await paste();
  const smartOn = await mm(p);
  await open(p, 'Editor'); await tog(p, 'Smart paste'); await close(p);
  await setDoc(p, [['normal', '']]);
  await p.evaluate(() => { const v = window.__falconView; v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, 1))); v.focus(); });
  await paste();
  const smartOff = await mm(p);
  want(smartOn.includes('{emphasis}') && !smartOff.includes('emphasis') && smartOff.includes('big words'), `Smart paste: Word emphasis converts when on, not when off (${smartOn} / ${smartOff})`);

  // copy previous cite
  await setDoc(p, card);
  await pick(p, 'Smith 24'); await key(p, 'F8'); await pick(p, 'Professor, MIT'); await key(p, 'F8');
  const atEnd = () => p.evaluate(() => { const v = window.__falconView; v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, v.state.doc.content.size - 1))); v.focus(); });
  await atEnd(); await key(p, 'Alt+F8');
  want((await body()).slice(6).join('|') === 'normal: [Smith 24]{cite}', 'Copy previous cite copies the first cite line');
  await key(p, `${mod}+z`);
  await open(p, 'Editor'); await tog(p, 'Copy previous cite: first line only'); await close(p);
  await atEnd(); await key(p, 'Alt+F8');
  want((await body()).slice(6).join('|') === 'normal: [Smith 24]{cite}|normal: [Professor, MIT]{cite}', `Copy previous cite: first line only off copies both cite lines (${(await body()).slice(6)})`);

  // highlight underlined only
  await setDoc(p, [['tag', 'T'], ['normal', 'one two three four']]);
  await pick(p, 'two three'); await key(p, 'F9');
  await open(p, 'Editor'); await tog(p, 'Highlight underlined text only'); await close(p);
  await pick(p, 'one two three four'); await key(p, 'F11');
  want((await body())[1] === 'normal: one [two three]{highlight:yellow+underline} four', `Highlight underlined text only (${(await body())[1]})`);

  // Enter at the end of each heading
  for (const [st, label, to] of [['pocket', 'After a pocket', 'hat'], ['hat', 'After a hat', 'block'], ['block', 'After a block', 'tag'], ['tag', 'After a tag', 'tag'], ['analytic', 'After an analytic', 'analytic'], ['undertag', 'After an undertag', 'tag']]) {
    await open(p, 'Editor'); await sel(p, label, to); await close(p);
    await setDoc(p, [[st, 'Line']]); await pick(p, 'Line', 4); await key(p, 'Enter');
    want((await body())[1] === `${to}: `, `${label}, Enter starts a ${to} (${(await body())[1]})`);
  }
  await p.context().close();
}

// =============== Read mode ===============
if (part('read')) {
  const p = await fresh();
  await setDoc(p, [['tag', 'Tag'], ['undertag', 'Undertag note'], ['normal', 'Smith 24 qualifications'], ['normal', 'one'], ['normal', 'two shaded']]);
  await pick(p, 'Smith 24'); await key(p, 'F8');
  await pick(p, 'one'); await key(p, 'F11');
  await pick(p, 'two'); await key(p, 'F11');
  await pick(p, 'shaded'); await key(p, `${mod}+F11`);
  await pick(p, 'two', 1);
  await key(p, `${mod}+Shift+r`);
  want(await p.evaluate(() => document.querySelector('.ProseMirror').classList.contains('f-read')), 'Mod-Shift-R turns read mode on');
  // is the text drawn? (hidden runs and paragraphs lay out with no size)
  const vis = (t) => p.evaluate((t) => {
    const w = document.createTreeWalker(document.querySelector('.ProseMirror'), NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = n.data.indexOf(t);
      if (i < 0) continue;
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + t.length);
      return r.getBoundingClientRect().width > 0;
    }
    return false;
  }, t);
  const readBtn = () => p.click('.tools [aria-label="Read mode"]');
  const flows = () => p.$$eval('.f-read-flow', (x) => x.length);
  want(!(await vis('Undertag note')) && !(await vis('qualifications')) && !(await vis('shaded')) && (await flows()) === 2, 'read mode by default hides undertags, the rest of the cite and background color, and runs paragraphs together');
  // changed while reading: redraws at once
  await open(p, 'Editor');
  await tog(p, 'Keep paragraphs apart');
  want((await flows()) === 0, 'Keep paragraphs apart: paragraphs stay on their own lines (live)');
  await tog(p, 'Show the whole cite');
  want(await vis('qualifications'), 'Show the whole cite');
  await tog(p, 'Show undertags');
  want(await vis('Undertag note'), 'Show undertags');
  await tog(p, 'Show background color');
  want(await vis('shaded'), 'Show background color');
  await p.screenshot({ path: `${shots}/settings-check-read.png` });
  await seg(p, 'Marker color', 'Blue'); await tog(p, 'Marker shows the time'); await tog(p, 'Jump to the top'); await close(p);
  await pick(p, 'one', 3); await key(p, 'Space');
  const doc = await p.evaluate(() => JSON.stringify(window.__falconView.state.doc.toJSON()));
  want(doc.includes('" Marked "') && doc.includes('#0070C0'), 'Marker color Blue, and without the time');
  await readBtn();
  await pick(p, 'two', 1); await readBtn();
  want((await p.evaluate(() => window.__falconView.state.selection.from)) === 1, 'Jump to the top: read mode starts at the top');
  await key(p, `${mod}+Shift+r`);
  want(!(await p.evaluate(() => document.querySelector('.ProseMirror').classList.contains('f-read'))), 'Mod-Shift-R turns read mode back off');
  await p.context().close();
}

// =============== Speech and timers ===============
if (part('timers')) {
  const beeps = { fn: () => {
    window.__beeps = 0;
    const AC = window.AudioContext;
    window.AudioContext = class extends AC { createOscillator() { window.__beeps++; return super.createOscillator(); } };
  } };
  const p = await fresh({ init: beeps, clock: true });
  // the clock is fake, so React's effects run when it moves
  const timer = async () => { await p.clock.runFor(50); return p.$eval('.b.timer:not(.prep)', (x) => x.textContent); };
  const prepClock = async () => { await p.clock.runFor(50); return p.$eval('.b.timer.prep', (x) => x.textContent); };
  await open(p, 'Speech and timers');
  await seg(p, 'Event', 'College');
  want((await timer()) === '9:00', 'Event College: 9:00 speeches');
  await tog(p, 'Prep timer');
  want((await prepClock()) === 'Prep 10:00', 'Prep timer shows, at College prep (10:00)');
  await sel(p, 'Prep time', 5);
  want((await prepClock()) === 'Prep 5:00', 'Prep time 5:00');
  await seg(p, 'Event', 'High school');
  want((await timer()) === '8:00' && (await prepClock()) === 'Prep 8:00', 'Event High school: 8:00 and 8:00 prep');
  await sel(p, 'Speech length', 1);
  await open(p, 'General');
  await seg(p, 'Low time flash', '1 min');
  await tog(p, 'Timer sound');
  await close(p);
  await p.click('.b.timer:not(.prep)');
  await p.clock.runFor(2000);
  want(await p.$eval('.b.timer:not(.prep)', (x) => x.classList.contains('low') && getComputedStyle(x).color === 'rgb(255, 107, 107)'), 'Low time flash: the running clock flashes red in its last minute');
  await p.click('.b.timer.prep');
  await p.clock.runFor(3000);
  want((await prepClock()) === 'Prep 7:57', `the prep timer counts down (${await prepClock()})`);
  await p.clock.runFor(60_000);
  want((await timer()) === '0:00' && (await p.evaluate(() => window.__beeps)) >= 2, `Sound when time is up: two tones at 0:00 (${await p.evaluate(() => window.__beeps)})`);

  await p.screenshot({ path: `${shots}/settings-check-timers.png` });
  await p.context().close();
}
if (part('timers')) {
  const p = await fresh();
  // the read times count the words read aloud: highlight 420 of them
  await setDoc(p, [['tag', 'T'], ['normal', 'word '.repeat(420).trim()]]);
  await pick(p, 'word '.repeat(420).trim()); await key(p, 'F11');
  await p.waitForTimeout(300);
  const status = () => p.$eval('.status', (x) => x.textContent);
  const before = await status();
  await open(p, 'Speech and timers');
  await sel(p, 'Reader 1', 300);
  await sel(p, 'Reader 2', 400);
  await p.waitForTimeout(100);
  const after = await status();
  want(before.includes('Reader 1: 2:06 · Reader 2: 1:24') && after.includes('Reader 1: 1:24 · Reader 2: 1:03'), `Reader 1 and 2 speeds set the read times (${before.match(/Reader.*?\d:\d\d.*?\d:\d\d/)} -> ${after.match(/Reader.*?\d:\d\d.*?\d:\d\d/)})`);
  await p.context().close();
}

await browser.close();
console.log(results.join('\n'));
if (errors.length) console.log('page errors:', errors);
const bad = results.filter((r) => r.startsWith('FAIL')).length;
console.log(bad ? `${bad} FAILED` : `all ${results.length} ok`);
process.exit(bad || errors.length ? 1 : 0);
