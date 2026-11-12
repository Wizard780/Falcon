// Send Card through real relays: Falcons in separate browser contexts (separate IndexedDB, separate
// identities), each person on a relay of their own: A on relay 1, B on relay 2, both relay/ under
// `wrangler dev`. Codes carry their owner's relay, so A adds B's code and sends a card with a
// highlight, underline and an emphasis box to B's relay; B, typing at the time, gets a toast and keeps
// typing, then inserts it and the marks match, and sends one back to A's relay. Then: B's relay
// stopped (plain message, editor fine), and a Falcon with no relay set (nobody can send to it, it can
// still send to a code that carries a relay). Needs `npm ci` in relay/ first.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openFalcon, SEED, MOD, URL as FALCON } from '../lib/falcon.mjs';

const { encodeCode, inboxId, keyOf, parseCode } = await import(new globalThis.URL('../../../../src/collab/code.ts', import.meta.url).pathname);
const { makeIdentity } = await import(new globalThis.URL('../../../../src/collab/crypto.ts', import.meta.url).pathname);

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
/** relay/ under wrangler dev on a port of its own, with its own storage: one person's relay */
async function startRelay() {
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-relay-journey-'));
  const port = 18800 + Math.floor(Math.random() * 400);
  const r = { url: `http://127.0.0.1:${port}`, persist, log: '' };
  const p = spawn('npx', ['wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persist, '--show-interactive-dev-session=false'],
    { cwd: path.join(REPO, 'relay'), env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  p.stdout.on('data', (d) => { r.log += d; });
  p.stderr.on('data', (d) => { r.log += d; });
  r.stop = () => { try { process.kill(-p.pid, 'SIGTERM'); } catch { /* gone */ } };
  process.on('exit', r.stop);
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${r.url}/x`)).status === 404) break; } catch { /* not up */ }
    if (i > 120) { console.log(r.log); throw new Error('wrangler dev never came up'); }
    await new Promise((res) => setTimeout(res, 500));
  }
  return r;
}
const R1 = await startRelay();
let R2 = await startRelay();
while (R2.url === R1.url) { R2.stop(); R2 = await startRelay(); }
const RELAY = R1.url, RELAY2 = R2.url; // A's relay, B's relay
const rowsWaiting = (persist) => {
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
/** Settings > Sharing > Relay, typed in, as a user sets it */
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

// ---------- B: relay 2, name, code ----------
await setRelay(B, RELAY2);
want((await B.page.evaluate(() => localStorage.getItem('falcon.relayUrl'))) === RELAY2, 'B: the relay typed in Settings is stored (falcon.relayUrl)');
want((await command(B, 'card sharing')) === 'Card sharing', 'B: the command center finds "Card sharing" and Enter opens it');
want(await linked(B), `B: the panel says it is connected to the relay (${await status(B)})`);
const codeB = (await B.page.textContent('.co-code')).trim();
const pb = parseCode(codeB);
want(/^[0-9A-Z]{7}(-[0-9A-Z]{1,7})+$/.test(codeB) && pb.ok && pb.relay === RELAY2, `B: shows a pairing code in groups of 7 that carries B's relay (${pb.ok && pb.relay}): ${codeB}`);
want((await B.page.textContent('.co-sec[aria-label="Your code"] .co-sub')).startsWith('Give it to whoever will send you cards. It carries your relay'), 'B: the panel says the code carries the relay');
await B.page.click('.co-me button');
await wait(B, 200);
want((await B.page.evaluate(() => navigator.clipboard.readText())) === codeB && (await toast(B)) === 'Copied your pairing code', 'B: Copy puts the code on the clipboard and says so');
await B.page.fill('#co-name', 'Blake');
await B.shot('b-panel-dark');
await B.page.keyboard.press('Escape');
await wait(B, 200);
want(!(await B.page.$('.cf.co')), 'B: Esc closes the panel');

// ---------- A: relay, recipient, a formatted card ----------
await setRelay(A, RELAY);
await command(A, 'card sharing');
await A.page.fill('#co-name', 'Avery');
await A.page.click('.cf.co .rcp-new');
await A.page.fill('input[aria-label="Their pairing code"]', codeB.toLowerCase().replace(/-/g, ' ').slice(0, -1) + 'X');
await A.page.click('.rcp-add button[type="submit"]');
await wait(A, 150);
want((await A.page.textContent('.rcp-why')) === 'That code has a typo. Copy it again', `A: a mistyped code is turned down with a clear reason (${await A.page.textContent('.rcp-why')})`);
await A.page.fill('input[aria-label="Their pairing code"]', codeB.toLowerCase().replace(/-/g, ' '));
await A.page.fill('input[aria-label="Their name"]', 'Blake');
await A.page.click('.rcp-add button[type="submit"]');
await wait(A, 200);
want((await A.page.$$eval('.rcp-row .rcp-nm', (x) => x.map((n) => n.value))).join() === 'Blake', 'A: Blake is in recipients');
await A.shot('a-recipient-added');
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
await command(A, 'card sharing');
const codeA = (await A.page.textContent('.co-code')).trim();
await A.page.keyboard.press('Escape');
await A.page.click('.ProseMirror:not(.hm-doc) :text("Smith 24")');
want(parseCode(codeA).ok && parseCode(codeA).relay === RELAY, "A's code carries A's relay, a different one from B's");

// ---------- send, while B is typing ----------
await B.page.click('.ProseMirror:not(.hm-doc)');
await B.page.keyboard.type('Typing while ');
const reqs = [];
A.page.on('request', (r) => { if (r.url().startsWith(RELAY2)) reqs.push(r.method()); });
want((await command(A, 'send card')) === 'Send Card to…', 'A: the command center finds Send Card to…');
want((await A.page.textContent('#co-st')) === 'Send “Growth is slowing” to…', 'A: the picker names the card at the caret');
await A.shot('a-send-picker');
await A.page.keyboard.press('Enter');
await A.page.waitForFunction(() => document.querySelector('.toast')?.textContent?.startsWith('Sent'), null, { timeout: 10000 }).catch(() => {});
want((await toast(A)) === 'Sent “Growth is slowing” to Blake', `A: the toast says it went (${await toast(A)})`);
want(reqs.join() === 'POST', `A: one POST to B's relay (relay 2, not A's own) and no preflight (${reqs.join()}); relay saw ${(R2.log.match(/OPTIONS \/v1/g) ?? []).length} OPTIONS`);
want(!/OPTIONS \/v1/.test(R2.log) && !/POST \/v1\/inbox/.test(R1.log), "B's relay log has no OPTIONS request, and A's relay saw no POST");

await B.page.waitForFunction(() => document.querySelector('.toast')?.textContent?.startsWith('Card from'), null, { timeout: 15000 }).catch(() => {});
await B.page.keyboard.type('it arrives.');
const bText = await B.page.evaluate(() => window.__falconView.state.doc.textContent);
want((await toast(B)).startsWith('Card from a code not in your recipients: “Growth is slowing”'), `B: a toast says a card came (${await toast(B)})`);
want(bText === 'Typing while it arrives.', `B: typing went on uninterrupted (${bText})`);
want(await B.page.evaluate(() => !!document.activeElement?.closest('.ProseMirror')), 'B: focus stayed in the editor');
want(!!(await B.page.$('.fstrip [aria-label="Cards waiting (1)"]')), 'B: the rail shows the card is waiting');
await B.shot('b-toast-while-typing');
await wait(B, 300);
want(rowsWaiting(R2.persist) === 0, "B's relay deleted the card once B acked it (B stored it first)");

// ---------- B inserts it ----------
await B.page.click('.fstrip [aria-label="Cards waiting (1)"]');
await wait(B, 200);
want((await B.page.textContent('.co-card .co-what span')).includes("From a code not in your recipients, who says they're Avery"), 'B: the card shows as from an unknown code, with the name it gave');
await B.shot('b-card-waiting');
await B.page.click('.co-card button:has-text("Add recipient")');
want((await B.page.inputValue('input[aria-label="Their name"]')) === 'Avery', 'B: Add recipient fills in their name');
const filled = parseCode(await B.page.inputValue('input[aria-label="Their pairing code"]'));
want(filled.ok && filled.relay === RELAY && keyOf(filled.code) === keyOf(codeA), "B: and A's code with A's relay (the card carried it)");
await B.page.click('.rcp-add button[type="submit"]');
await wait(B, 200);
want((await B.page.textContent('.co-card .co-what span')).startsWith('From Avery'), 'B: now it is from Avery');
await B.page.click('.co-card button:has-text("Insert")');
await wait(B, 300);
const mapB = await B.markMap();
want(mapB.includes(card), `B: the inserted card's styles and marks match A's exactly:\n${mapB}`);
want(!(await B.page.$('.fstrip [aria-label^="Cards waiting"]')), 'B: the rail cue is gone');
await B.shot('b-inserted');

// ---------- and back: B sends to A, through A's relay ----------
const backReqs = [];
B.page.on('request', (r) => { if (/\/v1\/inbox\//.test(r.url()) && r.method() === 'POST') backReqs.push(r.url().slice(0, RELAY.length)); });
await B.page.click('.ProseMirror:not(.hm-doc) :text("Global")');
want((await command(B, 'send card')) === 'Send Card to…', 'B: Send Card to…');
await B.page.keyboard.press('Enter');
await B.page.waitForFunction(() => document.querySelector('.toast')?.textContent?.startsWith('Sent'), null, { timeout: 10000 }).catch(() => {});
want((await toast(B)) === 'Sent “Growth is slowing” to Avery', `B: sent back to Avery (${await toast(B)})`);
want(backReqs.join() === RELAY, `B's card went to A's relay, relay 1 (${backReqs.join()})`);
want(await A.page.waitForFunction(() => document.querySelector('.toast')?.textContent?.startsWith('Card from'), null, { timeout: 15000 }).then(() => true, () => false), `A: the card from Blake arrives through A's own relay (${await toast(A)})`);

// light theme screens
await command(B, 'theme light');
await command(B, 'card sharing');
await B.shot('b-panel-light');
await B.page.keyboard.press('Escape');

// ---------- a recipient that is removed folds shut where it is, then goes ----------
await command(B, 'card sharing');
await wait(B, 200);
await B.page.hover('.rcp-row .rcp-cd');
await B.page.click('[aria-label="Remove Avery"]');
await wait(B, 120);
want(await B.page.locator('.co-fold[data-gone] .rcp-row').count() === 1, 'B: the removed recipient is still there, folding shut');
const mid = await B.page.$eval('.co-fold[data-gone]', (e) => e.getBoundingClientRect().height);
want(mid > 0 && mid < 36, `B: part way shut (${mid}px of 36)`);
await wait(B, 600);
want(await B.page.locator('.rcp-row').count() === 0 && (await B.page.textContent('.cf.co')).includes('No one yet'), 'B: then it is gone');
want((await toast(B)) === 'Removed Avery', `B: and says so (${await toast(B)})`);
await B.shot('b-recipient-removed');
await B.page.keyboard.press('Escape');

await command(A, 'theme light');
await command(A, 'send card');
await A.shot('a-send-picker-light');
await A.page.keyboard.press('Escape');

// ---------- one socket per launch: a second window waits, and takes over when the first closes ----------
const inboxB = await inboxId(parseCode(codeB).pub);
const upgrades = () => (R2.log.match(new RegExp(`GET /v1/inbox/${inboxB}`, 'g')) ?? []).length;
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

// ---------- B's relay stops ----------
R2.stop();
await wait(A, 1500);
await command(A, 'send card');
await A.page.keyboard.press('Enter');
await A.page.waitForFunction(() => !document.querySelector('.toast')?.textContent?.startsWith('Sending'), null, { timeout: 10000 }).catch(() => {});
want((await toast(A)) === "Couldn't reach Blake's relay. Check the wifi, then send it again", `B's relay stopped: A's send says it failed, and whose relay (${await toast(A)})`);
await command({ page: B2 }, 'card sharing');
await B2.waitForFunction(() => /^Can't reach the relay/.test(document.querySelector('.co-line')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
want(/^Can't reach the relay: .*Trying again in/.test(await B2.textContent('.co-line')), `B's relay stopped: B's panel says so (${await B2.textContent('.co-line')})`);
await B2.screenshot({ path: path.join(B.out, '07-b-relay-stopped.png') });
await B2.keyboard.press('Escape');
await command(A, 'card sharing');
want((await status(A)).startsWith('Connected'), `A's own relay is fine: A's panel still says Connected (${await status(A)})`);
await A.shot('a-their-relay-stopped');
await A.page.keyboard.press('Escape');
await A.page.click('.ProseMirror:not(.hm-doc) :text("Temperatures")');
await A.page.keyboard.press('F7');
await wait(A, 100);
want((await A.markMap()).includes('tag: Temperatures rose again.'), 'a relay stopped: the editor still formats (F7 made a tag)');

// ---------- no relay set ----------
const NO_RELAY = 'No relay is set, so nobody can send you cards yet, and yours go only to recipients whose code carries their relay. Add one in Settings > Sharing';
const C = await openFalcon('send-card/c');
await command(C, 'card sharing');
want((await status(C)) === NO_RELAY, 'no relay: the panel says nobody can send here yet, and where to set one');
const codeC = (await C.page.textContent('.co-code')).trim();
want(/^[0-9A-Z-]{63}$/.test(codeC) && parseCode(codeC).ok && parseCode(codeC).relay === null, 'no relay: the pairing code still shows, a v1 code with no relay in it');
want((await C.page.textContent('.co-sec[aria-label="Your code"] .co-sub')).startsWith('Nobody can send you cards until you set a relay'), 'no relay: under the code it says nobody can send to it yet');
const v1 = encodeCode((await makeIdentity()).pub);
for (const [code, name] of [[codeA, 'Avery'], [v1, 'Old Code']]) {
  await C.page.click('.cf.co .rcp-new');
  await C.page.fill('input[aria-label="Their pairing code"]', code);
  await C.page.fill('input[aria-label="Their name"]', name);
  await C.page.click('.rcp-add button[type="submit"]');
  await wait(C, 200);
}
want((await C.page.$$eval('.rcp-row .rcp-nm', (x) => x.map((n) => n.value))).join() === 'Avery,Old Code', 'no relay: recipients still work, a v2 code and a v1 one');
await C.shot('c-no-relay');
await C.page.keyboard.press('Escape');
await C.page.click('.ProseMirror:not(.hm-doc)');
await C.page.keyboard.press('F7');
await C.page.keyboard.type('A tag to send');
await command(C, 'send card');
want((await C.page.textContent('.co-send .co-line')) === NO_RELAY, 'no relay: the picker says so');
await C.page.keyboard.press('Enter'); // Avery: their code carries their relay
await C.page.waitForFunction(() => /^Sent|^Couldn/.test(document.querySelector('.toast')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
want((await toast(C)) === 'Sent “A tag to send” to Avery', `no relay of its own: C can still send to Avery, through Avery's relay (${await toast(C)})`);
want(await A.page.waitForFunction(() => /^Card from a code not in your recipients: “A tag to send”/.test(document.querySelector('.toast')?.textContent ?? ''), null, { timeout: 15000 }).then(() => true, () => false), `A: C's card arrives (${await toast(A)})`);
await command(C, 'send card');
await C.page.keyboard.press('ArrowDown');
await C.page.keyboard.press('Enter'); // Old Code: a v1 code, and C has no relay
await wait(C, 300);
want((await toast(C)) === "No relay is set, so cards can't be sent yet. Add one in Settings > Sharing", `no relay, and a v1 code with none: sending explains it (${await toast(C)})`);

for (const f of [B, C]) { if (f.errors.length) want(false, `page errors: ${f.errors.join(' | ')}`); await f.browser.close(); }
await A.done();
for (const r of [R1, R2]) { r.stop(); fs.rmSync(r.persist, { recursive: true, force: true }); }
process.exit(process.exitCode ?? 0);
