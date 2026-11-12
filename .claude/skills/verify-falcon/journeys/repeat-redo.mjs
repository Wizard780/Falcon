// Redo repeats the last action (Settings > Editor, off by default), like Word's Repeat: with nothing left to redo,
// Mod-Y does your last edit again where the cursor is. Real keys throughout.
import { openFalcon, MOD } from '../lib/falcon.mjs';

const f = await openFalcon('repeat-redo', { storage: { 'falcon.repeatRedo': 'on' } });
const { page } = f;
const text = () => page.evaluate(() => window.__falconView.state.doc.textContent);
const press = async (key) => { await page.keyboard.press(key); await page.waitForTimeout(80); };
const caretAfter = (t) => page.evaluate((t) => {
  const v = window.__falconView;
  let at = -1;
  v.state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes(t)) at = pos + n.text.indexOf(t) + t.length; });
  v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, at)));
  v.focus();
}, t);

await page.click('.ProseMirror');
await page.keyboard.type('alpha beta gamma');
await caretAfter('alpha');
await page.keyboard.type(' [x]');
await caretAfter('gamma');
await press(`${MOD}+y`);
f.want(await text() === 'alpha [x] beta gamma [x]', `Mod-Y types the same thing again: ${await text()}`);
await press(`${MOD}+z`);
f.want(await text() === 'alpha [x] beta gamma', `undo takes the repeat back: ${await text()}`);
await press(`${MOD}+y`);
f.want(await text() === 'alpha [x] beta gamma [x]', 'and with something to redo, Mod-Y is still plain Redo');

await f.select('beta');
await press('F8');
await f.select('gamma');
await press(`${MOD}+y`);
// F8 joins a cite to one a space away, same as pressing it by hand
f.want((await f.markMap()).includes('[beta gamma]{cite}'), `a formatting key repeats on the new selection: ${(await f.markMap()).trim()}`);
await f.shot('repeated');
await f.done();
