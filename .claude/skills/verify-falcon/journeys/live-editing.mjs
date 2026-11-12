// Live editing through real relays: three Falcons (separate browsers, so separate identities), each on a relay of
// their own choosing: A and C on relay 1, B on relay 2, all relay/ under `wrangler dev`. A starts a session on the seed
// doc from Settings > Sharing (the room is on A's relay) and invites B through B's inbox on relay 2; B joins from the
// toast, and its room socket goes to relay 1, which the invite named. Both type and format at once and converge, see each other's carets, and send no more frames than
// the free-plan maths allows. The relay restarts mid-session (both keep editing, then catch up), C joins late and gets
// everything, B leaves and keeps the doc, B's and A's .docx saves reopen with the same mark maps. Last, a Falcon on a
// relay deployed before rooms says to redeploy. Needs `npm ci` in relay/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openFalcon, SEED, MOD } from '../lib/falcon.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
setTimeout(() => { console.log('FAIL timed out'); process.exit(1); }, 600_000).unref();

/** wrangler dev on `dir` (relay/ or a copy of an older one), on a port of its own. */
async function startRelay(dir, port, persist, config) {
  let log = '';
  const p = spawn('npx', ['wrangler', 'dev', ...(config ? ['--config', config] : []), '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persist, '--show-interactive-dev-session=false'],
    { cwd: dir, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  p.stdout.on('data', (d) => { log += d; });
  p.stderr.on('data', (d) => { log += d; });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${url}/x`)).status === 404) break; } catch { /* not up */ }
    if (i > 120) { console.log(log); throw new Error('wrangler dev never came up'); }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { url, stop: () => { try { process.kill(-p.pid, 'SIGTERM'); } catch { /* gone */ } }, log: () => log };
}
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-live-journey-'));
const port = 18400 + Math.floor(Math.random() * 300);
let relay = await startRelay(path.join(REPO, 'relay'), port, persist);
const relay2 = await startRelay(path.join(REPO, 'relay'), port + 1000, fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-live-journey-2-')));
const RELAY = relay.url, RELAY2 = relay2.url; // A's and C's relay (the room's), B's relay
const stoppers = [() => relay.stop(), () => relay2.stop()];
process.on('exit', () => { for (const s of stoppers) s(); });

const A = await openFalcon('live-editing');
const B = await openFalcon('live-editing/b');
const C = await openFalcon('live-editing/c');
const want = A.want;
const wait = (f, ms) => f.page.waitForTimeout(ms);
const toast = async (f) => ((await f.page.textContent('.toast').catch(() => '')) ?? '').trim();
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
async function setRelay(f, url) {
  await f.page.click('.fstrip [aria-label="Settings"]');
  await f.page.fill('[aria-label="Search settings"]', 'relay');
  await wait(f, 200);
  await f.page.fill('input[aria-label="Relay address"]', url);
  await f.page.press('input[aria-label="Relay address"]', 'Enter');
  await wait(f, 100);
  await f.page.keyboard.press('Escape');
  await f.page.keyboard.press('Escape');
  await wait(f, 300);
}
/** Name, and this Falcon's pairing code (Card sharing panel). */
async function identity(f, name) {
  await command(f, 'card sharing');
  await f.page.fill('#co-name', name);
  await f.page.waitForFunction(() => document.querySelector('.co-line')?.textContent?.startsWith('Connected'), null, { timeout: 15000 }).catch(() => {});
  const code = (await f.page.textContent('.co-code')).trim();
  await f.page.keyboard.press('Escape');
  await wait(f, 200);
  return code;
}
async function addContact(f, code, name) {
  await command(f, 'card sharing');
  await f.page.fill('input[aria-label="Their pairing code"]', code);
  await f.page.fill('input[aria-label="Their name"]', name);
  await f.page.click('.co-add button[type="submit"]');
  await wait(f, 200);
  await f.page.keyboard.press('Escape');
  await wait(f, 200);
}
const until = (f, fn, arg, ms = 15000) => f.page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
const map = (f) => f.markMap();
const sameMaps = async (...fs) => { const m = await Promise.all(fs.map(map)); return m.every((x) => x === m[0]); };
async function converge(fs, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await sameMaps(...fs)) return true; await wait(fs[0], 200); }
  return false;
}
/** Frames each page sends to the relay's rooms (WebSocket frames out), counted from now. */
function frames(f) {
  const n = { sent: 0 };
  f.page.on('websocket', (ws) => { if (ws.url().includes('/v1/room/')) ws.on('framesent', () => { n.sent++; }); });
  return n;
}
const fa = frames(A), fb = frames(B), fc = frames(C);
/** The caret just before `text` (a headless page has no OS focus, so this is set the way f.select sets a selection). */
const caret = (f, text) => f.page.evaluate((text) => {
  const v = window.__falconView; let at = -1;
  v.state.doc.descendants((n, pos) => { if (at < 0 && n.isTextblock) { const i = n.textContent.indexOf(text); if (i >= 0) at = pos + 1 + i; } return at < 0; });
  if (at < 0) throw new Error(`text not in doc: ${text}`);
  const S = v.state.selection.constructor.near(v.state.doc.resolve(at)).constructor; v.dispatch(v.state.tr.setSelection(S.create(v.state.doc, at))); v.focus();
}, text);
const typeSlowly = async (f, text, gap) => { for (const ch of text) { await f.page.keyboard.type(ch); await wait(f, gap); } };

const extra = [];
try {
// ---------- setup: relay, names, codes, contacts ----------
await setRelay(A, RELAY);
await setRelay(B, RELAY2);
await setRelay(C, RELAY);
const bRoomSockets = [], invitePosts = [];
B.page.on('websocket', (ws) => { if (ws.url().includes('/v1/room/')) bRoomSockets.push(ws.url()); });
A.page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/v1/inbox/')) invitePosts.push(r.url()); });
const codeA = await identity(A, 'Avery'), codeB = await identity(B, 'Blake'), codeC = await identity(C, 'Casey');
await addContact(A, codeB, 'Blake');
await addContact(A, codeC, 'Casey');
await addContact(B, codeA, 'Avery');
await addContact(C, codeA, 'Avery');
await A.open(SEED);
const seedMap = await map(A);

// ---------- A starts a session from Settings > Sharing ----------
await A.page.click('.fstrip [aria-label="Settings"]');
await A.page.click('[aria-label="Settings sections"] button:has-text("Sharing")');
await wait(A, 200);
want(await A.page.isVisible('.st-row:has-text("This document") button:has-text("Start live editing")'), 'Settings > Sharing has Live editing: This document, Start live editing');
await A.shot('settings-sharing-before');
await A.page.click('.st-row:has-text("This document") button:has-text("Start live editing")');
want(await until(A, () => document.querySelector('.co-live .co-line')?.textContent?.startsWith('Live.')), `A: the Live editing panel opens and says it's live (${await A.page.textContent('.co-live .co-line').catch(() => '')})`);
want((await A.page.$$eval('.lv-who .nm', (x) => x.map((n) => n.textContent))).join() === 'You (Avery)', 'A: in the session: just you');
await A.shot('a-panel-started');

// ---------- A invites B; B joins from the toast ----------
await A.page.click('.co-live section[aria-label="Invite"] .co-ct:has-text("Blake") button');
want(await until(A, () => document.querySelector('.toast')?.textContent?.startsWith('Invited Blake')), `A: the toast says the invite went (${await toast(A)})`);
want(invitePosts.length === 1 && invitePosts[0].startsWith(`${RELAY2}/`), `A: the invite went to B's relay, relay 2 (${invitePosts.join()})`);
await A.page.keyboard.press('Escape');
await wait(A, 200);
await A.page.keyboard.press('Escape'); // Settings
await wait(A, 200);
want(/^Live · just you$/.test((await A.page.textContent('.status .lv-bit').catch(() => '')) ?? ''), `A: the status bar says Live · just you (${await A.page.textContent('.status .lv-bit').catch(() => '')})`);

want(await until(B, () => document.querySelector('.toast')?.textContent?.includes('invited you to live-edit')), `B: a toast says Avery invited B (${await toast(B)})`);
want((await toast(B)).startsWith('Avery invited you to live-edit “seed”'), 'B: it names who and which doc');
want(!(await B.page.$('.fstrip [aria-label^="Cards waiting"]')), "B: an invite isn't a card waiting");
await B.shot('b-invite-toast');
await B.page.click('.toast button:has-text("Join")');
want(await until(B, () => document.querySelector('.doc-row .doc-nm[aria-label="seed"]') && document.querySelector('.status .lv-bit')?.textContent?.startsWith('Live')), 'B: joining opens "seed" in a tab, live');
want((await map(B)) === seedMap, 'B: the doc that came in is A\'s, every style and mark');
want(bRoomSockets.length >= 1 && bRoomSockets.every((u) => u.startsWith(RELAY.replace('http', 'ws'))), `B: the room is on A's relay, which the invite named, not B's own (${bRoomSockets.join()})`);
want(await until(A, () => document.querySelector('.status .lv-bit')?.textContent === 'Live · Blake'), `A: the status bar says Live · Blake (${await A.page.textContent('.status .lv-bit').catch(() => '')})`);
want(await until(B, () => document.querySelector('.status .lv-bit')?.textContent === 'Live · Avery'), 'B: the status bar says Live · Avery');

// ---------- both type and format at once ----------
await A.select('Growth'); await A.page.keyboard.press('F11');
await B.select('next year'); await B.page.keyboard.press('F10');
await caret(A, "Temperatures");
await caret(B, "Smith 24");
await Promise.all([A.page.keyboard.type('AAA '), B.page.keyboard.type('BBB ')]);
await A.select('Temperatures'); await A.page.keyboard.press('F9');
want(await converge([A, B]), 'typing and F-keys on both sides at once: the mark maps converge');
const both = await map(A);
fs.writeFileSync(path.join(A.out, 'converged.markmap.txt'), both + '\n');
want(both.includes('{highlight:yellow}') && both.includes('{emphasis}') && /AAA/.test(both) && /BBB/.test(both) && both.includes('[Temperatures]{underline}'), `both sides' typing and marks are there:\n${both}`);
want(await until(B, () => !!document.querySelector('.ProseMirror .f-peer')), "B: Avery's caret shows in B's doc");
const peer = await B.page.$eval('.ProseMirror .f-peer', (e) => ({ title: e.getAttribute('title'), color: getComputedStyle(e).borderLeftColor }));
want(peer.title === 'Avery' && peer.color !== 'rgba(0, 0, 0, 0)', `B: it's a bar in Avery's color, named on hover (${JSON.stringify(peer)})`);
await B.shot('b-converged-with-caret');
await A.shot('a-converged');

// ---------- frames: within the free-plan maths ----------
await wait(A, 1500);
const a0 = fa.sent, b0 = fb.sent, t0 = Date.now();
await caret(A, "Global");
await typeSlowly(A, 'steady typing here ', 100);
const secs = (Date.now() - t0) / 1000;
await wait(A, 800);
const aFrames = fa.sent - a0, bFrames = fb.sent - b0;
want(aFrames <= Math.ceil(secs / 0.4) + 2 && aFrames >= 2, `A typed for ${secs.toFixed(1)} s and sent ${aFrames} frames (at most one per 400 ms)`);
want(bFrames === 0, `B, idle, sent ${bFrames} frames meanwhile`);
want(await converge([A, B]), 'B has the steady typing');

// ---------- the relay restarts: both keep editing, then catch up ----------
relay.stop();
await wait(A, 1500);
want(await until(A, () => /reconnecting/.test(document.querySelector('.status .lv-bit')?.textContent ?? ''), null, 10000), `relay down: A's status bar says reconnecting (${await A.page.textContent('.status .lv-bit').catch(() => '')})`);
await caret(A, "Temperatures");
await A.page.keyboard.type('down-A ');
await caret(B, "Smith 24");
await B.page.keyboard.type('down-B ');
want((await map(A)).includes('down-A') && !(await map(A)).includes('down-B'), 'relay down: A edits on its own');
await command(A, 'live editing');
await A.shot('a-relay-down');
want(/^Can't reach the relay\. Your edits stay here/.test(await A.page.textContent('.co-live .co-line')), `relay down: the panel says edits stay here (${await A.page.textContent('.co-live .co-line')})`);
await A.page.keyboard.press('Escape');
relay = await startRelay(path.join(REPO, 'relay'), port, persist);
stoppers.push(() => relay.stop());
want(await converge([A, B], 45000), 'relay back: each side gets what the other typed while it was down');
const back = await map(A);
want(back.includes('down-A') && back.includes('down-B'), 'both offline edits are there');

// ---------- C joins late ----------
await command(A, 'live editing');
await A.page.click('.co-live section[aria-label="Invite"] .co-ct:has-text("Casey") button');
await wait(A, 500);
await A.page.keyboard.press('Escape');
want(await until(C, () => document.querySelector('.toast')?.textContent?.includes('invited you to live-edit')), 'C: the invite arrives');
await command(C, 'live editing');
await C.shot('c-invites-in-panel');
await C.page.click('.co-live section[aria-label="Invites"] button:has-text("Join")');
await C.page.keyboard.press('Escape').catch(() => {});
want(await until(C, () => document.querySelector('.status .lv-bit')?.textContent?.startsWith('Live')), 'C: joins from the panel');
want(await converge([A, B, C]), 'C, joining late, has everything: all three mark maps match');
want(await until(A, () => document.querySelector('.status .lv-bit')?.textContent === 'Live · Blake and Casey'), `A: Live · Blake and Casey (${await A.page.textContent('.status .lv-bit').catch(() => '')})`);
await caret(C, "Global");
await C.page.keyboard.type('from C ');
want(await converge([A, B, C]), "C's typing reaches A and B");
await command(A, 'live editing');
want((await A.page.$$eval('.lv-who .nm', (x) => x.map((n) => n.textContent))).join() === 'You (Avery),Blake,Casey', 'A: the panel lists everyone in it');
await A.shot('a-panel-three');
await A.page.keyboard.press('Escape');
await command(A, 'theme light');
await command(A, 'live editing');
await A.shot('a-panel-three-light');
await A.page.keyboard.press('Escape');
await command(A, 'theme dark');

// ---------- A saves mid-session; the .docx reopens the same ----------
const midA = await map(A);
const savedA = await A.save('a-live.docx');
const D = await openFalcon('live-editing/d'); extra.push(D);
await D.open(savedA);
want((await map(D)) === midA, "A's .docx saved during the session reopens with the same mark map");

// ---------- B puts the live doc away (another tab) and sends to speech into it; A types meanwhile ----------
await B.page.click('.tools [aria-label="Speech doc"]'); // the live doc is B's speech doc
await wait(B, 300);
await B.page.keyboard.press(`${MOD}+n`); // a new Untitled tab: the live doc goes out of the editor
await wait(B, 400);
want((await B.page.$eval('.doc-row[data-on] .doc-nm', (e) => e.getAttribute('aria-label')).catch(() => '')) === 'Untitled', 'B: a new tab is showing; the live doc is put away');
await caret(A, 'Temperatures');
await A.page.keyboard.type('while B looks away ');
await B.page.click('.ProseMirror:not(.hm-doc)');
await B.page.keyboard.press('F7');
await B.page.keyboard.type('Sent from Blake');
await B.page.keyboard.press('`');
want(await until(B, () => /^Sent “Sent from Blake”/.test(document.querySelector('.toast')?.textContent ?? '')), `B: Send to speech into the put-away live doc says sent (${await toast(B)})`);
want(await until(A, () => window.__falconMarkMap().includes('tag: Sent from Blake')), 'A: the card B sent to speech arrives: it went into the live doc, not nowhere');
await B.page.click('.doc-row .doc-nm[aria-label="seed (speech doc)"], .doc-row .doc-nm[aria-label="seed"]');
await wait(B, 500);
const backB = await map(B);
want(backB.includes('while B looks away') && backB.includes('tag: Sent from Blake'), "B: back on the live tab, A's typing and B's sent card are both there");
want(await converge([A, B, C]), 'and all three agree');
await B.shot('b-back-from-another-tab');

// ---------- B leaves ----------
want((await command(B, 'leave live editing')) === 'Leave live editing', 'B: the command center has Leave live editing');
want(await until(B, () => !document.querySelector('.status .lv-bit')), "B: the status bar's live line is gone");
want((await toast(B)).startsWith('Left the live session. “seed” stays open as it is'), `B: says it left and the doc stays (${await toast(B)})`);
want(await until(A, () => document.querySelector('.status .lv-bit')?.textContent === 'Live · Casey'), 'A: Blake is out of the session');
const kept = await map(B);
await caret(A, "Temperatures");
await A.page.keyboard.type('after B left ');
want(await until(C, () => window.__falconMarkMap().includes('after B left')), 'C still gets A\'s edits');
await wait(B, 1500);
want((await map(B)) === kept, "B's doc stays as it was when B left, and no more edits arrive");
await caret(B, "Global");
await B.page.keyboard.type('mine alone ');
await B.page.keyboard.press(`${MOD}+z`);
want((await map(B)) === kept, 'B: Mod-Z after leaving undoes B\'s own typing (history is back)');
await B.page.keyboard.type('mine alone ');
const finalB = await map(B);
// B's doc came from the session, so it's in no file here: Mod-S asks for a name
const [dl] = await Promise.all([B.page.waitForEvent('download'), (async () => { await B.page.keyboard.press(`${MOD}+s`); await wait(B, 400); if (await B.page.$('.sa')) await B.page.keyboard.press('Enter'); })()]);
const savedB = path.join(B.out, 'b-after-leaving.docx');
await dl.saveAs(savedB);
const E = await openFalcon('live-editing/e'); extra.push(E);
await E.open(savedB);
want((await map(E)) === finalB, "B's .docx saved after leaving reopens with the same mark map");
await B.shot('b-after-leaving');

// ---------- a relay from before rooms ----------
// the stand-in answers 404 to everything, as a relay deployed before rooms does for /v1/rooms and /v1/room/:id
const oldRelay = await startRelay(path.join(REPO, 'relay'), port + 300, fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-old-persist-')),
  path.join(REPO, '.claude/skills/verify-falcon/fixtures/old-relay/wrangler.jsonc'));
stoppers.push(() => oldRelay.stop());
const F = await openFalcon('live-editing/old-relay'); extra.push(F);
await setRelay(F, oldRelay.url);
await command(F, 'start live editing');
want(await until(F, () => /from before live editing/.test(document.querySelector('.co-live .co-line')?.textContent ?? '')), `old relay: the panel says to redeploy (${await F.page.textContent('.co-live .co-line').catch(() => '')})`);
want((await F.page.textContent('.co-live .co-line')).includes('npx wrangler deploy'), 'and names npx wrangler deploy');
await F.shot('old-relay');
await F.page.keyboard.press('Escape');
await F.page.click('.ProseMirror:not(.hm-doc)');
await F.page.keyboard.press('F7');
await F.page.keyboard.type('Still a tag');
want((await map(F)).includes('tag: Still a tag'), 'old relay: the editor works as ever');

} catch (e) {
  want(false, `the journey stopped: ${String(e.message).split('\n')[0]}`);
  for (const f of [A, B, C]) { await f.shot('stopped').catch(() => {}); fs.writeFileSync(path.join(f.out, 'stopped.markmap.txt'), (await f.markMap().catch(() => '')) + '\n'); }
}
for (const f of [B, C, ...extra]) { if (f.errors.length) want(false, `page errors (${f.out}): ${f.errors.join(' | ')}`); await f.browser.close(); }
fs.rmSync(persist, { recursive: true, force: true });
await A.done();
for (const stop of stoppers) stop();
process.exit(process.exitCode ?? 0);
