// The rail's Sharing button and how an invite or a card is announced, through a real relay (relay/ under
// `wrangler dev`). A is not in B's recipients: a stranger to B. A invites B to live-edit while B has Card sharing
// open: the toast draws over the dialog and says, as the panel does, that a code not in B's recipients who says
// they're Avery invited B. The rail's paper-plane Sharing button (directly above the update button) counts it
// and opens Live editing; Join clears the count. A second invite, dismissed, clears it too. A card waiting counts
// and opens Card sharing. B is dark, then light. Needs `npm ci` in relay/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openFalcon, SEED, MOD } from '../lib/falcon.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
setTimeout(() => { console.log('FAIL timed out'); process.exit(1); }, 300_000).unref();

const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-sharing-rail-'));
const port = 18700 + Math.floor(Math.random() * 90);
const relay = spawn('npx', ['wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persist, '--show-interactive-dev-session=false'],
  { cwd: path.join(REPO, 'relay'), env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: 'ignore', detached: true });
const stopRelay = () => { try { process.kill(-relay.pid, 'SIGTERM'); } catch { /* gone */ } };
process.on('exit', stopRelay);
const RELAY = `http://127.0.0.1:${port}`;
for (let i = 0; ; i++) {
  try { if ((await fetch(`${RELAY}/x`)).status === 404) break; } catch { /* not up */ }
  if (i > 120) throw new Error('wrangler dev never came up');
  await new Promise((r) => setTimeout(r, 500));
}

const A = await openFalcon('sharing-rail/a');
const B = await openFalcon('sharing-rail');
const want = B.want;
const wait = (f, ms) => f.page.waitForTimeout(ms);
const command = async (f, text) => {
  await f.page.keyboard.press(`${MOD}+Shift+Space`);
  await f.page.waitForSelector('.cc input');
  await f.page.fill('.cc input', text);
  await wait(f, 150);
  await f.page.keyboard.press('Enter');
  await wait(f, 300);
};
async function setRelay(f) {
  await f.page.click('.fstrip [aria-label="Settings"]');
  await f.page.fill('[aria-label="Search settings"]', 'relay');
  await wait(f, 200);
  await f.page.fill('input[aria-label="Relay address"]', RELAY);
  await f.page.press('input[aria-label="Relay address"]', 'Enter');
  await wait(f, 100);
  await f.page.keyboard.press('Escape'); await f.page.keyboard.press('Escape');
  await wait(f, 300);
}
async function identity(f, name) {
  await command(f, 'card sharing');
  await f.page.fill('#co-name', name);
  await f.page.waitForFunction(() => document.querySelector('.co-line')?.textContent?.startsWith('Connected'), null, { timeout: 15000 }).catch(() => {});
  const code = (await f.page.textContent('.co-code')).trim();
  await f.page.keyboard.press('Escape');
  await wait(f, 200);
  return code;
}
const until = (f, fn, arg, ms = 15000) => f.page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
/** The toast's text, and whether it is what you'd see at its spot (drawn over any backdrop). */
const toastOnTop = (f) => f.page.evaluate(() => {
  const t = document.querySelector('.toast.show'); if (!t) return { text: '', onTop: false };
  const r = t.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { text: t.textContent, onTop: !!top && t.contains(top) };
});
/** The Sharing dialog doesn't scroll sideways: nothing in it is wider than it is. */
const flat = async (f) => { const [sw, cw] = await f.page.$eval('.cf.co', (d) => [d.scrollWidth, d.clientWidth]); return { ok: sw <= cw, why: `scrollWidth ${sw}, clientWidth ${cw}` }; };
/** The Sharing dialog's lit tab. */
const tabOn = (f) => f.page.textContent('.sh-sw [aria-selected="true"]').catch(() => '');
const rail = (f) => f.page.$$eval('.fstrip > .fs-b', (bs) => bs.map((b) => b.getAttribute('aria-label')));
/** A crop of the rail's lower end, where Sharing sits. */
const railShot = async (f, name) => {
  await f.page.mouse.move(700, 450); await wait(f, 300); // no tooltip over the rail
  const box = await f.page.$eval('.fstrip [aria-label^="Sharing"]', (b) => { const r = b.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top - 60), width: 260, height: 160 }; });
  await f.page.screenshot({ path: path.join(f.out, `${name}.png`), clip: box });
};

