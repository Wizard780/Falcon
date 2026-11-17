// An in-app update brings back every open file, with Restore open files off (the default). Mac only: it runs the
// real updater against a local release feed, on a copy of this repo's Electron.app, so the swap, the relaunch and
// the quit are the real ones. The relaunched app has no Playwright behind it: it is reached over the
// DevTools port it inherits. The Windows installer is not exercised. Needs `npm run build` (dist/).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, chromium } from 'playwright';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const out = path.join(process.env.FALCON_EVIDENCE ?? fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-evidence-')), 'update-restore-desktop');
fs.mkdirSync(out, { recursive: true });
const results = [];
const want = (ok, what) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`); console.log(results.at(-1)); return ok; };
const finish = () => { fs.writeFileSync(path.join(out, 'results.txt'), results.join('\n') + '\n'); process.exitCode = results.some((r) => r.startsWith('FAIL')) ? 1 : 0; };
if (process.platform !== 'darwin') { want(false, 'Mac only: the Windows update runs the NSIS installer, which this journey cannot'); finish(); process.exit(); }
let orphan = 0; // the relaunched app, which nothing else stops
setTimeout(() => { want(false, 'timed out after the checks above'); finish(); try { process.kill(orphan, 'SIGTERM'); } catch { /* gone */ } process.exit(1); }, 600_000).unref();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-update-restore-'));
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' });
// an app bundle of our own to swap: the dmg holds a copy of it, both ad-hoc signed so the updater's codesign check passes
const bundle = path.join(tmp, 'apps/Electron.app'), exe = path.join(bundle, 'Contents/MacOS/Electron');
fs.mkdirSync(path.join(tmp, 'stage'), { recursive: true });
run('ditto', [path.join(REPO, 'node_modules/electron/dist/Electron.app'), bundle]);
run('codesign', ['--force', '--deep', '-s', '-', bundle]);
run('ditto', [bundle, path.join(tmp, 'stage/Electron.app')]);
run('hdiutil', ['create', '-quiet', '-srcfolder', path.join(tmp, 'stage'), '-format', 'UDRO', '-ov', path.join(tmp, 'good.dmg')]);
fs.writeFileSync(path.join(tmp, 'bad.dmg'), crypto.randomBytes(4096)); // a whole download that isn't a disk image: the swap fails
let dmg = path.join(tmp, 'good.dmg');
const NAME = `Falcon-99.0.0-${process.arch}.dmg`;
const feed = http.createServer((req, res) => {
  const base = `http://127.0.0.1:${feed.address().port}`;
  if (req.url === '/feed.json') return res.end(JSON.stringify({ tag_name: 'v99.0.0', draft: false, prerelease: false, published_at: new Date().toISOString(), html_url: base, body: 'A test release.',
    assets: [{ name: NAME, size: fs.statSync(dmg).size, browser_download_url: `${base}/dmg` }, { name: 'SHA256SUMS.txt', browser_download_url: `${base}/sums` }] }));
  if (req.url === '/dmg') return fs.createReadStream(dmg).pipe(res);
  if (req.url === '/sums') return res.end(`${crypto.createHash('sha256').update(fs.readFileSync(dmg)).digest('hex')}  ${NAME}\n`);
  res.statusCode = 404; res.end();
}).listen(0, '127.0.0.1');
await new Promise((r) => feed.once('listening', r));

