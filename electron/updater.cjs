// Updates: check GitHub for a newer release, download its installer in the background, and install
// it when the update button in the rail is clicked. Not electron-updater: the Mac build is ad-hoc
// signed, and Squirrel.Mac refuses an update whose signature isn't a Developer ID's, so the Mac swaps
// the app bundle itself. FALCON_UPDATE_FEED points the check at another release JSON (tests).
const { app, BrowserWindow, ipcMain, net, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const run = promisify(execFile);
// app bundles hold app.asar, which Electron's fs treats as a folder and can't delete: rm does it
const rmApp = (p) => run('rm', ['-rf', p]).catch(() => {});
// a test feed must be on this machine: the feed decides what installer runs
const TEST_FEED = /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(process.env.FALCON_UPDATE_FEED || '') ? process.env.FALCON_UPDATE_FEED : null;
const FEED = TEST_FEED || 'https://api.github.com/repos/Wizard780/Falcon/releases/latest';
const EVERY = 4 * 60 * 60 * 1000;
const HEADERS = { 'User-Agent': 'Falcon-updater', Accept: 'application/vnd.github+json' };

/** a is a later x.y.z than b */
function newer(a, b) {
  const p = (v) => String(v).replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

/** The installer this machine runs: the .dmg for its chip on a Mac, the Setup .exe on Windows. */
function assetFor(assets, platform = process.platform, arch = process.arch) {
  const want = platform === 'darwin' ? (n) => n.endsWith(`-${arch}.dmg`) : platform === 'win32' ? (n) => /^Falcon-Setup-.*\.exe$/.test(n) : () => false;
  return (assets || []).find((a) => want(a.name));
}

// the Mac app bundle this process runs from (.../Falcon.app/Contents/MacOS/Falcon)
const bundle = () => path.resolve(app.getPath('exe'), '../../..');
/** The Mac can swap the bundle in place: not run from the disk image or a quarantined copy macOS moved, and its folder is writable. */
function canSwap() {
  if (process.platform !== 'darwin') return true;
  const b = bundle();
  if (!b.endsWith('.app') || b.startsWith('/Volumes/') || b.includes('/AppTranslocation/')) return false;
  try { fs.accessSync(path.dirname(b), fs.constants.W_OK); return true; } catch { return false; }
}

// what the page shows: null, or { version, date, notes, url, state: 'ready' | 'installing' | 'error', manual, error }
let update = null;
let file = null; // the downloaded installer
let pending = null; // the check running now: a click during one waits on it
const dir = () => path.join(app.getPath('userData'), 'updates');
function publish(next) {
  update = next;
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('falcon:update', update);
}

const get = (url, ms, headers = { 'User-Agent': HEADERS['User-Agent'] }) => net.fetch(url, { headers, signal: AbortSignal.timeout(ms) });
async function json(url) {
  const r = await get(url, 30_000, HEADERS);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

// streams the file to disk, hashing as it goes
async function download(url, to) {
  const r = await get(url, 20 * 60_000);
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status} for ${url}`);
  const hash = crypto.createHash('sha256');
  const tap = new Transform({ transform(chunk, _enc, done) { hash.update(chunk); done(null, chunk); } });
  await pipeline(Readable.fromWeb(r.body), tap, fs.createWriteStream(to)); // rejects on a network or disk error
  return { sha: hash.digest('hex'), size: (await fsp.stat(to)).size };
}

/** The SHA-256 SHA256SUMS.txt lists for this file name (sha256sum format), or null. */
function sumFor(text, name) {
  for (const line of text.split(/\r?\n/)) {
    const [sha, file] = line.trim().split(/\s+/);
    if (file && file.replace(/^\*/, '') === name) return sha.toLowerCase();
  }
  return null;
}

// Each version downloads into its own folder, so a later check never touches the installer the
// button points at; the folder is only swapped in once its download is whole and checked.
let swept = null; // the startup cleanup: whatever an earlier run downloaded is this version or older
/** 'ready' (an update is downloaded), 'none' (this is the latest), or 'failed' (offline, rate-limited). */
function check() {
  return (pending ??= look().finally(() => { pending = null; }));
}
async function look() {
  if (update?.state === 'installing') return 'ready';
  let into = null;
  try {
    await swept;
    const rel = await json(FEED);
    const version = String(rel.tag_name || '').replace(/^v/, '');
    if (rel.draft || rel.prerelease || !newer(version, app.getVersion())) return update ? 'ready' : 'none';
    if (update && !newer(version, update.version)) return 'ready'; // this one (or a later one) is already downloaded
    const asset = assetFor(rel.assets);
    const sums = (rel.assets || []).find((a) => a.name === 'SHA256SUMS.txt');
    if (!asset || !sums) return update ? 'ready' : 'none'; // no installer for this machine, or nothing to check it against
    into = path.join(dir(), version);
    await fsp.rm(into, { recursive: true, force: true });
    await fsp.mkdir(into, { recursive: true });
    const to = path.join(into, asset.name);
    const got = await download(asset.browser_download_url, to + '.part');
    if (asset.size && got.size !== asset.size) throw new Error(`download was ${got.size} bytes, expected ${asset.size}`);
    // integrity (a whole, uncorrupted download), not authenticity: both files come from the same release
    const r = await get(sums.browser_download_url, 30_000);
    const want = r.ok ? sumFor(await r.text(), asset.name) : null;
    if (want !== got.sha) throw new Error(want ? `checksum mismatch for ${asset.name}` : `no checksum for ${asset.name}`);
    await fsp.rename(to + '.part', to);
    if (update?.state === 'installing') return 'ready'; // an older one is going in now; this one waits for next launch
    const prev = file;
    file = to; into = null;
    publish({ version, date: rel.published_at, notes: rel.body || '', url: rel.html_url, state: 'ready', manual: !canSwap() });
    if (prev) fsp.rm(path.dirname(prev), { recursive: true, force: true }).catch(() => {});
    return 'ready';
  } catch (e) {
    console.error('[falcon] update check failed:', e.message); // offline, rate-limited: try again next time
    if (into) fsp.rm(into, { recursive: true, force: true }).catch(() => {});
    return update ? 'ready' : 'failed';
  }
}

// Mac: copy the new app out of the disk image next to this one, check its signature, swap the two
async function swapMac() {
  const b = bundle(), parent = path.dirname(b);
  const mnt = await fsp.mkdtemp(path.join(path.dirname(file), 'mnt-'));
  const staged = path.join(parent, '.Falcon-update.app'), old = path.join(parent, '.Falcon-old.app');
  await rmApp(staged);
  await rmApp(old);
  await run('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mnt, file]);
  try {
    const src = (await fsp.readdir(mnt)).find((n) => n.endsWith('.app'));
    if (!src) throw new Error('no app in the disk image');
    await run('ditto', [path.join(mnt, src), staged]);
  } finally { await run('hdiutil', ['detach', mnt, '-force']).catch(() => {}); }
  await run('codesign', ['--verify', '--deep', '--strict', staged]);
  // a running app keeps its open files, so the bundle can move out from under it
  await fsp.rename(b, old);
  try { await fsp.rename(staged, b); } catch (e) { await fsp.rename(old, b); throw e; }
  await rmApp(old); // start() sweeps up anything left
}

async function install() {
  if (!update || !file || update.state === 'installing') return;
  if (update.manual) { await shell.openPath(file); return; } // the user drags it in from the disk image
  publish({ ...update, state: 'installing', error: undefined });
  try {
    if (process.platform === 'darwin') {
      await swapMac();
      app.relaunch();
    } else {
      // the NSIS installer: silent, as an update, and it opens Falcon again when it's done
      const child = spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' });
      await new Promise((res, rej) => { child.once('spawn', res); child.once('error', rej); }); // blocked or missing: stay open
      child.unref();
    }
    globalThis.falconSkipUnloadGuard = true; // the page already asked about unsaved documents
    app.quit();
  } catch (e) {
    publish({ ...update, state: 'error', error: e.message });
  }
}

function start() {
  // what an interrupted Mac swap left beside the app
  if (process.platform === 'darwin' && app.isPackaged) for (const n of ['.Falcon-update.app', '.Falcon-old.app']) void rmApp(path.join(path.dirname(bundle()), n));
  swept = fsp.rm(dir(), { recursive: true, force: true }).catch(() => {});
  ipcMain.handle('falcon:update-get', () => update);
  ipcMain.handle('falcon:update-install', install);
  ipcMain.handle('falcon:update-check', () => check()); // the button in the rail, when no update waits
  // packaged builds only (dev and test runs never update themselves), unless a test feed is set
  const feed = !!TEST_FEED;
  if (!feed && (!app.isPackaged || process.env.FALCON_HEADLESS === '1')) return;
  setTimeout(check, feed ? 500 : 10_000);
  setInterval(check, EVERY).unref?.();
}

module.exports = { start, newer, assetFor, sumFor };
