// Runs mechanic cases against CardMirror ("cm") or Falcon ("falcon") and prints a normalized mark map per case.
import { chromium } from 'playwright';
import fs from 'node:fs';
const which = process.argv[2] || 'cm';
const only = process.argv[3];
const url = which === 'cm' ? 'http://localhost:5301/' : 'http://localhost:5173/';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.on('pageerror', e => console.log('PAGEERR', e.message));
await p.goto(url); await p.waitForTimeout(1500);
if (which === 'cm') { await p.keyboard.press('Escape'); await p.getByText('New document', { exact: true }).first().click(); await p.waitForTimeout(1000); }

const k = async (key, n = 1) => { for (let i = 0; i < n; i++) { await p.keyboard.press(key); await p.waitForTimeout(40); } };
const t = s => p.keyboard.type(s, { delay: 3 });
const sel = (text, endText) => p.evaluate(([text, endText]) => {
  const root = document.querySelector('.ProseMirror');
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let full = '', nodes = [];
  while (w.nextNode()) { nodes.push([w.currentNode, full.length]); full += w.currentNode.data; }
  const i = full.indexOf(text); if (i < 0) throw new Error('no ' + text);
  const at = (off, end) => { for (const [n, s] of nodes) if (off >= s && (end ? off <= s + n.data.length : off < s + n.data.length)) return [n, off - s]; const [n, s] = nodes[nodes.length-1]; return [n, off - s]; };
  const end = endText === undefined ? i + text.length : (endText === '' ? i : full.indexOf(endText, i) + endText.length);
  const r = document.createRange(); r.setStart(...at(i)); r.setEnd(...at(end, true));
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}, [text, endText]).then(() => p.waitForTimeout(80));
// caret = collapsed at start of text (+offset)
const caret = (text, off = 0) => p.evaluate(([text, off]) => {
  const root = document.querySelector('.ProseMirror');
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let full = '', nodes = [];
  while (w.nextNode()) { nodes.push([w.currentNode, full.length]); full += w.currentNode.data; }
  const i = full.indexOf(text) + off;
  let hit = nodes.find(([n, s]) => i >= s && i < s + n.data.length) ;
  if (!hit || (off === text.length && off > 0)) hit = nodes.find(([n, s]) => i > s && i <= s + n.data.length) || hit;
  const [n, s] = hit; const r = document.createRange(); r.setStart(n, i - s); r.collapse(true); const g = getSelection(); g.removeAllRanges(); g.addRange(r);
}, [text, off]).then(() => p.waitForTimeout(80));

const map = () => p.evaluate(() => {
  if (window.__falconMarkMap) return window.__falconMarkMap();
  const root = document.querySelector('.ProseMirror');
  const out = [];
  const styleOf = el => {
    const c = el.className || '';
    if (el.tagName === 'H1') return 'pocket'; if (el.tagName === 'H2') return 'hat'; if (el.tagName === 'H3') return 'block';
    if (el.tagName === 'H4') return c.includes('analytic') ? 'analytic' : 'tag';
    if (c.includes('analytic')) return 'analytic'; if (c.includes('undertag')) return 'undertag';
    return 'normal';
  };
  const marksOf = (node, para) => {
    const m = new Set();
    for (let e = node.parentElement; e && e !== para; e = e.parentElement) {
      const c = e.className || '';
      if (c.includes('pmd-underline')) m.add('underline');
      if (c.includes('pmd-emphasis')) m.add('emphasis');
      if (c.includes('pmd-cite')) m.add('cite');
      if (c.includes('pmd-highlight')) m.add('highlight:' + e.dataset.highlight);
      if (c.includes('pmd-bgcolor') || c.includes('pmd-background')) m.add('shading');
      if (e.tagName === 'STRONG' || e.tagName === 'B') m.add('bold');
      if (e.dataset && e.dataset.boldOff) m.add('unbold');
      if (e.tagName === 'EM' || e.tagName === 'I') m.add('italic');
      if (e.style && e.style.fontSize) m.add('size:' + e.style.fontSize);
    }
    return [...m].sort().join('+');
  };
  for (const para of root.querySelectorAll('h1,h2,h3,h4,h5,p')) {
    const runs = [];
    const w = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const mk = marksOf(w.currentNode, para);
      const last = runs[runs.length - 1];
      if (last && last[1] === mk) last[0] += w.currentNode.data; else runs.push([w.currentNode.data, mk]);
    }
    out.push(styleOf(para) + ': ' + runs.map(([t, m]) => m ? `[${t}]{${m}}` : t).join(''));
  }
  return out.join('\n');
});
const caretInfo = () => p.evaluate(() => { const s = getSelection(); return s.anchorNode ? (s.anchorNode.textContent || '').slice(0, 30) + '@' + s.anchorOffset + (s.isCollapsed ? '' : ' (range)') : 'none'; });