const docs = fs.mkdtempSync(path.join(tmp, 'docs-'));
const file = (n) => { const p = path.join(docs, `${n}.docx`); fs.copyFileSync(path.join(REPO, '.claude/skills/verify-falcon/fixtures/seed.docx'), p); return p; };
const FILES = ['One', 'Two', 'Three', 'Four'].map(file);
const EDIT = 'words typed before the update';
const until = async (f, ms = 15000) => { const t = Date.now(); for (;;) { const v = await f().catch(() => false); if (v || Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 150)); } };
const names = (p) => p.evaluate(() => [...document.querySelectorAll('.doc-nm')].map((b) => b.getAttribute('aria-label').replace(' (speech doc)', '')));
const editors = async (pages) => { const o = []; for (const p of pages) if (await p.locator('.ProseMirror').count().catch(() => 0)) o.push(p); return o; };
/** Every window's docs, one list, sorted: a doc open twice shows twice. */
const allNames = async (pages) => (await Promise.all((await editors(pages)).map(names))).flat().sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const launch = (userData, withFeed) => {
  const env = { ...process.env, FALCON_HEADLESS: '1', FALCON_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  if (withFeed) env.FALCON_UPDATE_FEED = `http://127.0.0.1:${feed.address().port}/feed.json`; else delete env.FALCON_UPDATE_FEED;
  return electron.launch({ executablePath: exe, args: [REPO], cwd: REPO, env });
};
/** Opens the four files as a user double-clicking them would, makes One unsaved and leaves Two the open doc
 *  (with a window per file, each in its own window). Returns the first window. */
async function setUp(app, { fileWindows = false } = {}) {
  const first = await app.firstWindow();
  await first.waitForSelector('.ProseMirror');
  await first.keyboard.press('Escape');
  if (fileWindows) {
    await first.click('.fstrip [aria-label="Settings"]');
    await first.click('[role=switch][aria-label="Open files in new windows"]');
    await first.keyboard.press('Escape');
  }
  for (const f of FILES) {
    await app.evaluate(({ app: a }, p) => a.emit('open-file', { preventDefault() {} }, p), f);
    const n = path.basename(f, '.docx');
    await until(async () => (await allNames(app.windows())).includes(n));
  }
  const pageWith = async (n) => { for (const p of await editors(app.windows())) if ((await names(p)).includes(n)) return p; return null; };
  const one = await pageWith('One');
  await one.click('.doc-row .doc-nm[aria-label="One"]');
  await one.click('.ProseMirror');
  await one.keyboard.type(EDIT);
  await until(() => one.locator('.doc-row:has(.doc-nm[aria-label="One"]) i[aria-label="unsaved"]').count());
  const two = await pageWith('Two');
  await two.click('.doc-row .doc-nm[aria-label="Two"]');
  await new Promise((r) => setTimeout(r, 1500)); // a backup and the session list both land after a render
  return first;
}
const devtoolsPort = (userData) => { try { return fs.readFileSync(path.join(userData, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { return null; } };
/** Clicks the rail's update button, says yes, and waits for the app to quit. */
async function update(app, first) {
  want(await until(() => first.locator('.fs-b.upd[data-state="ready"]').count(), 60000), 'the update downloaded and the rail offers it');
  const exited = new Promise((r) => app.process().once('exit', () => r(true)));
  await first.click('.fs-b.upd');
  await first.click('.cf-ok');
  return Promise.race([exited, new Promise((r) => setTimeout(() => r(false), 60000))]);
}
/** The app the updater relaunched: connect over the DevTools port it inherited, and stop it when done. */
async function relaunched(userData, oldPort) {
  const port = await until(async () => { const p = devtoolsPort(userData); return p && p !== oldPort ? p : false; }, 30000);
  if (!port) return null;
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const pages = () => browser.contexts().flatMap((c) => c.pages());
  const pid = orphan = Number(run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).split('\n')[0]);
  return { browser, pages, stop: async () => { await browser.close().catch(() => {}); try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } await until(async () => { try { process.kill(pid, 0); return false; } catch { return true; } }); } };
}
/** One's text and unsaved mark, in whichever window has it. */
async function oneState(pages) {
  for (const p of await editors(pages)) {
    if (!(await names(p)).includes('One')) continue;
    // its windows are hidden and, without Playwright's switches, backgrounded: a real click waits on frames that never come
    await p.evaluate(() => document.querySelector('.doc-row .doc-nm[aria-label="One"]').click());
    await new Promise((r) => setTimeout(r, 300));
    return { text: await p.evaluate(() => window.__falconView.state.doc.textContent), unsaved: await p.locator('.doc-row:has(.doc-nm[aria-label="One"]) i[aria-label="unsaved"]').count() > 0 };
  }
  return { text: '', unsaved: false };
}
const ALL = ['Four', 'One', 'Three', 'Two'];
const RECOVERED = ['One', 'Two']; // crash recovery alone: the open doc and the unsaved one

for (const fileWindows of [false, true]) {
  const how = fileWindows ? 'a window per file' : 'tabs';
  const userData = fs.mkdtempSync(path.join(tmp, 'profile-'));
  dmg = path.join(tmp, 'good.dmg');
  const app = await launch(userData, true);
  const first = await setUp(app, { fileWindows });
  await first.screenshot({ path: path.join(out, `${fileWindows ? 'windows' : 'tabs'}-before.png`) });
  const oldPort = devtoolsPort(userData);
  want(await update(app, first), `${how}: Install and Restart quits the app`);
  const next = await relaunched(userData, oldPort);
  if (!want(!!next, `${how}: the updater relaunched it`)) continue;
  // every file back, and then no more (a late open of the active doc would make a copy)
  await until(async () => same(await allNames(next.pages()), ALL), 20000);
  await new Promise((r) => setTimeout(r, 2000));
  const got = await allNames(next.pages());
  want(same(got, ALL), `${how}: every file is back after the update, each once: ${got.join(', ')}`);
  const one = await oneState(next.pages());
  want(one.text.includes(EDIT) && one.unsaved, `${how}: the unsaved doc comes back with its edits, still unsaved (${one.unsaved ? 'unsaved' : 'saved'})`);
  const [shot] = await editors(next.pages());
  want(shot && await shot.evaluate(() => localStorage.getItem('falcon.reopen')) !== 'on', `${how}: Restore open files is still off`);
  want(!fs.existsSync(path.join(userData, 'just-updated')), `${how}: the relaunch used up the update marker`);
  if (shot) await shot.screenshot({ path: path.join(out, `${fileWindows ? 'windows' : 'tabs'}-after.png`), timeout: 15000 }).catch(() => {});
  await next.stop();
}

// a normal quit and relaunch, Restore open files off: only what crash recovery keeps
{
  const userData = fs.mkdtempSync(path.join(tmp, 'profile-'));
  let app = await launch(userData, false);
  await setUp(app);
  await app.close();
  app = await launch(userData, false);
  const w = await app.firstWindow();
  await w.waitForSelector('.ProseMirror');
  await until(async () => same(await allNames(app.windows()), RECOVERED));
  await new Promise((r) => setTimeout(r, 2500));
  const got = await allNames(app.windows());
  want(same(got, RECOVERED), `a normal quit brings back only the open and the unsaved doc: ${got.join(', ')}`);
  await app.close();
}

// the install fails (a download that isn't a disk image): the app stays open, and the next launch is an ordinary one
{
  const userData = fs.mkdtempSync(path.join(tmp, 'profile-'));
  dmg = path.join(tmp, 'bad.dmg');
  let app = await launch(userData, true);
  const first = await setUp(app);
  want(await until(() => first.locator('.fs-b.upd[data-state="ready"]').count(), 60000), 'failed install: the rail offers the update');
  await first.click('.fs-b.upd');
  await first.click('.cf-ok');
  want(await until(() => first.locator('.fs-b.upd[data-state="error"]').count(), 30000), 'failed install: the rail shows the error and the app stays open');
  const left = fs.readdirSync(userData).filter((n) => /update/i.test(n) && n !== 'updates');
  want(!fs.existsSync(path.join(userData, 'just-updated')) && !left.length, `failed install: no update marker is left in userData (${left.join(', ') || 'none'})`);
  await app.close();
  app = await launch(userData, false);
  await (await app.firstWindow()).waitForSelector('.ProseMirror');
  await until(async () => same(await allNames(app.windows()), RECOVERED));
  await new Promise((r) => setTimeout(r, 2500));
  const got = await allNames(app.windows());
  want(same(got, RECOVERED), `failed install: the next launch restores nothing extra: ${got.join(', ')}`);
  await app.close();
}

feed.close();
run('rm', ['-rf', tmp]);
finish();
console.log(`evidence: ${out}`);
