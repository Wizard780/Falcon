// Updater end to end on a Mac: serves a fake 0.1.4 release, launches a packaged 0.1.3 app at it,
// hovers and clicks the update button. Usage: node scripts/update-e2e.mjs <dir> [good|badsum|dirty]
// <dir>/apps/Falcon.app (the running build), <dir>/feed/Falcon-0.1.4-arm64.dmg and SHA256SUMS.txt,
// <dir>/body.md (release notes). After "good", the app in <dir>/apps should be 0.1.4 and running again.
import { _electron as electron } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const S = process.argv[2], mode = process.argv[3] || 'good';
const dmg = path.join(S, 'feed/Falcon-0.1.4-arm64.dmg');
const srv = http.createServer((req, res) => {
  const base = `http://127.0.0.1:${srv.address().port}`;
  if (req.url === '/feed.json') return res.end(JSON.stringify({
    tag_name: 'v0.1.4', draft: false, prerelease: false, published_at: new Date(Date.now() - 2 * 3600e3).toISOString(),
    html_url: 'https://github.com/Wizard780/Falcon/releases/tag/v0.1.4', body: fs.readFileSync(path.join(S, 'body.md'), 'utf8'),
    assets: [{ name: 'Falcon-0.1.4-arm64.dmg', size: fs.statSync(dmg).size, browser_download_url: `${base}/dmg` },
             { name: 'SHA256SUMS.txt', browser_download_url: `${base}/sums` }] }));
  if (req.url === '/dmg') return fs.createReadStream(dmg).pipe(res);
  if (req.url === '/sums') return res.end(mode === 'badsum' ? `${'0'.repeat(64)}  Falcon-0.1.4-arm64.dmg\n` : fs.readFileSync(path.join(S, 'feed/SHA256SUMS.txt')));
  res.statusCode = 404; res.end();
}).listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
Object.assign(env, { FALCON_HEADLESS: '1', FALCON_USER_DATA: fs.mkdtempSync(`${os.tmpdir()}/falcon-upd-`), FALCON_UPDATE_FEED: `http://127.0.0.1:${srv.address().port}/feed.json` });
const app = await electron.launch({ executablePath: path.join(S, 'apps/Falcon.app/Contents/MacOS/Falcon'), env });
const win = await app.firstWindow();
console.log('running version', await app.evaluate(({ app }) => app.getVersion()));
await win.waitForSelector('.ProseMirror');
await win.keyboard.press('Escape');
const shown = await win.waitForSelector('.fs-b.upd', { timeout: 20000 }).then(() => true, () => false);
console.log('button shown', shown);
if (!shown) { await app.close(); srv.close(); process.exit(mode === 'badsum' ? 0 : 1); }
await win.hover('.fs-b.upd'); await win.waitForTimeout(400);
console.log('card', JSON.stringify(await win.evaluate(() => document.querySelector('.upd-card[data-open]')?.innerText)));
await win.screenshot({ path: path.join(S, 'card.png') });
if (mode === 'dirty') {
  // an unsaved doc: the click asks first, and Cancel leaves the app running and unchanged
  await win.click('.ProseMirror'); await win.keyboard.type('unsaved words');
  await win.click('.fs-b.upd'); await win.waitForTimeout(400);
  console.log('asked', JSON.stringify(await win.evaluate(() => document.querySelector('[role=alertdialog], [role=dialog]')?.innerText)));
  await win.keyboard.press('Escape'); await win.waitForTimeout(1500);
  console.log('still running', await app.evaluate(({ app }) => app.getVersion()));
  await app.close(); srv.close(); process.exit(0);
}
await win.click('.fs-b.upd');
await app.waitForEvent('close', { timeout: 60000 }).catch((e) => console.log('close wait', e.message));
console.log('app quit');
srv.close();
