// F12 is CardMirror's Clear to Normal: a tag, analytic or heading with the cursor in it goes back to a normal line,
// highlight kept. F9 and F10 with the cursor just after punctuation (the end of "growth." on a one-line cite or
// sentence) take that word instead of doing nothing. Real keys throughout.
import { openFalcon } from '../lib/falcon.mjs';

const f = await openFalcon('clear-and-keys');
const { page } = f;
const lines = async () => (await f.markMap()).trim().split('\n');
const press = async (k) => { await page.keyboard.press(k); await page.waitForTimeout(80); };
const caret = (text, edge) => page.evaluate(([text, edge]) => {
  const v = window.__falconView;
  let at = -1;
  v.state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes(text)) at = pos + n.text.indexOf(text) + (edge === 'end' ? text.length : 0); });
  v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, at)));
  v.focus();
}, [text, edge]);

await page.click('.ProseMirror');
for (const [i, t] of ['A tag to clear', 'An analytic to clear', 'Economic growth.', 'see (aside)'].entries()) { if (i) await press('Enter'); await page.keyboard.type(t); }
await f.select('A tag to clear'); await press('F7');
await f.select('An analytic to clear'); await press('Meta+F7');
await f.select('A tag to clear'); await press('F11');
let now = await lines();
f.want(now[0].startsWith('tag: [A tag to clear]{') && now[1].startsWith('analytic: '), `set up: ${now.join(' | ')}`);

await caret('tag to', 'start');
await press('F12');
now = await lines();
f.want(now[0] === 'normal: [A tag to clear]{highlight:yellow}', `F12 in a tag makes it a normal line and keeps the highlight: ${now[0]}`);
await caret('analytic to', 'start');
await press('F12');
f.want((await lines())[1] === 'normal: An analytic to clear', `and the same for an analytic: ${(await lines())[1]}`);
await f.shot('cleared');

await caret('growth.', 'end');
await press('F9');
f.want((await lines())[2] === 'normal: Economic [growth.]{underline}', `F9 right after "growth." underlines it: ${(await lines())[2]}`);
await caret('(aside)', 'end');
await press('F10');
f.want((await lines())[3] === 'normal: see [(aside)]{emphasis}', `F10 right after ")" emphasizes "(aside)": ${(await lines())[3]}`);
await f.shot('punctuation');
await press('Meta+z');
f.want((await lines())[3] === 'normal: see (aside)', 'one undo takes it back');

// underlining two words with a comma between them leaves the comma and space plain (gap bridging is spaces only)
await caret('see (aside)', 'end');
await press('Enter');
await page.keyboard.type('we introduce, something new');
await f.select('introduce'); await press('F9');
await f.select('something'); await press('F9');
f.want((await lines())[4] === 'normal: we [introduce]{underline}, [something]{underline} new', `the comma between stays plain: ${(await lines())[4]}`);
await f.select('we'); await press('F9');
f.want((await lines())[4].startsWith('normal: [we introduce]{underline},'), `a space between still bridges: ${(await lines())[4]}`);
await f.done();
