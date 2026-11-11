// Card links: a typed cite name ("clare 23") links to the card. Hover previews it, a click goes there,
// the status bar's Back (and Mod-[) returns, and Settings > Editor > Card links switches Quiet / Page slice / Off.
// The file is seeded through the autosave slot (setup, not the thing under test); the name is typed with real keys.
import { openFalcon, MOD } from '../lib/falcon.mjs';

const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (style, ...content) => ({ type: 'paragraph', attrs: { style }, content });
const C = [{ type: 'cite' }], U = [{ type: 'underline' }], H = [{ type: 'underline' }, { type: 'highlight', attrs: { color: 'cyan' } }];
const filler = Array.from({ length: 14 }, (_, i) => p('normal', t(`Filler paragraph ${i + 1} so the evidence sits below the fold and a jump has to scroll the page.`)));
const doc = { type: 'doc', content: [
  p('block', t('Frontlines')),
  p('analytic', t('Extend ')),
  p('analytic', t('Their Smith 22 cards miss it, and Jones 19 is not in the file.')),
  ...filler,
  p('block', t('Evidence')),
  p('tag', t('Compute caps survive treaty collapse')),
  p('normal', t('Clare 23', C), t(' (Stephen Clare, 80,000 Hours, June 2023)')),
  p('normal', t('The key point is that '), t('export controls are enforced at a handful of fabs', H), t(', not by the treaty text. '), t('Even if the agreement lapsed the fabs keep metering', H), t('.')),
  p('tag', t('Treaties fail without on-site access')),
  p('normal', t('Smith 22', C), t(' (Jordan Smith, Lawfare)')),
  p('normal', t('No verification regime can see inside a data center', U)),
  p('tag', t('Partial verification still deters')),
  p('normal', t('Smith 22', C), t(' (Alana Smith, CSET)')),
  p('normal', t('A credible chance of detection changes behavior', U)),
] };

const f = await openFalcon('card-links');
const { page } = f;
// before the app's own scripts on every load: the unload autosave would otherwise write the blank doc over it
await page.addInitScript((v) => localStorage.setItem('falcon.autosave.v2', v), JSON.stringify([{ meta: { name: 'Links' }, doc, active: true }]));
await page.reload();
await page.waitForSelector('.ProseMirror');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const scrollTop = () => page.evaluate(() => document.querySelector('.f-scroll').scrollTop);
const head = () => page.evaluate(() => { const v = window.__falconView; return v.state.doc.resolve(v.state.selection.head).parent.textContent; });
/** The screen box of the first `text` in the document. */
const box = (text) => page.evaluate((text) => {
  const v = window.__falconView; let at = -1;
  v.state.doc.descendants((n, pos) => { if (at < 0 && n.isTextblock) { const i = n.textContent.indexOf(text); if (i >= 0) at = pos + 1 + i; } return at < 0; });
  const a = v.coordsAtPos(at + 1), b = v.coordsAtPos(at + text.length - 1);
  return { x: (a.left + b.right) / 2, y: (a.top + a.bottom) / 2 };
}, text);

// the user's own case: type "clare 23" in lowercase after "Extend "
await f.select('Extend '); // typing replaces the selection (headless has no OS focus for a bare caret move)
await page.keyboard.type('Extend clare 23 here, then smith 22.');
f.want((await f.markMap()).includes('Extend clare 23 here, then smith 22.'), 'typed "clare 23" into the analytic');

// hover: preview after a moment, quiet style, with the card's tag and cite
let at = await box('clare 23');
await page.mouse.move(at.x, at.y);
await page.waitForTimeout(700);
const pv = await page.evaluate(() => { const e = document.querySelector('.cl-pv.cl-on'); return e && { cls: e.className, text: e.textContent }; });
f.want(!!pv && pv.cls.includes('cl-quiet'), `hover shows the quiet preview (${pv?.cls})`);
f.want(!!pv && pv.text.includes('Compute caps survive treaty collapse') && pv.text.includes('Clare 23') && pv.text.includes('Evidence'), 'preview has the tag, cite and section');
f.want(await page.evaluate(() => document.querySelector('.ProseMirror').classList.contains('cl-pointer')), 'pointer cursor over the name');
await f.shot('quiet-hover');

// on to another name with the preview open: the box glides there, taking no pointer on the way, and lands usable
const left = () => page.evaluate(() => document.querySelector('.cl-pv').getBoundingClientRect().left);
const l0 = await left();
at = await box('smith 22');
await page.mouse.move(at.x, at.y, { steps: 5 });
await page.waitForTimeout(60);
const mid = await page.evaluate(() => { const e = document.querySelector('.cl-pv.cl-on'); return e && { cls: e.className, pe: getComputedStyle(e).pointerEvents, n: e.querySelectorAll('.cl-it').length }; });
f.want(!!mid && mid.cls.includes('cl-glide') && mid.pe === 'none', `the open preview glides to the next name (${mid?.cls}, ${mid?.pe})`);
f.want(mid?.n === 2, 'already showing the two Smith 22 cards: no second wait');
await page.waitForTimeout(450);
const end = await page.evaluate(() => { const e = document.querySelector('.cl-pv.cl-on'); return e && { cls: e.className, pe: getComputedStyle(e).pointerEvents }; });
f.want(!!end && !end.cls.includes('cl-glide') && end.pe === 'auto', `and lands where it can be clicked (${end?.cls}, ${end?.pe})`);
f.want(Math.abs(await left() - l0) > 40, `under the new name (${l0} → ${await left()})`);
await f.shot('glided');

