// Open files in new windows (Settings > General), in the real app, hidden: each file gets a window of its own,
// the windows share one speech doc and one set of settings, and a crash brings every window's unsaved work back.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
env.FALCON_USER_DATA = fs.mkdtempSync(`${os.tmpdir()}/falcon-windows-`);
env.CARDMIRROR_BRIDGE_DIR = fs.mkdtempSync(`${os.tmpdir()}/falcon-windows-bridge-`);
const dir = fs.mkdtempSync(`${os.tmpdir()}/falcon-windows-docs-`);
const file = (n) => { const p = path.join(dir, `${n}.docx`); fs.copyFileSync('.claude/skills/verify-falcon/fixtures/seed.docx', p); return p; };
const [one, two, three, four, five] = ['One', 'Two', 'Three', 'Four', 'Five'].map(file);
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const shots = process.env.FALCON_SHOTS;
const want = (cond, msg) => { console.log(cond ? 'ok  ' : 'FAIL', msg); if (!cond) process.exitCode = 1; };

const launch = (args = []) => electron.launch({ env: { ...env, FALCON_HEADLESS: '1' }, args: ['.', ...args] });
let app = await launch([one]);
const errors = [];
const watch = (p) => p.on('pageerror', (e) => errors.push(e.message));
app.on('window', watch);
const editors = async () => {
  const out = [];
  for (const p of app.windows()) if (await p.locator('.ProseMirror').count().catch(() => 0)) out.push(p);
  return out;
};
const names = (p) => p.evaluate(() => [...document.querySelectorAll('.doc-nm')].map((b) => b.getAttribute('aria-label').replace(' (speech doc)', '')));
/** Each window's files, sorted, like ["One", "Three|Two"]. */
const layout = async () => (await Promise.all((await editors()).map(async (p) => (await names(p)).sort().join('|')))).sort();
const until = async (f, ms = 10000) => { const t = Date.now(); for (;;) { const v = await f().catch(() => false); if (v || Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 100)); } };
const shows = (want) => until(async () => JSON.stringify(await layout()) === JSON.stringify([...want].sort()));
const page = async (name) => { for (const p of await editors()) if ((await names(p)).includes(name)) return p; return null; };
const osOpen = (p) => app.evaluate(({ app: a }, f) => a.emit('open-file', { preventDefault() {} }, f), p);
const setSwitch = async (p) => {
  await p.click('.fstrip [aria-label="Settings"]');
  await p.click('[role=switch][aria-label="Open files in new windows"]');
  await p.keyboard.press('Escape');
};
const toast = (p) => p.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
const speechText = (p) => p.evaluate(() => window.__falconView.state.doc.textContent);
const caretInCard = (p) => p.evaluate(() => {
  const v = window.__falconView; let at = -1;
  v.state.doc.descendants((n, pos) => { if (at < 0 && n.isTextblock && n.textContent.length > 40) at = pos + 1; return at < 0; });
  const S = v.state.selection.constructor.near(v.state.doc.resolve(at)).constructor; v.dispatch(v.state.tr.setSelection(S.create(v.state.doc, at))); v.focus();
});

const first = await app.firstWindow();
watch(first);
await first.waitForSelector('.ProseMirror');
await until(async () => (await names(first)).includes('One'));

// off, the default: tabs, one window
await osOpen(two);
want(await shows(['One|Two']), `off: a second file is a tab: ${await layout()}`);

// on: open tabs spread out, and Settings stays up in this window
await first.click('.fstrip [aria-label="Settings"]');
await first.click('[role=switch][aria-label="Open files in new windows"]');
want(await shows(['One', 'Two']) || await shows(['Two', 'One']), `turning it on gives each tab a window: ${await layout()}`);
await first.keyboard.press('Escape');

// the setting reached the other window without a relaunch
const on = () => localStorage.getItem('falcon.fileWindows');
want(await (await page('Two')).evaluate(on) === 'on', 'the other window has the setting');

// a double-clicked file gets a window; one already open is shown where it is
await osOpen(three);
want(await shows(['One', 'Two', 'Three']), `a new file opens its own window: ${await layout()}`);
await osOpen(two);
const twoPage = await page('Two');
want(await until(async () => /already open/.test(await toast(twoPage))), `a file open in another window isn't opened again: "${await toast(twoPage)}"`);
want(JSON.stringify(await layout()) === JSON.stringify(['One', 'Three', 'Two']), `still three windows: ${await layout()}`);
want(await app.evaluate(({ BrowserWindow }) => BrowserWindow.fromId(globalThis.falconFocused)?.getTitle()) === 'Two', 'and its window comes forward');

// the same file sent twice at once still gets one window
await app.evaluate(({ app: a }, f) => { for (let i = 0; i < 3; i++) a.emit('open-file', { preventDefault() {} }, f); }, four);
await shows(['One', 'Two', 'Three', 'Four']);
await new Promise((r) => setTimeout(r, 1200));
want(JSON.stringify(await layout()) === JSON.stringify(['Four', 'One', 'Three', 'Two']), `one file sent three times, one window: ${await layout()}`);

