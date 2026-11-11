// The first-run tutorial: a fresh profile starts it by itself, each step's glow ring sits on its target, each
// hands-on step moves on from the real key, Done, Skip and Esc end it and put back what was showing, the seen
// flag stops a second start, and Replay from Settings or the command center leaves an open document exactly as
// it was (content, unsaved dot, undo). The sample stays out of recents and crash recovery.
// Saves one screenshot per step (dark, 1440x900) and a video of the whole tour; SHOTS=<dir> copies them there.
//
// Tests and the drive scripts never see the tour start by itself: it doesn't when navigator.webdriver is set
// (any Playwright browser or Electron). This journey turns that off to be a person on a fresh profile.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const URL = process.env.FALCON_URL;
const out = path.join(process.env.FALCON_EVIDENCE, 'tutorial');
const SEED = path.join(process.env.FALCON_SKILL ?? '', 'fixtures/seed.docx');
const SHOTS = process.env.SHOTS;
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
fs.mkdirSync(out, { recursive: true });
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const want = (ok, what) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`); return ok; };
const errors = [];
const browser = await chromium.launch();
const human = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
async function context(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, ...opts });
  await ctx.addInitScript(human);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page };
}
const title = (page) => page.evaluate(() => document.querySelector('.tour-card h2')?.textContent ?? null);
const touring = (page) => page.evaluate(() => !!document.querySelector('.tour'));
const waitTitle = (page, t, timeout = 4000) => page.waitForFunction((t) => document.querySelector('.tour-card h2')?.textContent === t, t, { timeout }).then(() => true, () => false);
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  if (SHOTS) fs.copyFileSync(path.join(out, `${name}.png`), path.join(SHOTS, `${name}.png`));
};
const docNames = (page) => page.evaluate(() => [...document.querySelectorAll('.doc-row .doc-nm')].map((b) => b.getAttribute('aria-label')));
const stored = (page) => page.evaluate(() => ({ autosave: localStorage.getItem('falcon.autosave.v2') ?? '', recents: localStorage.getItem('falcon.recents.v1') ?? '', seen: localStorage.getItem('falcon.tourSeen') }));

// Where each step's ring must sit (the target's box, as the page draws it), and the key a hands-on step takes.
const P = (n) => () => document.querySelector(`.ProseMirror > :nth-child(${n})`);
const TARGETS = {
  'Home': ['.fstrip .sb-logo'],
  'Your open files': ['.fstrip .fs-docs'],
  'Make a tag': [1, '[data-tour="tag"]'],
  'Mark the cite': [2, '[data-tour="cite"]'],
  'Underline': [3, '[data-tour="underline"]'],
  'Highlight': [3, '[data-tour="highlight"]'],
  'Headings': ['[data-tour="styles"]'],
  'The outline': ['.olp.shown'],
  'The command center': ['.cc'],
  'Send to speech': ['.tools [aria-label="Speech doc"]'],
  'Settings': ['.fstrip [aria-label="Settings"]'],
};
const KEYS = { 'Make a tag': 'F7', 'Mark the cite': 'F8', 'Underline': 'F9', 'Highlight': 'F11', 'The command center': `${MOD}+Shift+Space` };
const NAMES = ['welcome', 'home', 'files', 'tag', 'cite', 'underline', 'highlight', 'headings', 'outline', 'command-center', 'search', 'send', 'settings'];
/** Ring boxes against the targets' boxes (padded 6 px, kept 4 px inside the window), and the card inside the window and off the rings. */
const geometry = (page, sels) => page.evaluate((sels) => {
  const vw = innerWidth, vh = innerHeight;
  const want = sels.map((s) => (typeof s === 'number' ? document.querySelector(`.ProseMirror > :nth-child(${s})`) : document.querySelector(s))?.getBoundingClientRect())
    .map((r) => r && { left: Math.max(4, r.left - 6), top: Math.max(4, r.top - 6), right: Math.min(vw - 4, r.right + 6), bottom: Math.min(vh - 4, r.bottom + 6) });
  const rings = [...document.querySelectorAll('.tour-ring')].map((e) => e.getBoundingClientRect());
  const card = document.querySelector('.tour-card').getBoundingClientRect();
  const off = (a, b) => Math.max(Math.abs(a.left - b.left), Math.abs(a.top - b.top), Math.abs(a.right - b.right), Math.abs(a.bottom - b.bottom));
  const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  return {
    found: want.every(Boolean), count: rings.length === want.length,
    worst: want.every(Boolean) && rings.length === want.length ? Math.max(...want.map((w, i) => off(w, rings[i]))) : 999,
    inside: card.left >= 0 && card.top >= 0 && card.right <= vw && card.bottom <= vh,
    clear: !rings.some((r) => hit(r, card)),
    // the gap between the card and the nearest ring
    gap: Math.min(...rings.map((r) => Math.hypot(Math.max(0, r.left - card.right, card.left - r.right), Math.max(0, r.top - card.bottom, card.top - r.bottom)))),
  };
}, sels);

// ---------- 1. a fresh profile: the tour starts by itself, and every step works ----------
const video = path.join(out, 'video');
let { ctx, page } = await context({ recordVideo: { dir: video, size: { width: 1440, height: 900 } } });
await page.goto(URL);
want(await page.waitForSelector('.tour-card', { timeout: 8000 }).then(() => true, () => false), 'a fresh profile starts the tour by itself (after the falcon lands)');
want(await title(page) === 'Welcome to Falcon', 'it starts on the welcome step');
want((await docNames(page)).includes('Tutorial'), 'it opened its sample document in the rail');
want(!(await page.evaluate(() => document.querySelector('.home')?.classList.contains('open'))), 'Home is out of the way while the tour runs');
want((await stored(page)).seen === 'on', 'the seen flag is stored as soon as it starts');
const sample0 = await page.evaluate(() => window.__falconMarkMap());
want(sample0 === 'normal: Rural broadband raises small business growth\nnormal: Rivera 24 (Dana Rivera, fellow at the Center for Regional Economics, "Connected Counties," Journal of Rural Policy, March 2024)\nnormal: Counties that gained fast internet between 2015 and 2022 saw new business filings rise faster than similar counties that did not. The effect was largest for firms with fewer than ten employees, which used the connection to reach customers outside their region. These gains held after controlling for population, income and existing industry.',
  'the sample is one unformatted card: tag line, cite line, body');
// a click outside the ring is held back: Settings doesn't open behind the welcome card
await page.mouse.click(20, 880);
await page.keyboard.press(`${MOD}+s`).catch(() => {});
want(!(await page.evaluate(() => !!document.querySelector('.st-back'))) && await title(page) === 'Welcome to Falcon', 'a click on the dim and a stray Mod-S do nothing');

let n = 0;
for (;;) {
  const t = await title(page);
  if (!t) break;
  n++;
  const name = `${String(n).padStart(2, '0')}-${NAMES[n - 1] ?? 'step'}`;
  await page.waitForTimeout(450); // the ring glides from the last step
  if (TARGETS[t] && t !== 'The command center') {
    const g = await geometry(page, TARGETS[t]);
    want(g.found && g.count && g.worst <= 2, `${t}: the ring sits on its target (worst edge ${g.worst.toFixed?.(1) ?? g.worst} px)`);
    want(g.inside && g.clear && g.gap <= 100, `${t}: the card is inside the window, off the ring and beside it (${Math.round(g.gap)} px away)`);
  }
  await shot(page, name);
  if (KEYS[t]) {
    const before = await page.evaluate(() => window.__falconMarkMap());
    await page.keyboard.press(KEYS[t]);
    if (t === 'The command center') {
      want(await page.waitForSelector('.cc', { timeout: 2000 }).then(() => true, () => false), 'the command center key opens it during its step');
      await page.waitForTimeout(260); // its own opening animation
      const g = await geometry(page, TARGETS[t]);
      want(g.found && g.count && g.worst <= 2 && g.inside, `The command center: the ring moves onto it once it opens (worst edge ${g.worst} px)`);
      await shot(page, name);
    }
    const moved = await page.waitForFunction((t) => document.querySelector('.tour-card h2')?.textContent !== t, t, { timeout: 3000 }).then(() => true, () => false);
    want(moved, `${t}: ${KEYS[t]} moves the tour on by itself`);
    const after = await page.evaluate(() => window.__falconMarkMap());
    if (t !== 'The command center') want(after !== before, `${t}: ${KEYS[t]} formatted the sample`);
    else want(!(await page.evaluate(() => !!document.querySelector('.cc'))), 'leaving the step closed the command center');
    continue;
  }
  await page.click('.tour-next');
}
want(n === 13, `the tour showed all 13 steps (${n})`);
const sampleEnd = await page.evaluate(() => window.__falconMarkMap?.());
want(!(await touring(page)), 'Done ends the tour');
want(!(await docNames(page)).includes('Tutorial'), 'the sample document is closed, with no question asked');
want(!(await page.evaluate(() => !!document.querySelector('.cf-back, [role="alertdialog"]'))), 'no "save changes?" prompt');
want(await page.evaluate(() => document.querySelector('.home')?.classList.contains('open')), 'Home is back, as it was before the tour');
await page.waitForTimeout(1500); // the crash-recovery copy is written when the page is idle
let s = await stored(page);
want(!s.autosave.includes('Rivera') && !s.recents.includes('Tutorial') && !s.recents.includes('Rivera'), 'the sample is in neither crash recovery nor recents');
want(!sampleEnd.includes('Rivera'), 'the editor holds the doc it had before, not the sample');
await ctx.close(); // writes the video
const webm = fs.readdirSync(video).find((f) => f.endsWith('.webm'));
if (webm) { fs.renameSync(path.join(video, webm), path.join(out, 'tour.webm')); if (SHOTS) fs.copyFileSync(path.join(out, 'tour.webm'), path.join(SHOTS, 'tour.webm')); }
want(!!webm, 'the whole tour was recorded');

// ---------- 2. the seen flag: the next launch doesn't start it ----------
({ ctx, page } = await context());
await page.goto(URL);
want(await page.waitForSelector('.tour-card', { timeout: 8000 }).then(() => true, () => false), 'a second fresh profile starts it too');
await page.keyboard.press('Escape');
want(!(await touring(page)), 'Esc on the first step ends it');
await page.reload();
await page.waitForSelector('.ProseMirror');
await page.waitForTimeout(4000); // past the falcon's flight, when a first run would start
want(!(await touring(page)), 'with the seen flag stored, a reload doesn\'t start it');
await ctx.close();
// a profile that already has Falcon's things (an update from before the tutorial) without the seen flag doesn't start it either
({ ctx, page } = await context());
await page.goto(URL);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('falcon.recents.v1', '[]'); localStorage.setItem('falcon.outline', 'on'); });
await page.reload();
await page.waitForSelector('.ProseMirror');
await page.waitForTimeout(4000);
want(!(await touring(page)) && (await stored(page)).seen === null, 'an existing profile (Falcon state but no seen flag) doesn\'t start it');

// ---------- 3. Replay with a real document open: it comes back exactly as it was ----------
await page.keyboard.press('Escape'); // Home
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.tools [aria-label="Open…"]')]);
await fc.setFiles(SEED);
await page.waitForFunction(() => [...document.querySelectorAll('.doc-row .doc-nm')].some((b) => b.getAttribute('aria-label') === 'seed'));
await page.waitForTimeout(300);
await page.evaluate(() => { const v = window.__falconView; const S = v.state.selection.constructor; v.dispatch(v.state.tr.setSelection(S.atEnd(v.state.doc))); v.focus(); });
await page.keyboard.type(' edited');
await page.waitForTimeout(300);
const real = { map: await page.evaluate(() => window.__falconMarkMap()), dirty: await page.evaluate(() => !!document.querySelector('.doc-row .doc-nm[aria-label="seed"] i[aria-label="unsaved"]')) };
want(real.map.includes('edited') && real.dirty, 'the seed is open, edited and unsaved');
const replayCheck = async (how) => {
  await page.waitForTimeout(600);
  const map = await page.evaluate(() => window.__falconMarkMap());
  const dirty = await page.evaluate(() => !!document.querySelector('.doc-row .doc-nm[aria-label="seed"] i[aria-label="unsaved"]'));
  const on = await page.evaluate(() => document.querySelector('.doc-row[data-on] .doc-nm')?.getAttribute('aria-label'));
  want(on === 'seed' && map === real.map && dirty, `${how}: the seed is in front again, same content, still unsaved`);
  want(!(await docNames(page)).includes('Tutorial'), `${how}: the sample is gone from the rail`);
};
// from Settings > General
await page.click('.fstrip [aria-label="Settings"]');
await page.waitForSelector('.st-back');
await page.click('.st-row:has-text("Replay tutorial") button');
want(await waitTitle(page, 'Welcome to Falcon') && !(await page.evaluate(() => !!document.querySelector('.st-back'))), 'Replay in Settings closes Settings and starts on step one');
for (let k = 0; k < 3; k++) await page.click('.tour-next');
want(await title(page) === 'Make a tag', 'Next walks to the tag step');
await page.keyboard.press('F7');
await waitTitle(page, 'Mark the cite');
await page.keyboard.press('Escape');
want(!(await touring(page)), 'Esc ends it partway');
await replayCheck('Replay from Settings, then Esc');
// from the command center, then Skip
await page.keyboard.press(`${MOD}+Shift+Space`);
await page.waitForSelector('.cc');
await page.keyboard.type('Replay tutorial');
await page.waitForTimeout(200);
await page.keyboard.press('Enter');
want(await waitTitle(page, 'Welcome to Falcon'), 'the command center\'s Replay tutorial starts it');
await page.click('.tour-next');
await page.click('.tour-skip');
want(!(await touring(page)), 'Skip ends it');
await replayCheck('Replay from the command center, then Skip');
// undo still has the edit made before the tours
await page.keyboard.press(`${MOD}+z`);
await page.waitForTimeout(200);
want(!(await page.evaluate(() => window.__falconMarkMap())).includes('edited'), 'Mod-Z in the seed still undoes the edit from before the tours');
await page.waitForTimeout(1500);
s = await stored(page);
want(s.autosave.includes('seed') && !s.autosave.includes('Rivera') && !s.recents.includes('Tutorial'), 'crash recovery has the seed and not the sample; recents have no sample');
await ctx.close();

// ---------- 4. the light theme (Replay, since a stored theme isn't a fresh profile) ----------
({ ctx, page } = await context());
await page.goto(URL);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('falcon.theme', 'light'); localStorage.setItem('falcon.tourSeen', 'on'); });
await page.reload();
await page.waitForSelector('.ProseMirror');
await page.keyboard.press('Escape');
await page.keyboard.press(`${MOD}+Shift+Space`);
await page.waitForSelector('.cc');
await page.keyboard.type('Replay tutorial');
await page.waitForTimeout(200);
await page.keyboard.press('Enter');
await waitTitle(page, 'Welcome to Falcon');
for (let k = 0; k < 3; k++) { await page.click('.tour-next'); await page.waitForTimeout(450); }
await shot(page, 'light-04');
await page.keyboard.press('F7'); await waitTitle(page, 'Mark the cite');
await page.keyboard.press('F8'); await waitTitle(page, 'Underline');
await page.keyboard.press('F9'); await waitTitle(page, 'Highlight');
await page.keyboard.press('F11'); await waitTitle(page, 'Headings');
await page.click('.tour-next'); await page.waitForTimeout(450); await page.click('.tour-next');
await waitTitle(page, 'The command center');
await page.waitForTimeout(450);
await page.keyboard.press(`${MOD}+Shift+Space`);
await page.waitForSelector('.cc');
await page.waitForTimeout(260);
await shot(page, 'light-10');
want(await page.evaluate(() => document.documentElement.dataset.theme === 'light' || getComputedStyle(document.body).backgroundColor !== 'rgb(15, 15, 16)'), 'the light run is in the light theme');
await ctx.close();

if (errors.length) results.push(`FAIL page errors: ${errors.join(' | ')}`);
const text = results.join('\n');
fs.writeFileSync(path.join(out, 'results.txt'), text + '\n');
console.log(text + `\nevidence: ${out}`);
await browser.close();
if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
