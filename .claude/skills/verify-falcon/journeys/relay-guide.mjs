// Settings > Sharing (under Debate) and its ? guide: open it, step through every step, Esc closes the
// guide but not Settings, and the last step checks a real relay (relay/ under `wrangler dev`) before
// saving its address. A wrong address is turned down and nothing is saved. Needs `npm ci` in relay/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openFalcon, MOD } from '../lib/falcon.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-relay-guide-'));
const port = 19200 + Math.floor(Math.random() * 400);
const RELAY = `http://127.0.0.1:${port}`;
let relayLog = '';
const relay = spawn('npx', ['wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persist, '--show-interactive-dev-session=false'],
  { cwd: path.join(REPO, 'relay'), env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
relay.stdout.on('data', (d) => { relayLog += d; });
relay.stderr.on('data', (d) => { relayLog += d; });
const stopRelay = () => { try { process.kill(-relay.pid, 'SIGTERM'); } catch { /* gone */ } };
process.on('exit', stopRelay);
for (let i = 0; ; i++) {
  try { if ((await fetch(`${RELAY}/x`)).status === 404) break; } catch { /* not up */ }
  if (i > 120) { console.log(relayLog); throw new Error('wrangler dev never came up'); }
  await new Promise((r) => setTimeout(r, 500));
}

const f = await openFalcon('relay-guide');
const { page, want } = f;
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
const wait = (ms) => page.waitForTimeout(ms);
const saved = () => page.evaluate(() => Object.entries(localStorage).find(([k]) => /relayUrl/.test(k))?.[1] ?? null);

await page.click('.fstrip [aria-label="Settings"]');
await wait(300);
const nav = await page.$$eval('[aria-label="Settings sections"] button', (b) => b.map((x) => x.textContent.trim()));
want(nav.indexOf('Sharing') === nav.indexOf('Speech and timers') + 1, `Sharing sits under Debate after Speech and timers (${nav.join(', ')})`);
await page.click('[aria-label="Settings sections"] button:has-text("Sharing")');
await wait(300);
want(await page.isVisible('.st-row:has-text("Relay") .st-help'), 'the Relay row has a ? beside its label');
await f.shot('sharing-page');

await page.click('.st-help');
await page.waitForSelector('.rg');
const titles = [];
for (let i = 0; ; i++) {
  titles.push((await page.textContent('.rg h2')).trim());
  await f.shot(`step-${i + 1}`);
  const next = await page.$('.rg .cf-btns button.co-main:has-text("Next")');
  if (!next) break;
  await next.click();
  await wait(220);
}
want(titles.length === 8 && titles[0] === 'Set up card sharing' && titles.at(-1) === 'Connect Falcon', `eight steps, intro to Connect (${titles.join(' | ')})`);
await page.click('.rg .cf-btns button:has-text("Back")');
await wait(200);
want((await page.textContent('.rg h2')).trim() === 'Put the relay online', 'Back goes one step back');
want((await page.textContent('.rg .rg-cmd code')).trim() === 'npx wrangler deploy', 'the deploy step shows the command to copy');

for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
want(await page.evaluate(() => !!document.activeElement?.closest('.rg')), 'Tab goes round the guide and never out to Settings behind it');
await page.keyboard.press('Escape');
await wait(250);
want(!(await page.$('.rg')) && !!(await page.$('[aria-label="Search settings"]')), 'Esc closes the guide and leaves Settings open');
want(await page.evaluate(() => document.activeElement?.classList.contains('st-help')), 'focus goes back to the ?');

await page.click('.st-help');
await page.waitForSelector('.rg');
for (let i = 0; i < 7; i++) { await page.click('.rg .cf-btns button.co-main'); await wait(150); }
want(await page.evaluate(() => document.activeElement?.matches('.rg input')), 'the Connect step starts in the address box');
await page.fill('.rg input', '127.0.0.1:1');
await page.click('.rg button:has-text("Check and save")');
await page.waitForFunction(() => document.querySelector('.rg-note')?.textContent !== 'Checking…');
want(/Couldn't reach it/.test(await page.textContent('.rg-note')) && (await saved()) === null, `a dead address is turned down, nothing saved (${await page.textContent('.rg-note')})`);
await f.shot('connect-bad');
await page.evaluate((u) => navigator.clipboard.writeText(u), RELAY);
await page.fill('.rg input', '');
await page.keyboard.press(`${MOD}+V`);
await wait(100);
want((await page.inputValue('.rg input')) === RELAY, `a real ${MOD}+V pastes the address (${await page.inputValue('.rg input')})`);
await page.keyboard.press('Enter');
await page.waitForFunction(() => /It works/.test(document.querySelector('.rg-note')?.textContent ?? ''));
want((await saved()) === RELAY, `a real relay is checked and saved (${await saved()})`);
await f.shot('connect-ok');
await page.click('.rg .cf-btns button:has-text("Done")');
await wait(250);
want((await page.inputValue('[aria-label="Relay address"]')) === RELAY, 'the Relay box shows the saved address');

await page.reload();
await wait(800);
want((await saved()) === RELAY, 'the address survives a reload');
stopRelay();
await f.done();
