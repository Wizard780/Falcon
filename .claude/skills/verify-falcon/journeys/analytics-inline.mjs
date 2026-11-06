// Analytics are free text: a pasted one sits next to the words on the line it lands on, and Backspace at
// its start puts it on the line above. A pasted tag still takes its own line.
import { openFalcon, MOD } from '../lib/falcon.mjs';

const f = await openFalcon('analytics-inline');
const { page } = f;
const lines = async () => (await f.markMap()).trim().split('\n');
const copy = (text) => f.select(text).then(() => page.evaluate(() => {
  let html = '';
  const grab = (e) => { html = e.clipboardData.getData('text/html'); };
  document.addEventListener('copy', grab);
  document.execCommand('copy');
  document.removeEventListener('copy', grab);
  return html;
}));
const paste = (html) => page.evaluate((html) => {
  const dt = new DataTransfer();
  dt.setData('text/html', html);
  dt.setData('text/plain', 'x');
  window.__falconView.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, html);
// selection only, the one thing the harness may set by hand
const caret = (text, edge) => page.evaluate(([text, edge]) => {
  const v = window.__falconView;
  let at = -1;
  v.state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes(text)) at = pos + n.text.indexOf(text) + (edge === 'end' ? text.length : 0); });
  v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, at)));
  v.focus();
}, [text, edge]);

await page.click('.ProseMirror');
await page.keyboard.type('First point. ');
await page.keyboard.press('Enter');
await page.keyboard.type('Second point.');
await page.keyboard.press('Enter');
await page.keyboard.type('Third point.');
await page.keyboard.press('Enter');
await page.keyboard.type('A real tag');
await page.keyboard.press('Enter');
await page.keyboard.type('some body text ');
for (const t of ['First point. ', 'Second point.', 'Third point.']) { await f.select(t); await page.keyboard.press(`${MOD}+F7`); }
await f.select('A real tag');
await page.keyboard.press('F7');
const start = await lines();
f.want(start[0].startsWith('analytic: First') && start[3] === 'tag: A real tag', `set up: ${start.join(' | ')}`);
await f.shot('before');

const second = await copy('Second point.');
await caret('First point. ', 'end');
await paste(second);
let now = await lines();
f.want(now.length === start.length && now[0] === 'analytic: First point. Second point.', `paste at a line's end stays on it: ${now[0]}`);
await f.shot('pasted-inline');

await caret('Third point.', 'start');
await page.keyboard.press('Backspace');
await page.waitForTimeout(100);
const joined = await lines();
f.want(joined.length === now.length - 1 && joined[1] === 'analytic: Second point.Third point.', `Backspace puts it on the line above: ${joined[1]}`);
await f.shot('backspaced');
await page.keyboard.press(`${MOD}+z`);
await page.waitForTimeout(100);
f.want((await lines()).length === now.length, 'one undo splits it again');

const tag = await copy('A real tag');
await caret('some body text ', 'end');
await paste(tag);
now = await lines();
f.want(now.some((l) => l === 'normal: some body text ') && now.filter((l) => l === 'tag: A real tag').length === 2, `a pasted tag still gets its own line: ${now.join(' | ')}`);

await caret('A real tag', 'start');
await page.keyboard.press('Backspace');
await page.waitForTimeout(100);
f.want((await lines()).length === now.length, 'Backspace at the start of a tag still does nothing');

await page.keyboard.press(`${MOD}+ArrowDown`);
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await paste(second);
now = await lines();
f.want(now.at(-1) === 'analytic: Second point.', `on an empty line it keeps its style: ${now.at(-1)}`);
await f.shot('empty-line');
await f.done();
