// Rich copy out and paste in: a Falcon copy keeps its Verbatim look in an app with no Falcon styles
// (a bare contenteditable stands in for Gmail / Docs), pastes back into Falcon unchanged, and still
// comes back as cites, underline, emphasis and highlights after that app strips the classes.
import { openFalcon, SEED, MOD } from '../lib/falcon.mjs';

const f = await openFalcon('clipboard');
await f.open(SEED);
await f.select('next year');
await f.page.keyboard.press('F10'); // emphasis, so every character style is in the copy
const before = await f.markMap();
f.want(before.includes('[next year]{emphasis}'), 'F10 boxed "next year"');

// Select all (Mod-A), then the browser's real copy command: ProseMirror's copy handler fills the clipboard.
await f.page.keyboard.press(`${MOD}+a`);
const copied = await f.page.evaluate(() => {
  let html = '';
  const grab = (e) => { html = e.clipboardData.getData('text/html'); };
  document.addEventListener('copy', grab); // bubbles after ProseMirror's handler on the editor
  document.execCommand('copy');
  document.removeEventListener('copy', grab);
  return html;
});
f.want(/class="f-cite" style="font-size:13pt;font-weight:bold"/.test(copied), 'copied cite carries inline bold 13pt');
f.want(/mso-highlight:yellow/.test(copied), 'copied highlight carries mso-highlight for Word');
f.want(/border:1pt solid/.test(copied), 'copied emphasis carries its box');

// Another app: a page on the same origin (for clipboard permission) with Falcon's document replaced, so no Falcon CSS at all.
await f.page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: process.env.FALCON_URL });
const other = await f.page.context().newPage();
await other.goto(process.env.FALCON_URL);
await other.evaluate((copied) => { document.open(); document.write(`<!doctype html><body style="font-family:Arial;background:#fff;color:#000"><div id="ed" contenteditable="true">${copied}</div></body>`); document.close(); }, copied);
const look = await other.evaluate(() => {
  const cs = (sel) => { const el = [...document.querySelectorAll('#ed *')].filter((e) => e.textContent.includes(sel)).pop(); return el && getComputedStyle(el); };
  return {
    cite: cs('Smith 24')?.fontWeight, citeSize: cs('Smith 24')?.fontSize,
    emph: cs('next year') && [cs('next year').fontWeight, cs('next year').textDecorationLine, cs('next year').borderTopStyle].join(' '),
    under: cs('growth will fall to ')?.textDecorationLine,
    hl: cs('two percent')?.backgroundColor,
  };
});
console.log('in a page without Falcon CSS:', look);
f.want(look.cite === '700' && look.citeSize === '17.3333px', 'cite shows bold 13pt elsewhere');
f.want(look.emph === '700 underline solid', 'emphasis shows bold, underlined and boxed elsewhere');
f.want(look.under === 'underline', 'underline shows elsewhere');
f.want(look.hl === 'rgb(255, 255, 0)', 'highlight shows elsewhere');
await other.screenshot({ path: `${process.env.FALCON_EVIDENCE}/clipboard/02-pasted-elsewhere.png` });

await other.bringToFront(); await other.click('#ed'); // a copy needs a focused page with a user gesture
// Copy back out of that app with Chromium's own copy (which writes computed inline styles), read the real clipboard,
// then strip classes and data-* the way Gmail does.
await other.evaluate(() => {
  const ed = document.getElementById('ed'); ed.focus();
  const sel = getSelection(); sel.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(ed); sel.addRange(r);
  document.execCommand('copy');
});
const laundered = await other.evaluate(async () => {
  const item = (await navigator.clipboard.read())[0];
  const html = item.types.includes('text/html') ? await (await item.getType('text/html')).text() : '';
  const d = new DOMParser().parseFromString(html, 'text/html');
  d.body.querySelectorAll('*').forEach((el) => { el.removeAttribute('class'); [...el.attributes].filter((a) => a.name.startsWith('data-')).forEach((a) => el.removeAttribute(a.name)); });
  return d.body.innerHTML;
});
f.want(laundered.length > 0, 'copied back out of the other app');
await other.close();
await f.page.bringToFront();

const pasteInto = async (html) => {
  await f.page.keyboard.press(`${MOD}+a`);
  await f.page.keyboard.press('Backspace');
  await f.page.evaluate((html) => {
    const dt = new DataTransfer(); dt.setData('text/html', html); dt.setData('text/plain', 'plain');
    window.__falconView.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, html);
  await f.page.waitForTimeout(150);
  return f.markMap();
};

const back = await pasteInto(copied);
f.want(back === before, 'Falcon copy pastes back into Falcon unchanged');
if (back !== before) console.log('--- want\n' + before + '\n--- got\n' + back);

const viaGmail = await pasteInto(laundered);
console.log('after an app that drops classes:\n' + viaGmail);
const line = (s) => viaGmail.split('\n').includes(s);
f.want(line('normal: [Smith 24]{cite}'), 'cite comes back as a cite');
f.want(line(before.split('\n').find((l) => l.startsWith('normal: Global'))), 'underline, highlight and emphasis come back');
f.want(viaGmail === before, 'the whole document comes back as it was');
f.want(line('tag: Growth is slowing') && line('pocket: Seed Pocket') && line('block: Warming Block'), 'headings come back as tag, pocket and block');
await f.shot('pasted-back');
await f.done();