try {
  await setRelay(A); await setRelay(B);
  await identity(A, 'Avery');
  const codeB = await identity(B, 'Blake');
  // A has B as a recipient; B never added A
  await command(A, 'card sharing');
  await A.page.click('.cf.co .rcp-new');
  await A.page.fill('input[aria-label="Their pairing code"]', codeB);
  await A.page.fill('input[aria-label="Their name"]', 'Blake');
  await A.page.click('.rcp-add button[type="submit"]');
  await A.page.waitForSelector('.cf.co .rcp-new');
  await A.page.keyboard.press('Escape');
  await A.open(SEED);
  await command(A, 'start live editing');
  await A.page.waitForSelector('.co-live section[aria-label="Invite"]');

  // nothing waiting: Sharing is on the rail, the paper plane, just above the bottom buttons (the web build has no update button: Settings is next)
  const r0 = await rail(B);
  want(r0.slice(-2).join(' | ') === 'Sharing | Settings', `B: Sharing is on the rail with nothing waiting, last before Settings (${r0.join(' | ')})`);
  await railShot(B, '01-rail-nothing-waiting-dark');

  // ---------- an invite from a stranger, while Card sharing is open ----------
  await command(B, 'card sharing');
  await A.page.click('.co-live section[aria-label="Invite"] .co-ct:has-text("Blake") button');
  want(await until(B, () => document.querySelector('.toast.show')?.textContent?.includes('invited you')), 'B: the invite arrives as a toast');
  const t = await toastOnTop(B);
  want(t.text.startsWith("A code not in your recipients, who says they're Avery, invited you to live-edit “seed”"), `B: it says who, as the panel does (${t.text})`);
  want(t.onTop, 'B: the toast draws over the Card sharing dialog, not under its backdrop');
  await A.page.keyboard.press('Escape'); // A's Live editing panel
  await B.shot('invite-toast-over-card-sharing');
  // Join on the toast with Card sharing still open: what's open comes first, and it says where the invite waits
  await B.page.click('.toast button:has-text("Join")');
  want(await until(B, () => document.querySelector('.toast.show')?.textContent?.startsWith("Close what's open first")), `B: Join over an open dialog says to close it first (${(await toastOnTop(B)).text})`);
  want(await B.page.isVisible('.cf.co') && !(await B.page.$('.who')), 'B: Card sharing is still up, and nothing was joined under it');
  // Live is one click away in the same dialog: the switch under the title
  want((await tabOn(B)) === 'Cards', `B: the dialog is on Cards (${await tabOn(B)})`);
  await B.page.click('.sh-sw [role="tab"]:has-text("Live")');
  await wait(B, 300);
  want((await tabOn(B)) === 'Live' && await B.page.isVisible('.cf.co-live section[aria-label="Invites"]'), `B: Live on the switch shows live editing in the same dialog (${await tabOn(B)})`);
  want((await B.page.textContent('.co-live section[aria-label="Invites"] .lv-inv')).includes("From a code not in your recipients, who says they're Avery"), 'B: the invite is listed on Live');
  want(await B.page.evaluate(() => document.activeElement?.getAttribute('role') === 'tab'), 'B: focus stays on the switch');
  { const s = await flat(B); want(s.ok, `B: the Live tab has no sideways scrollbar (${s.why})`); }
  await B.shot('sharing-live-tab');
  await B.page.keyboard.press('ArrowLeft');
  await wait(B, 300);
  want((await tabOn(B)) === 'Cards' && await B.page.isVisible('.co-code'), `B: Left arrow on the switch goes back to Cards (${await tabOn(B)})`);
  await B.page.keyboard.press('Escape');
  await wait(B, 7000); // the toast is gone; the count stays
  want(!(await B.page.$('.toast.show')), `B: the toast has gone by now (${await B.page.textContent('.toast').catch(() => '')})`);
  want((await B.page.textContent('.fstrip [aria-label="Sharing, 1 invite waiting"] .share-n').catch(() => '')) === '1', "B: the rail's Sharing button still counts the invite");
  await railShot(B, '02-rail-invite-waiting-dark');
  await B.shot('invite-waiting');

  // only an invite waits: Sharing opens Live editing; Join there clears the count
  await B.page.click('.fstrip [aria-label="Sharing, 1 invite waiting"]');
  want(await B.page.isVisible('.cf.co-live') && (await tabOn(B)) === 'Live', `B: Sharing opens on Live when only invites wait (${await tabOn(B)})`);
  want((await B.page.textContent('.co-live section[aria-label="Invites"] .lv-inv')).includes("From a code not in your recipients, who says they're Avery"), 'B: the invite is listed there');
  await B.shot('live-panel-invite');
  await B.page.click('.co-live section[aria-label="Invites"] button:has-text("Join")');
  want(await until(B, () => !!document.querySelector('.who')), 'B: Join opens the doc, live');
  want(await until(B, () => !!document.querySelector('.fstrip [aria-label="Sharing"]') && !document.querySelector('.fstrip .share-n')), 'B: joined, the count is gone');
  want((await B.page.textContent('.co-live section[aria-label="Invites"] .lv-inv button')).trim() === 'In it', 'B: the joined invite stays listed (In it)');
  await B.shot('joined');
  await B.page.keyboard.press('Escape');
  // A presses Invite again for the room B is in: nothing to join, so no toast and no count
  const storedInvites = () => B.page.evaluate(() => new Promise((r) => { const q = indexedDB.open('falcon-collab'); q.onsuccess = () => { const g = q.result.transaction('meta').objectStore('meta').get('invites'); g.onsuccess = () => { r((g.result ?? []).map((i) => `${i.id}:${!!i.joined}`)); q.result.close(); }; }; }));
  const before = await storedInvites();
  await A.page.click('.who'); await A.page.click('.lv-pop button:has-text("Invite…")');
  await A.page.click('.co-live section[aria-label="Invite"] .co-ct:has-text("Blake") button');
  await A.page.waitForFunction(() => document.querySelector('.toast')?.textContent?.startsWith('Invited Blake'), null, { timeout: 15000 });
  await A.page.keyboard.press('Escape');
  const again = await until(B, () => document.querySelector('.toast.show')?.textContent?.includes('invited you') || !!document.querySelector(".fstrip .share-n"), null, 8000);
  const after = await storedInvites();
  want(!again && after.length === 1 && after[0] !== before[0] && after[0].endsWith(':true'), `B: invited again to the room B is in: it arrived (${before} -> ${after}), marked joined, no toast, no count`);

  // ---------- a second invite, dismissed ----------
  await A.page.click('.who'); await A.page.click('.lv-pop button:has-text("Invite…")');
  await A.page.click('.co-live button:has-text("Leave the session")');
  await A.page.click('.co-live button:has-text("Start live editing")');
  await A.page.waitForSelector('.co-live section[aria-label="Invite"]');
  await A.page.click('.co-live section[aria-label="Invite"] .co-ct:has-text("Blake") button');
  await A.page.keyboard.press('Escape');
  want(await until(B, () => !!document.querySelector('.fstrip [aria-label="Sharing, 1 invite waiting"]')), 'B: a new invite counts again');
  await command(B, 'live editing');
  want((await tabOn(B)) === 'Live', `B: the command center's Live editing opens Sharing on Live (${await tabOn(B)})`);
  const row = B.page.locator('.co-live .lv-inv', { hasText: 'Join' }).first();
  await row.locator('button:has-text("Dismiss")').click();
  want(await until(B, () => !document.querySelector('.fstrip .share-n')), 'B: Dismiss clears the count');
  await B.page.keyboard.press('Escape');

  // ---------- a card waiting ----------
  await B.page.click('.ProseMirror:not(.hm-doc)');
  await A.select('Growth');
  await command(A, 'send card');
  await A.page.keyboard.press('Enter');
  want(await until(B, () => !!document.querySelector('.fstrip [aria-label="Sharing, 1 card waiting"] .share-n')), 'B: a card waiting counts on Sharing');
  await B.page.click('.fstrip [aria-label="Sharing, 1 card waiting"]');
  want(await B.page.isVisible('.cf.co:not(.co-live)') && (await tabOn(B)) === 'Cards', `B: with a card waiting, Sharing opens on Cards (${await tabOn(B)})`);
  await B.page.keyboard.press('Escape');
  await wait(B, 300);
  await railShot(B, '03-rail-card-waiting-dark');
  // the rail made wide, and a reload: the card still waits, the button names it
  await B.page.evaluate(() => { localStorage.setItem('falcon.railResize', 'on'); localStorage.setItem('falcon.rail', '200'); });
  await B.page.reload(); await B.page.waitForSelector('.ProseMirror'); await B.page.keyboard.press('Escape'); await wait(B, 500);
  want(await until(B, () => document.querySelector('.fstrip[data-wide] [aria-label="Sharing, 1 card waiting"] .lbl')?.checkVisibility() && document.querySelector('.fstrip [aria-label="Sharing, 1 card waiting"] .lbl').textContent === '1 card waiting'), 'B: after a reload, in the wide rail: "1 card waiting" with its count');
  await railShot(B, '03b-rail-wide-card-waiting-dark');
  await B.page.evaluate(() => localStorage.setItem('falcon.railResize', 'off'));
  await B.page.reload(); await B.page.waitForSelector('.ProseMirror'); await B.page.keyboard.press('Escape'); await wait(B, 500);

  // ---------- light ----------
  await B.page.click('.fstrip [aria-label="Settings"]');
  await B.page.click('[aria-label="Settings sections"] button:has-text("Appearance")');
  await B.page.click('[aria-label="Theme"] [role=radio][aria-label="Light"]');
  await B.page.keyboard.press('Escape');
  await wait(B, 400);
  want(await B.page.evaluate(() => localStorage.getItem('falcon.theme')) === 'light', 'B: switched to the light theme');
  await railShot(B, '04-rail-card-waiting-light');
  await B.shot('card-waiting-light');
  await B.page.click('.fstrip [aria-label="Sharing, 1 card waiting"]');
  await B.page.click('.co-card button:has-text("Dismiss")');
  await B.page.keyboard.press('Escape');
  want(await until(B, () => !document.querySelector('.fstrip .share-n')), 'B: dismissing the card clears the count');
  await railShot(B, '05-rail-nothing-waiting-light');
} catch (e) {
  want(false, `threw: ${e.stack.split('\n').slice(0, 3).join(' ')}`);
  await A.shot('threw-a'); await B.shot('threw-b');
}
await A.done();
await B.done();
stopRelay();
fs.rmSync(persist, { recursive: true, force: true });
