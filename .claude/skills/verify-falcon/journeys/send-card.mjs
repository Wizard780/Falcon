// Send Card through a real relay: two Falcons (separate browser contexts, so separate IndexedDB and
// separate identities) and relay/ under `wrangler dev`. A adds B's pairing code and sends a card with
// a highlight, underline and an emphasis box; B, typing at the time, gets a toast and keeps typing,
// then inserts it and the marks match. Then: the relay stopped (plain message, editor fine), and a
// Falcon with no relay set (inert, says so). Needs `npm ci` in relay/ first.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openFalcon, SEED, MOD, URL as FALCON } from '../lib/falcon.mjs';

const { inboxId, parseCode } = await import(new globalThis.URL('../../../../src/collab/code.ts', import.meta.url).pathname);

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-relay-journey-'));
const port = 18800 + Math.floor(Math.random() * 400);
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
const rowsWaiting = () => {
  const dir = path.join(persist, 'v3', 'do', 'falcon-relay-Inbox');
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((x) => x.endsWith('.sqlite')).reduce((n, x) => {
    const db = new DatabaseSync(path.join(dir, x), { readOnly: true });
    try { return n + (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'msg'").get() ? db.prepare('SELECT COUNT(*) AS n FROM msg').get().n : 0); } finally { db.close(); }
  }, 0);
};

const A = await openFalcon('send-card');
const B = await openFalcon('send-card/b');
const want = A.want;
for (const f of [A, B]) await f.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
const wait = (f, ms) => f.page.waitForTimeout(ms);
const toast = async (f) => (await f.page.textContent('.toast')).trim();
const command = async (f, text) => {
  await f.page.keyboard.press(`${MOD}+Shift+Space`);
  await f.page.waitForSelector('.cc input');
  await f.page.fill('.cc input', text);
  await wait(f, 150);
  const row = await f.page.$eval('.cc-row[data-on] .cc-nm', (x) => x.textContent).catch(() => null);
  await f.page.keyboard.press('Enter');
  await wait(f, 300);
  return row;
};
/** Settings > General > Card sharing > Relay, typed in, as a user sets it */
async function setRelay(f, url) {
  await f.page.click('.fstrip [aria-label="Settings"]');
  await f.page.fill('[aria-label="Search settings"]', 'relay');
  await wait(f, 200);
  await f.page.fill('input[aria-label="Relay address"]', url);
  await f.page.press('input[aria-label="Relay address"]', 'Enter'); // the address is saved on Enter, not as it's typed
  await wait(f, 100);
  await f.page.keyboard.press('Escape'); // clears the search
  await f.page.keyboard.press('Escape'); // closes Settings
  await wait(f, 300);
}
const status = (f) => f.page.textContent('.co-line');
const linked = (f) => f.page.waitForFunction(() => document.querySelector('.co-line')?.textContent?.startsWith('Connected'), null, { timeout: 15000 }).then(() => true, () => false);

// ---------- B: relay, name, code ----------
await setRelay(B, RELAY);
want((await B.page.evaluate(() => localStorage.getItem('falcon.relayUrl'))) === RELAY, 'B: the relay typed in Settings is stored (falcon.relayUrl)');
want((await command(B, 'card sharing')) === 'Card sharing', 'B: the command center finds "Card sharing" and Enter opens it');
want(await linked(B), `B: the panel says it is connected to the relay (${await status(B)})`);
const codeB = (await B.page.textContent('.co-code')).trim();
want(/^[0-9A-Z]{7}(-[0-9A-Z]{7}){7}$/.test(codeB), `B: shows a 56-character pairing code in groups of 7: ${codeB}`);
await B.page.click('.co-me button');
await wait(B, 200);
want((await B.page.evaluate(() => navigator.clipboard.readText())) === codeB && (await toast(B)) === 'Copied your pairing code', 'B: Copy puts the code on the clipboard and says so');
await B.page.fill('#co-name', 'Blake');
await B.shot('b-panel-dark');
await B.page.keyboard.press('Escape');
await wait(B, 200);
want(!(await B.page.$('.cf.co')), 'B: Esc closes the panel');

// ---------- A: relay, contact, a formatted card ----------
await setRelay(A, RELAY);
await command(A, 'card sharing');
await A.page.fill('#co-name', 'Avery');
await A.page.fill('input[aria-label="Their pairing code"]', codeB.toLowerCase().replace(/-/g, ' ').slice(0, -1) + 'X');
await A.page.click('.co-add button[type="submit"]');
await wait(A, 150);
want((await A.page.textContent('.co-hint')) === 'That code has a typo. Copy it again', `A: a mistyped code is turned down with a clear reason (${await A.page.textContent('.co-hint')})`);
await A.page.fill('input[aria-label="Their pairing code"]', codeB.toLowerCase().replace(/-/g, ' '));
await A.page.fill('input[aria-label="Their name"]', 'Blake');
await A.page.click('.co-add button[type="submit"]');
await wait(A, 200);
want((await A.page.$$eval('.co-ct .nm', (x) => x.map((n) => n.textContent))).join() === 'Blake', 'A: Blake is in contacts');
await A.shot('a-contact-added');
await A.page.keyboard.press('Escape');
await A.open(SEED);
await A.select('next year');
await A.page.keyboard.press('F10');
await A.select('Global');
await A.page.keyboard.press('F11');
await wait(A, 100);
await A.page.click('.ProseMirror:not(.hm-doc) :text("Smith 24")');
const mapA = (await A.markMap()).split('\n');
const card = mapA.slice(3, 6).join('\n');
want(card.includes('{emphasis}') && card.includes('{underline}') && card.includes('highlight:yellow+underline') && card.includes('[Global]{highlight:'), `A: the card has an emphasis box, underline and highlights:\n${card}`);

// ---------- send, while B is typing ----------
await B.page.click('.ProseMirror:not(.hm-doc)');
await B.page.keyboard.type('Typing while ');
const reqs = [];
A.page.on('request', (r) => { if (r.url().startsWith(RELAY)) reqs.push(r.method()); });
want((await command(A, 'send card')) === 'Send Card to…', 'A: the command center finds Send Card to…');
want((await A.page.textContent('#co-st')) === 'Send “Growth is slowing” to…', 'A: the picker names the card at the caret');
await A.shot('a-send-picker');
await A.page.keyboard.press('Enter');
await A.page.waitForFunction(() => document.querySelector('.toast')?.textContent?.startsWith('Sent'), null, { timeout: 10000 }).catch(() => {});
want((await toast(A)) === 'Sent “Growth is slowing” to Blake', `A: the toast says it went (${await toast(A)})`);
want(reqs.join() === 'POST', `A: one POST to the relay and no preflight (${reqs.join()}); relay saw ${(relayLog.match(/OPTIONS \/v1/g) ?? []).length} OPTIONS`);
want(!/OPTIONS \/v1/.test(relayLog), 'the relay log has no OPTIONS request');

await B.page.waitForFunction(() => document.querySelector('.toast')?.textContent?.startsWith('Card from'), null, { timeout: 15000 }).catch(() => {});
await B.page.keyboard.type('it arrives.');
const bText = await B.page.evaluate(() => window.__falconView.state.doc.textContent);
want((await toast(B)).startsWith('Card from a code not in your contacts: “Growth is slowing”'), `B: a toast says a card came (${await toast(B)})`);
want(bText === 'Typing while it arrives.', `B: typing went on uninterrupted (${bText})`);
want(await B.page.evaluate(() => !!document.activeElement?.closest('.ProseMirror')), 'B: focus stayed in the editor');
want(!!(await B.page.$('.fstrip [aria-label="Cards waiting (1)"]')), 'B: the rail shows the card is waiting');
await B.shot('b-toast-while-typing');
await wait(B, 300);
want(rowsWaiting() === 0, 'the relay deleted the card once B acked it (B stored it first)');

// ---------- B inserts it ----------
await B.page.click('.fstrip [aria-label="Cards waiting (1)"]');
await wait(B, 200);
want((await B.page.textContent('.co-card .co-what span')).includes("From a code not in your contacts, who says they're Avery"), 'B: the card shows as from an unknown code, with the name it gave');
await B.shot('b-card-waiting');
await B.page.click('.co-card button:has-text("Add contact")');
want((await B.page.inputValue('input[aria-label="Their name"]')) === 'Avery', 'B: Add contact fills in their name');
await B.page.click('.co-add button[type="submit"]');
await wait(B, 200);
want((await B.page.textContent('.co-card .co-what span')).startsWith('From Avery'), 'B: now it is from Avery');
await B.page.click('.co-card button:has-text("Insert")');
await wait(B, 300);
const mapB = await B.markMap();
want(mapB.includes(card), `B: the inserted card's styles and marks match A's exactly:\n${mapB}`);
want(!(await B.page.$('.fstrip [aria-label^="Cards waiting"]')), 'B: the rail cue is gone');
await B.shot('b-inserted');

// light theme screens
await command(B, 'theme light');
await command(B, 'card sharing');
await B.shot('b-panel-light');
await B.page.keyboard.press('Escape');

// ---------- a contact that is removed folds shut where it is, then goes ----------
await command(B, 'card sharing');
await wait(B, 200);
await B.page.hover('.co-ct');
await B.page.click('[aria-label="Remove Avery"]');
await wait(B, 120);
want(await B.page.locator('.co-fold[data-gone] .co-ct').count() === 1, 'B: the removed contact is still there, folding shut');
const mid = await B.page.$eval('.co-fold[data-gone]', (e) => e.getBoundingClientRect().height);
want(mid > 0 && mid < 36, `B: part way shut (${mid}px of 36)`);
await wait(B, 600);
want(await B.page.locator('.co-ct').count() === 0 && (await B.page.textContent('.cf.co')).includes('No one yet'), 'B: then it is gone');
want((await toast(B)) === 'Removed Avery', `B: and says so (${await toast(B)})`);
await B.shot('b-contact-removed');
await B.page.keyboard.press('Escape');

await command(A, 'theme light');
await command(A, 'send card');
await A.shot('a-send-picker-light');
await A.page.keyboard.press('Escape');

// ---------- one socket per launch: a second window waits, and takes over when the first closes ----------
const inboxB = await inboxId(parseCode(codeB).pub);
const upgrades = () => (relayLog.match(new RegExp(`GET /v1/inbox/${inboxB}`, 'g')) ?? []).length;
const before = upgrades();
want(before >= 1, `the relay log shows B's socket (${before})`);
const B2 = await B.page.context().newPage();
B2.on('pageerror', (e) => B.errors.push(e.message));
await B2.goto(FALCON);
await B2.waitForSelector('.ProseMirror');
await B2.keyboard.press('Escape');
await B2.waitForTimeout(3000);
want(upgrades() === before, `a second B window opens no socket of its own (${upgrades()} upgrades, was ${before})`);
await command({ page: B2 }, 'card sharing');
want((await B2.textContent('.co-line')) === 'Cards sent to your code arrive in another Falcon window', `the second window says the first has the socket (${await B2.textContent('.co-line')})`);
await B2.keyboard.press('Escape');
await B.page.close();
await command({ page: B2 }, 'card sharing');
want(await B2.waitForFunction(() => document.querySelector('.co-line')?.textContent?.startsWith('Connected'), null, { timeout: 15000 }).then(() => true, () => false), 'closing the first window hands the socket to the second');
want(upgrades() === before + 1, `exactly one new socket (${upgrades()} upgrades)`);
await B2.screenshot({ path: path.join(B.out, '06-b-second-window-took-over.png') });
await B2.keyboard.press('Escape');

// ---------- the relay stops ----------
stopRelay();
await wait(A, 1500);
await command(A, 'send card');
await A.page.keyboard.press('Enter');
await A.page.waitForFunction(() => !document.querySelector('.toast')?.textContent?.startsWith('Sending'), null, { timeout: 10000 }).catch(() => {});
want((await toast(A)) === "Couldn't reach the relay. Check the wifi, then send it again", `relay stopped: the send says it failed (${await toast(A)})`);
await command(A, 'card sharing');
await A.page.waitForFunction(() => /^Can't reach the relay/.test(document.querySelector('.co-line')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
want(/^Can't reach the relay: .*Trying again in/.test(await status(A)), `relay stopped: the panel says so (${await status(A)})`);
await A.shot('a-relay-stopped');
await A.page.keyboard.press('Escape');
await A.page.click('.ProseMirror:not(.hm-doc) :text("Temperatures")');
await A.page.keyboard.press('F7');
await wait(A, 100);
want((await A.markMap()).includes('tag: Temperatures rose again.'), 'relay stopped: the editor still formats (F7 made a tag)');

// ---------- no relay set ----------
const C = await openFalcon('send-card/c');
await command(C, 'card sharing');
want((await status(C)) === "No relay is set, so cards can't be sent or received yet. Add one in Settings > General > Card sharing", 'no relay: the panel says sharing is off and where to turn it on');
want(/^[0-9A-Z-]{63}$/.test((await C.page.textContent('.co-code')).trim()), 'no relay: the pairing code still shows');
await C.page.fill('input[aria-label="Their pairing code"]', codeB);
await C.page.fill('input[aria-label="Their name"]', 'Blake');
await C.page.click('.co-add button[type="submit"]');
await wait(C, 200);
want((await C.page.$$eval('.co-ct .nm', (x) => x.map((n) => n.textContent))).join() === 'Blake', 'no relay: contacts still work');
await C.shot('c-no-relay');
await C.page.keyboard.press('Escape');
await C.page.click('.ProseMirror:not(.hm-doc)');
await C.page.keyboard.press('F7');
await C.page.keyboard.type('A tag to send');
await command(C, 'send card');
want((await C.page.textContent('.co-send .co-line')) === "No relay is set, so cards can't be sent or received yet. Add one in Settings > General > Card sharing", 'no relay: the picker says so');
await C.page.keyboard.press('Enter');
await wait(C, 300);
want((await toast(C)) === "No relay is set, so cards can't be sent yet. Add one in Settings > General > Card sharing", `no relay: sending explains it (${await toast(C)})`);

for (const f of [B, C]) { if (f.errors.length) want(false, `page errors: ${f.errors.join(' | ')}`); await f.browser.close(); }
fs.rmSync(persist, { recursive: true, force: true });
await A.done();