// not linked: Jones 19 (move off first: the open preview sits over the next line)
await page.mouse.move(5, 300);
await page.waitForTimeout(400);
f.want(!(await page.locator('.cl-pv.cl-on').count()), 'moving away closes the preview');
at = await box('Jones 19');
await page.mouse.move(at.x, at.y);
await page.waitForTimeout(700);
f.want(!(await page.locator('.cl-pv.cl-on').count()), 'Jones 19 (no such card) shows no preview');

// click goes to the card, flashes it, and Back appears
const before = await scrollTop();
at = await box('clare 23');
await page.mouse.move(at.x, at.y);
await page.mouse.click(at.x, at.y);
await page.waitForTimeout(900);
f.want(await head() === 'Compute caps survive treaty collapse', `click moves the cursor to the card's tag (${await head()})`);
f.want(await scrollTop() > before + 200, `the page scrolled to the card (${before} → ${await scrollTop()})`);
f.want(await page.locator('.ProseMirror .cl-flash').count() > 0, 'the card flashes');
f.want(await page.locator('.status .back').isVisible(), 'Back shows in the status bar');
await f.shot('jumped');

// Mod-[ comes back
await page.keyboard.press(`${MOD}+BracketLeft`);
await page.waitForTimeout(400);
f.want((await head()).startsWith('Extend clare 23'), `Mod-[ returns the cursor (${await head()})`);
f.want(Math.abs(await scrollTop() - before) < 5, 'and the scroll position');
f.want(!(await page.locator('.status .back').count()), 'Back goes away once used');

// two cards named Smith 22: a click lists both, picking one goes there
at = await box('Smith 22');
await page.mouse.move(at.x, at.y);
await page.mouse.click(at.x, at.y);
await page.waitForTimeout(300);
f.want(await page.locator('.cl-pv.cl-on .cl-it').count() === 2, 'Smith 22 lists its two cards');
await f.shot('two-cards');
await page.locator('.cl-pv.cl-on .cl-it').nth(1).click();
await page.waitForTimeout(800);
f.want(await head() === 'Partial verification still deters', `picking the second goes to it (${await head()})`);
// back via the status bar button
await page.click('.status .back');
await page.waitForTimeout(300);
f.want((await head()).startsWith('Their Smith 22'), 'the Back button returns');

// Settings: switch to Page slice through the UI
await page.click('.fstrip [aria-label="Settings"]');
await page.click('[aria-label="Settings sections"] button:has-text("Editor")');
const seg = page.locator('[role="group"][aria-label="Card links"]');
await seg.scrollIntoViewIfNeeded();
await f.shot('settings');
await seg.getByRole('button', { name: 'Page slice' }).click();
f.want(await page.evaluate(() => localStorage.getItem('falcon.cardLinks')) === 'page', 'Settings stores Page slice');
await page.click('[aria-label="Close settings"]');
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.f-scroll').scrollTo({ top: 0 }));
await page.waitForTimeout(300);
f.want(await page.evaluate(() => CSS.highlights.get('falcon-ref')?.size ?? 0) >= 2, 'page slice dots the linked names on screen');
at = await box('clare 23');
await page.mouse.move(at.x, at.y);
await page.waitForTimeout(700);
f.want(await page.locator('.cl-pv.cl-on.cl-page .f-tag').count() === 1, 'page slice preview draws the card in page styles');
await f.shot('page-hover');

// survives a reload
await page.reload();
await page.waitForSelector('.ProseMirror');
await page.keyboard.press('Escape');
f.want(await page.evaluate(() => document.querySelector('.ProseMirror').dataset.cardLinks) === 'page', 'Page slice survives a reload');

// Off: no preview, a click just puts the cursor there
await page.evaluate(() => localStorage.setItem('falcon.cardLinks', 'off'));
await page.reload();
await page.waitForSelector('.ProseMirror');
await page.keyboard.press('Escape');
at = await box('Smith 22');
await page.mouse.move(at.x, at.y);
await page.waitForTimeout(700);
f.want(!(await page.locator('.cl-pv.cl-on').count()), 'Off: no preview');
await page.mouse.click(at.x, at.y);
await page.waitForTimeout(300);
f.want((await head()).startsWith('Their Smith 22'), 'Off: a click edits in place');

f.want(!f.errors.length, `no page errors ${f.errors.join(' | ')}`);
await f.done();