async function reset() {
  await p.locator('.ProseMirror').first().click();
  await k('Meta+a'); await k('Backspace'); await k('Backspace');
}
const BODY = 'The rapid expansion of artificial intelligence workloads has pushed utilities to their limits.';
async function card() {
  await t('Grid tag here'); await k('F7'); await k('Enter');
  await t('Smith 24, Professor at MIT'); await k('Enter');
  await t(BODY);
}
const cases = {
  async f9NoSel() { await card(); await caret('artificial', 3); await k('F9'); },
  async f8NoSel() { await card(); await caret('Smith', 2); await k('F8'); },
  async f10NoSel() { await card(); await caret('pushed', 2); await k('F10'); },
  async f11NoSel() { await card(); await caret('pushed', 2); await k('F11'); },
  async f9Twice() { await card(); await sel('pushed utilities'); await k('F9'); await k('F9'); },
  async f9PartialToggle() { await card(); await sel('pushed utilities'); await k('F9'); await sel('utilities to their'); await k('F9'); },
  async f11Twice() { await card(); await sel('pushed utilities'); await k('F11'); await k('F11'); },
  async f11PartialToggle() { await card(); await sel('pushed utilities'); await k('F11'); await sel('utilities to their'); await k('F11'); },
  async f10OnUnderline() { await card(); await sel('pushed utilities to'); await k('F9'); await sel('utilities'); await k('F10'); },
  async f9OnEmphasis() { await card(); await sel('pushed utilities to'); await k('F10'); await sel('utilities'); await k('F9'); },
  async f10Twice() { await card(); await sel('pushed utilities'); await k('F10'); await k('F10'); },
  async f12KeepsHighlight() { await card(); await sel('pushed utilities to'); await k('F9'); await k('F11'); await sel('rapid', 'limits'); await k('F12'); },
  async f12OnHeading() { await card(); await sel('Grid tag'); await k('F12'); },
  async f11ThenTypeInside() { await card(); await sel('pushed utilities'); await k('F11'); await caret('utilities', 3); await t('XY'); },
  async typeAtEndOfUnderline() { await card(); await sel('pushed'); await k('F9'); await caret('pushed', 6); await t('ZZ'); },
  async modUThenType() { await card(); await caret('their', 0); await k('Meta+u'); await t('new '); },
  async enterEndOfTag() { await t('Tag one'); await k('F7'); await k('Enter'); await t('body text'); },
  async enterMidTag() { await t('Tag one two'); await k('F7'); await caret('two', 0); await k('Enter'); },
  async enterStartOfTag() { await t('Tag one'); await k('F7'); await caret('Tag', 0); await k('Enter'); },
  async backspaceStartOfTag() { await t('para'); await k('Enter'); await t('Tag one'); await k('F7'); await caret('Tag', 0); await k('Backspace'); },
  async backspaceStartOfTagBlankAbove() { await t('para'); await k('Enter'); await k('Enter'); await t('Tag one'); await k('F7'); await caret('Tag', 0); await k('Backspace'); },
  async backspaceStartOfBody() { await card(); await caret('Smith', 0); await k('Backspace'); },
  async deleteEndOfTag() { await card(); await caret('here', 4); await k('Delete'); },
  async headingKeysCycle() { await t('Line'); await k('F4'); await k('Enter'); await t('Hat'); await k('F5'); await k('Enter'); await t('Blk'); await k('F6'); await k('Enter'); await t('An'); await k('Meta+F7'); await k('Enter'); await t('under'); await k('Meta+F8'); },
  async enterAfterPocket() { await t('Pocket'); await k('F4'); await k('Enter'); await t('next'); },
  async enterAfterBlock() { await t('Blk'); await k('F6'); await k('Enter'); await t('next'); },
  async enterAfterCite() { await card(); await caret('MIT', 3); await k('Enter'); await t('new'); },
  async enterInUnderline() { await card(); await sel('pushed utilities'); await k('F9'); await caret('utilities', 2); await k('Enter'); await t('Q'); },
  async f6InBody() { await card(); await caret('rapid', 0); await k('F6'); },
  async f4OnTag() { await card(); await caret('Grid', 0); await k('F4'); },
  async f7OnTagReapply() { await card(); await caret('Grid', 0); await k('F7'); },
  async f8OnSelectionAcrossTag() { await card(); await sel('tag here', 'Smith'); await k('F8'); },
  async boldInTag() { await card(); await sel('tag'); await k('Meta+b'); },
  async shrink() { await card(); await sel('pushed utilities'); await k('F9'); await caret('rapid', 0); await k('Meta+8'); },
  async shrink2() { await card(); await sel('pushed utilities'); await k('F9'); await caret('rapid', 0); await k('Meta+8'); await k('Meta+8'); },
  async toggleCase() { await card(); await sel('rapid expansion'); await k('Shift+F3'); },
  async toggleCase2() { await card(); await sel('rapid expansion'); await k('Shift+F3'); await k('Shift+F3'); },
  async condense() { await t('Tag'); await k('F7'); await k('Enter'); await t('cite'); await k('Enter'); await t('one   two'); await k('Enter'); await t('three'); await k('Enter'); await t('four'); await sel('one', 'four'); await k('F3'); },
  async condenseNoSel() { await t('Tag'); await k('F7'); await k('Enter'); await t('cite'); await k('Enter'); await t('one   two'); await k('Enter'); await t('three'); await caret('three', 1); await k('F3'); },
  async altF3() { await t('Tag'); await k('F7'); await k('Enter'); await t('cite'); await k('Enter'); await t('one   two'); await k('Enter'); await t('three'); await sel('one', 'three'); await k('Alt+F3'); },
  async copyPrevCite() { await card(); await k('Enter'); await t('Second tag'); await k('F7'); await k('Enter'); await k('Alt+F8'); },
  async highlightAcrossSpace() { await card(); await sel('pushed'); await k('F9'); await sel('their limits'); await k('F9'); await sel('pushed', 'limits'); await k('F11'); },
  async underlineWordsWithSpaces() { await card(); await sel('pushed'); await k('F9'); await sel('to'); await k('F9'); },
  async f10TrailingSpace() { await card(); await sel('pushed utilities '); await k('F10'); },
  async f10LeadingSpace() { await card(); await sel(' pushed utilities'); await k('F10'); },
  async f9OnEmphasisSpaceSel() { await card(); await sel('pushed utilities to'); await k('F10'); await sel(' utilities '); await k('F9'); },
  async f11TrailingSpace() { await card(); await sel(' pushed utilities '); await k('F11'); },
  async f8TrailingSpace() { await card(); await sel('Smith 24, '); await k('F8'); },
  async f9TrailingSpace() { await card(); await sel('pushed utilities '); await k('F9'); },
  async f12OnEmphasisPart() { await card(); await sel('pushed utilities to'); await k('F10'); await sel('utilities'); await k('F12'); },
  // no pause between keys: catches races with layout or async UI work after Enter
  async fastTypeAfterEnter() { await t('Tag'); await k('F7'); await p.keyboard.press('Enter'); await p.keyboard.type('Body', { delay: 0 }); await p.keyboard.press('Enter'); await p.keyboard.type('Next', { delay: 0 }); },
  async typeAfterTagEndThenEnterTwice() { await t('Tag'); await k('F7'); await k('Enter'); await k('Enter'); await t('x'); },
  async backspaceEmptyBelowTag() { await t('Tag'); await k('F7'); await k('Enter'); await k('Backspace'); await t('Z'); },
};
const res = {};
for (const [name, fn] of Object.entries(cases)) {
  if (only && !name.match(only)) continue;
  try { await reset(); await fn(); await p.waitForTimeout(100); res[name] = (await map()) + '\n  caret: ' + await caretInfo(); }
  catch (e) { res[name] = 'ERROR ' + e.message.split('\n')[0]; }
  console.log('### ' + name + '\n' + res[name]);
}
if (!only) fs.writeFileSync(`shots/probe-${which}.json`, JSON.stringify(res, null, 1));
if (which !== 'cm' && fs.existsSync('shots/probe-cm.json')) {
  const cm = JSON.parse(fs.readFileSync('shots/probe-cm.json', 'utf8'));
  const strip = s => (s || '').split('\n  caret:')[0];
  const diffs = Object.keys(res).filter(k => strip(res[k]) !== strip(cm[k]));
  console.log(`\n=== ${Object.keys(res).length - diffs.length}/${Object.keys(res).length} match CardMirror ===`);
  for (const d of diffs) console.log(`--- ${d}\nCM:\n${strip(cm[d])}\nFALCON:\n${strip(res[d])}`);
}
await b.close();
