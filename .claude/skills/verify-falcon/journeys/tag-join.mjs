// Backspace and Delete at a card's edges, the way CardMirror does them: a tag under a bare tag joins it, body text
// never joins a tag, a blank or spaces-only line goes away, and deleting a whole tag line doesn't hand its style to
// the line after.
import { openFalcon } from '../lib/falcon.mjs';

const f = await openFalcon('tag-join');
const { page } = f;
const lines = async () => (await f.markMap()).trim().split('\n');
// selection only, the one thing the harness may set by hand
const caret = (text, edge) => page.evaluate(([text, edge]) => {
  const v = window.__falconView;
  let at = -1;
  v.state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes(text)) at = pos + n.text.indexOf(text) + (edge === 'end' ? text.length : 0); });
  v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, at)));
  v.focus();
}, [text, edge]);
const tripleClick = async (text) => {
  const box = await page.locator('.ProseMirror > *').filter({ hasText: text }).first().boundingBox();
  await page.mouse.click(box.x + 10, box.y + box.height / 2, { clickCount: 3 });
  await page.waitForTimeout(100);
};
const press = async (key) => { await page.keyboard.press(key); await page.waitForTimeout(80); };

await page.click('.ProseMirror');
for (const [i, t] of ['Warming is real ', 'and it is fast', 'Card text', 'Second tag', 'Smith 24', 'Third tag'].entries()) {
  if (i) await page.keyboard.press('Enter');
  await page.keyboard.type(t);
}
for (const t of ['Warming is real ', 'and it is fast', 'Second tag', 'Third tag']) { await f.select(t); await press('F7'); }
let now = await lines();
f.want(now.join(' | ') === 'tag: Warming is real  | tag: and it is fast | normal: Card text | tag: Second tag | normal: Smith 24 | tag: Third tag', `set up: ${now.join(' | ')}`);
await f.shot('before');

await caret('and it is fast', 'start');
await press('Backspace');
now = await lines();
f.want(now[0] === 'tag: Warming is real and it is fast' && now.length === 5, `Backspace joins a tag to the bare tag above: ${now[0]}`);
await page.keyboard.type('X');
f.want((await lines())[0] === 'tag: Warming is real Xand it is fast', 'the cursor sits where they joined');
await press('Backspace');

await caret('Second tag', 'start');
await press('Backspace');
f.want((await lines()).length === 5, 'a tag under another card\'s text stays put');
await caret('Third tag', 'start');
await press('Backspace');
f.want((await lines())[3] === 'normal: Smith 24', 'and so does one under its own cite');

await caret('Warming is real and it is fast', 'end');
await press('Delete');
f.want((await lines())[1] === 'normal: Card text', 'Delete at the end of a tag doesn\'t pull its card text up');
await f.shot('joined');

// a spaces-only line above a tag goes away with one Backspace
await caret('Third tag', 'start');
await press('Enter');
await press('ArrowUp');
await page.keyboard.type('   ');
await caret('Third tag', 'start');
await press('Backspace');
now = await lines();
f.want(now.at(-1) === 'tag: Third tag' && now.at(-2) === 'normal: Smith 24', `a line of spaces above the tag is removed: ${now.slice(-2).join(' | ')}`);

// a selection from the start of a tag to the start of the next line (what a triple click picks on a Mac, or a drag
// down to the next line): deleting it takes the whole tag line, and the cite under it stays a cite line, not a tag
await page.evaluate(() => {
  const v = window.__falconView;
  let from = -1, to = -1;
  v.state.doc.forEach((n, pos) => { if (n.textContent === 'Second tag') from = pos + 1; else if (from > 0 && to < 0) to = pos + 1; });
  v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, from, to)));
  v.focus();
});
await press('Backspace');
now = await lines();
f.want(!now.some((l) => l.startsWith('tag: Second') || l === 'tag: ') && now.includes('normal: Smith 24'), `the whole tag line goes, and the next line keeps its style: ${now.join(' | ')}`);
await f.shot('line-deleted');
await press('Meta+z');
f.want((await lines()).includes('tag: Second tag'), 'one undo brings it back');
// Chromium's own triple click stays inside the line: deleting it still takes the whole line, not just its text
await tripleClick('Second tag');
await press('Backspace');
now = await lines();
f.want(!now.some((l) => l.includes('Second tag') || l === 'tag: ') && now.includes('normal: Smith 24'), `a triple-clicked tag line goes, no empty tag left behind: ${now.join(' | ')}`);
await press('Meta+z');

// typing over a tag selected down to the start of its cite replaces the tag, and the cite stays a cite line
await page.evaluate(() => {
  const v = window.__falconView;
  let from = -1, to = -1;
  v.state.doc.forEach((n, pos) => { if (n.textContent === 'Second tag') from = pos + 1; else if (from > 0 && to < 0) to = pos + 1; });
  v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, from, to)));
  v.focus();
});
await page.keyboard.type('Retyped tag');
now = await lines();
f.want(now.includes('tag: Retyped tag') && now.includes('normal: Smith 24'), `typing over it keeps the next line apart: ${now.join(' | ')}`);
await f.shot('retyped');
await f.done();