// New makes a window; the windows' titles tell them apart
const onePage = await page('One');
await onePage.keyboard.press(`${MOD}+n`);
want(await until(async () => (await layout()).includes('Untitled')), `New opens a window: ${await layout()}`);
const blank = await page('Untitled');
want(await blank.evaluate(() => !document.querySelector('.hm')) && await blank.title() === 'Untitled', 'it opens on the blank document, not Home, and is titled for it');
// a file opened from a blank window lands in it
await osOpen(five);
await until(async () => (await layout()).includes('Five'));
const fivePage = await page('Five');
want(!!fivePage, `a file opens: ${await layout()}`);
await fivePage.keyboard.press(`${MOD}+w`).catch(() => {}); // the window goes before the key comes up
want(await until(async () => !(await layout()).includes('Five')), `closing the last doc closes its window: ${await layout()}`);

// Send to speech: the first send makes the speech doc in a window of its own, behind this one
await caretInCard(onePage);
await onePage.keyboard.press('Backquote');
want(await until(async () => (await layout()).includes('Speech')), `the first send makes a speech window: ${await layout()}`);
const speech = await page('Speech');
want(await until(async () => (await speechText(speech)).length > 20), 'the card landed in it');
want(await until(async () => /^Sent/.test(await toast(onePage))), `the sender says so: "${await toast(onePage)}"`);
const once = await speechText(speech);
await onePage.locator('.toast button').click();
want(await until(async () => (await speechText(speech)).length < once.length), 'Undo on the toast takes it back in the other window');
const three1 = await page('Three');
await caretInCard(three1);
await three1.keyboard.press('Backquote');
want(await until(async () => (await speechText(speech)).length > 20), 'another window sends to the same speech doc');
want((await layout()).filter((x) => x === 'Speech').length === 1, `one speech doc: ${await layout()}`);

// a second file marked as the speech doc takes over: there's one for the whole app
const mic = '.tools [aria-label="Speech doc"]';
await three1.click(mic);
want(await until(async () => await speech.getAttribute(mic, 'aria-pressed') !== 'true'), 'marking another file unmarks the first');
await three1.click(mic);
await speech.click(mic);
await new Promise((r) => setTimeout(r, 300));

// a theme picked in one window repaints the others
const bg = (p) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
const before = await bg(twoPage);
await onePage.click('.fstrip [aria-label="Settings"]');
await onePage.click('[aria-label="Settings sections"] button:has-text("Appearance")');
await onePage.click('[aria-label="Theme"] [role=radio][aria-label="Light"]');
await onePage.keyboard.press('Escape');
want(await until(async () => await bg(twoPage) !== before), 'a theme change reaches the other windows');

// Next Doc from a window with one doc goes to the next window
const focused = () => app.evaluate(() => globalThis.falconFocused);
const was = await focused();
await twoPage.evaluate(() => window.falcon.cycleWindow(1));
want(await until(async () => await focused() !== was), 'cycling moves to another window');

// Search cards: a card in a file that opens in its own window, and in a file open in another one
const cardIn = (p) => p.evaluate(() => window.__falconView.state.selection.$from.parent.textContent);
const tags = await twoPage.evaluate(() => { const t = []; window.__falconView.state.doc.forEach((n) => { if (n.attrs.style === 'tag') t.push(n.textContent); }); return t; });
await twoPage.evaluate(([f, tag]) => window.falcon.openWindow({ path: f, card: { tag, ordinal: 1, file: 'Five' }, alone: true }), [five, tags[1]]);
want(await until(async () => (await layout()).includes('Five')), `a card opens its file in a window: ${await layout()}`);
want(await until(async () => await cardIn(await page('Five')) === tags[1]), `at the card: ${tags[1]}`);
await twoPage.evaluate(([f, tag]) => window.falcon.openWindow({ path: f, card: { tag, ordinal: 0, file: 'Five' } }), [five, tags[0]]);
want(await until(async () => await cardIn(await page('Five')) === tags[0]), `a card in a file open elsewhere goes there: ${tags[0]}`);

