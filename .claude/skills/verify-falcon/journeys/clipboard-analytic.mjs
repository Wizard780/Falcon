// An analytic copied out of Falcon carries CardMirror's class (CardMirror's paste reads only its own
// classes) and its blue bold look (for Docs and Gmail). Pasted back after an app strips the classes,
// or pasted from Google Docs, it is still an analytic, not a tag or a cite.
import { openFalcon, SEED, MOD } from '../lib/falcon.mjs';

const f = await openFalcon('clipboard-analytic');
await f.open(SEED);
await f.select('Growth is slowing');
await f.page.keyboard.press(`${MOD}+F7`);
const before = await f.markMap();
f.want(before.split('\n').includes('analytic: Growth is slowing'), 'Mod-F7 made the tag an analytic');

await f.page.keyboard.press(`${MOD}+a`);
const copied = await f.page.evaluate(() => {
  let html = '';
  const grab = (e) => { html = e.clipboardData.getData('text/html'); };
  document.addEventListener('copy', grab);
  document.execCommand('copy');
  document.removeEventListener('copy', grab);
  return html;
});
const analytic = await f.page.evaluate((html) => { const el = new DOMParser().parseFromString(html, 'text/html').querySelector('.f-analytic'); return el && { html: el.outerHTML, cls: [...el.classList], style: el.getAttribute('style') ?? '' }; }, copied);
console.log('copied analytic:', analytic?.html);
f.want(analytic?.cls.includes('pmd-analytic'), "copied analytic carries CardMirror's pmd-analytic");
f.want(/font-weight:bold/.test(analytic?.style ?? '') && /color:#1f3f8a/.test(analytic?.style ?? ''), 'copied analytic carries its bold blue look');
f.want(/class="f-tag pmd-tag"/.test(copied) && /class="f-cite pmd-cite"/.test(copied) && /pmd-highlight" data-color="yellow"[^>]*data-highlight="yellow"/.test(copied), 'tags, cites and highlights carry CardMirror names too');

// another app with no Falcon CSS: the analytic shows bold and blue
await f.page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: process.env.FALCON_URL });
const other = await f.page.context().newPage();
await other.goto(process.env.FALCON_URL);
await other.evaluate((copied) => { document.open(); document.write(`<!doctype html><body style="font-family:Arial;background:#fff;color:#000"><div id="ed" contenteditable="true">${copied}</div></body>`); document.close(); }, copied);
const look = await other.evaluate(() => { const el = [...document.querySelectorAll('#ed *')].filter((e) => e.textContent.includes('Growth is slowing')).pop(); const cs = getComputedStyle(el); return [cs.fontWeight, cs.fontSize, cs.color].join(' '); });
console.log('analytic elsewhere:', look);
f.want(look === '700 17.3333px rgb(31, 63, 138)', 'analytic shows bold, 13pt and blue elsewhere');
await other.screenshot({ path: `${process.env.FALCON_EVIDENCE}/clipboard-analytic/01-pasted-elsewhere.png` });

// copy back out of it with Chromium's own copy, then strip classes and data-* the way Gmail does
await other.bringToFront(); await other.click('#ed');
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
const viaGmail = await pasteInto(laundered);
console.log('after an app that drops classes:\n' + viaGmail);
f.want(viaGmail.split('\n').includes('analytic: Growth is slowing'), 'analytic comes back as an analytic after classes are stripped');
f.want(viaGmail === before, 'the whole document comes back as it was');

// Google Docs' clipboard shape for an analytic (Docs writes the look on spans and drops the style)
const docs = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-abc"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:13pt;font-family:Calibri,sans-serif;color:#1f3864;background-color:transparent;font-weight:700;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Extend the blackout impact</span></p><p dir="ltr"><span style="font-size:13pt;font-family:Calibri,sans-serif;color:#000000;font-weight:700;">A black tag</span></p></b>';
const fromDocs = await pasteInto(docs);
console.log('from Google Docs:\n' + fromDocs);
f.want(fromDocs === 'analytic: Extend the blackout impact\ntag: A black tag', 'a Docs analytic pastes as an analytic, a black one as a tag');
await f.shot('from-docs');
await f.done();