// Nimbus sees every window's docs, and a card reaches the window its target is in, or the speech doc with no target
fs.writeFileSync(path.join(env.CARDMIRROR_BRIDGE_DIR, 'nimbus.json'), JSON.stringify({ schema: 1, app: 'nimbus', appVersion: '1.6.4', kind: 'flow' }));
const s = JSON.parse(fs.readFileSync(path.join(env.CARDMIRROR_BRIDGE_DIR, 'falcon.session.json'), 'utf8'));
const call = async (method, route, body) => (await fetch(`http://127.0.0.1:${s.port}${route}`, { method, body: body && JSON.stringify(body), headers: { 'X-Bridge-Token': s.token, 'X-App-Id': 'nimbus', 'Content-Type': 'application/json' } })).json();
await call('GET', '/docs');
for (const p of await editors()) await p.click('.cf-ok', { timeout: 300 }).catch(() => {}); // the consent question
const listed = await call('GET', '/docs');
const titles = listed.docs?.map((d) => d.title).sort() ?? [];
want(titles.join() === 'Five,Four,One,Speech,Three,Two', `Nimbus lists every window: ${titles}`);
want(new Set(listed.docs.map((d) => d.target)).size === listed.docs.length && listed.docs.filter((d) => d.focusedWindow).length === 1, 'each with its own target, one focused');
const card = (t) => ({ html: `<p>${t}</p>`, text: t, title: t });
const sentTo = await call('POST', '/insert', { ...card('Sent to Three by target'), target: listed.docs.find((d) => d.title === 'Three').target });
want(sentTo.ok && (await speechText(three1)).includes('Sent to Three by target'), `an insert reaches its target's window: ${JSON.stringify(sentTo)}`);
const noTarget = await call('POST', '/insert', card('Sent with no target'));
want(noTarget.ok && (await speechText(speech)).includes('Sent with no target'), `no target: the speech doc, in its window: ${JSON.stringify(noTarget)}`);

if (shots) await twoPage.screenshot({ path: path.join(shots, 'windows-file.png') });

// a crash: every window's unsaved work comes back, and each file in a window again. Clean windows stay closed
for (const [p, text] of [[onePage, 'edit in one '], [twoPage, 'edit in two ']]) { await caretInCard(p); await p.keyboard.type(text); }
await new Promise((r) => setTimeout(r, 2000)); // a backup runs 800 ms after typing stops, at idle
app.process().kill('SIGKILL');
await new Promise((r) => setTimeout(r, 500));
app = await launch();
app.on('window', watch);
const back = await app.firstWindow();
await back.waitForSelector('.ProseMirror');
want(await until(async () => (await layout()).filter((x) => /One|Two/.test(x)).length === 2), `after a crash both come back: ${await layout()}`);
const [a, b] = [await page('One'), await page('Two')];
want(/edit in one/.test(await speechText(a)) && /edit in two/.test(await speechText(b)), 'with their edits');
const dirty = (p) => p.locator('.doc-row [aria-label="unsaved"], .doc-row .dot').count();
want(await dirty(a) > 0 && await dirty(b) > 0, 'still unsaved');
await new Promise((r) => setTimeout(r, 800));
want(!(await layout()).some((x) => /Four|Five/.test(x)), `saved files stay closed: ${await layout()}`);

// off again: windows stay as they are, and the next file is a tab
await setSwitch(a);
await until(async () => await b.evaluate(() => localStorage.getItem('falcon.fileWindows')) === 'off');
const count = (await editors()).length;
await osOpen(four);
want(await until(async () => (await layout()).some((x) => x.includes('|') && x.includes('Four'))), `off: the next file is a tab: ${await layout()}`);
want((await editors()).length === count, 'and no window opened or closed');

// on again, with Crash recovery off: a tab still moves whole, since that isn't a crash copy
const holder = await page('Four');
const other = (await editors()).find((p) => p !== holder);
await other.evaluate(() => localStorage.setItem('falcon.crashRecovery', 'off'));
await new Promise((r) => setTimeout(r, 300));
await setSwitch(holder);
want(await until(async () => (await layout()).includes('Four')), `on again: the tab moves out: ${await layout()}`);
want(await until(async () => (await speechText(await page('Four'))).length > 20), 'with its text, Crash recovery off or not');
await other.evaluate(() => { localStorage.setItem('falcon.crashRecovery', 'on'); localStorage.setItem('falcon.reopen', 'on'); });
await new Promise((r) => setTimeout(r, 1500));

// quitting asks in each window with unsaved work, then goes
await app.evaluate(() => { globalThis.falconSkipUnloadGuard = false; });
const exited = new Promise((r) => app.process().once('exit', () => r(true)));
await app.evaluate(({ app: x }) => { setTimeout(() => x.quit(), 0); });
let asked = 0, gone = false;
void exited.then(() => { gone = true; });
for (let t = 0; t < 200 && !gone; t++) {
  for (const p of app.windows()) {
    if (await p.locator('.cf-ok').count().catch(() => 0)) { asked++; await p.click('.cf-ok', { timeout: 500 }).catch(() => {}); }
  }
  await new Promise((r) => setTimeout(r, 100));
}
want(gone, 'quit goes through once each window is answered');
want(asked >= 2, `every window with unsaved work asked: ${asked}`);

// Restore open files brings every window's file back, each in a window, with no copies
app = await launch();
app.on('window', watch);
await (await app.firstWindow()).waitForSelector('.ProseMirror');
want(await shows(['Four', 'One', 'Speech', 'Three', 'Two']), `Restore open files: ${await layout()}`);

want(!errors.length, `no page errors: ${errors.join(' / ')}`);
await app.evaluate(() => { globalThis.falconSkipUnloadGuard = true; });
await app.close();
fs.rmSync(env.FALCON_USER_DATA, { recursive: true, force: true });
fs.rmSync(dir, { recursive: true, force: true });
fs.rmSync(env.CARDMIRROR_BRIDGE_DIR, { recursive: true, force: true });
