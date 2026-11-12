// Set up my relay in the Electron app (no visible window): Settings > Sharing > ?, the four steps, then Falcon puts the
// relay on a Cloudflare account by itself. Cloudflare's API is tests/cloudflare-fake.mjs over HTTP (FALCON_CF_API, which
// main.cjs only honours in a headless run), on a brand-new account with no workers.dev subdomain. The token goes into
// the window main owns, typed for real: first the token's name (what a real user pasted), then a wrong token, then the
// right one, with quotes around it as some copies bring. The relay's address
// (FALCON_CF_RELAY_URL) answers only some seconds in, the way a new workers.dev address fails its TLS handshake for its
// first minutes, so the guide has to wait it out. Afterwards the token must be nowhere on disk and nowhere in the page.
// Needs `npm run build` (dist/, which carries relay-worker.json).
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const { fakeCloudflare } = await import(path.join(REPO, 'tests/cloudflare-fake.mjs'));
const out = path.join(process.env.FALCON_EVIDENCE, 'relay-setup-desktop');
fs.mkdirSync(out, { recursive: true });
const results = [];
const want = (ok, what) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`); console.log(results.at(-1)); return ok; };
let n = 0;
const shot = (page, name) => page.screenshot({ path: path.join(out, `${String(++n).padStart(2, '0')}-${name}.png`) });
setTimeout(() => { console.log('FAIL timed out after the checks above'); finish(1); }, 240_000).unref();

// made up, in the shape of Cloudflare's account tokens: cfat_ and 48 letters and numbers
const TOKEN = `cfat_${Array.from({ length: 48 }, () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 62)]).join('')}`;
const cf = fakeCloudflare({ token: TOKEN });
const api = await cf.serve();
// the relay's new address: nothing there until `online()`, then something that answers Falcon's two checks like a relay
const late = http.createServer((q, s) => {
  const h = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (q.method === 'POST') { s.writeHead(400, h); s.end('{"error":"bad_envelope"}'); } else { s.writeHead(200, h); s.end('{"rooms":1,"peers":8,"frame":1048581}'); }
});
const RELAY = `http://127.0.0.1:${19700 + Math.floor(Math.random() * 200)}`;
const online = () => late.listen(Number(new URL(RELAY).port), '127.0.0.1');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-relay-setup-'));
const env = { ...process.env, FALCON_HEADLESS: '1', FALCON_USER_DATA: userData, FALCON_CF_API: api.url, FALCON_CF_RELAY_URL: RELAY };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], cwd: REPO, env });
const win = await app.firstWindow();
await win.waitForSelector('.ProseMirror');
await win.keyboard.press('Escape');
await win.waitForTimeout(300);
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
// the system clipboard is the user's: what was on it goes back at the end
const clipWas = await app.evaluate(({ clipboard }) => clipboard.readText());
async function finish(code = results.some((r) => r.startsWith('FAIL')) ? 1 : 0) {
  fs.writeFileSync(path.join(out, 'results.txt'), `${results.join('\n')}\n`);
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), clipWas).catch(() => {});
  await app.close().catch(() => {});
  api.close(); late.close();
  fs.rmSync(userData, { recursive: true, force: true });
  process.exit(code);
}
const note = () => win.textContent('.rg-note');
const rows = () => win.$$eval('.rg-steps li', (li) => li.map((l) => `${l.dataset.st} ${l.textContent}`));

await win.click('.fstrip [aria-label="Settings"]');
await win.waitForTimeout(300);
await win.click('[aria-label="Settings sections"] button:has-text("Sharing")');
await win.waitForTimeout(300);
await win.click('.st-help');
await win.waitForSelector('.rg');
await win.waitForTimeout(400); // its fade in
want((await win.textContent('.rg .co-sub')).trim() === 'Step 1 of 4', `the desktop guide is four steps (${await win.textContent('.rg .co-sub')})`);
await shot(win, 'start');
await win.click('.rg .cf-btns button:has-text("Next")'); await win.waitForTimeout(200);
await win.click('.rg .cf-btns button:has-text("Next")'); await win.waitForTimeout(200);
const href = await win.getAttribute('.rg a[href*="api-tokens"]', 'href');
want(href === 'https://dash.cloudflare.com/?to=/:account/api-tokens/create', `the token link opens a new account token in Cloudflare's dashboard (${href})`);
const todo = await win.$$eval('.rg-body ol li', (li) => li.map((l) => l.textContent));
want(todo.length === 4 && /Edit Cloudflare Workers/.test(todo[1]) && /Continue to summary/.test(todo[2]) && /cfat_/.test(todo[3]) && /name at the top of the page is not the token/.test(todo[3]),
  `the token step is four actions: open, Edit Cloudflare Workers, summary and Create Token, copy the cfat_ token (${todo.join(' | ')})`);
await shot(win, 'token-step'); // the link itself isn't clicked: it would open a real browser
await win.click('.rg .cf-btns button:has-text("Next")'); await win.waitForTimeout(200);
want((await win.textContent('.rg h2')).trim() === 'Set up your relay' && await win.evaluate(() => document.activeElement?.textContent === 'Set up my relay'), 'the last step starts on Set up my relay');

/** Click the main button, and type `token` into the window main opens for it, as a person would. */
async function setUp(button, token) {
  const opened = app.waitForEvent('window');
  await win.click(`.rg button:has-text("${button}")`);
  const prompt = await opened;
  await prompt.waitForSelector('#v');
  await win.waitForFunction(() => /window that opened/.test(document.querySelector('.rg-note')?.textContent ?? ''));
  if (token.includes(TOKEN)) await shot(win, 'asking-for-token');
  want(await win.evaluate(() => document.activeElement?.matches('.rg') === true), 'focus stays in the guide while it runs (Esc and Tab stay its own)');
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), token); // as Cloudflare's Copy leaves it
  await prompt.fill('#v', token);
  if (token.includes(TOKEN)) { want(await prompt.evaluate(() => document.documentElement.scrollHeight <= innerHeight), 'the token window fits its contents'); await shot(prompt, 'token-window'); }
  // Enter hands the token to main, which closes the window under the key press
  await Promise.all([prompt.waitForEvent('close'), prompt.press('#v', 'Enter').catch(() => {})]);
}
const bad = () => win.waitForFunction(() => document.querySelector('.rg-note')?.hasAttribute('data-bad'), null, { timeout: 15_000 }).catch(async (e) => { console.log('stuck at', await note(), await rows()); throw e; });
await setUp('Set up my relay', 'snowy-morning-63bf'); // the token's name, from the top of Cloudflare's page
await bad();
want(/^That doesn't look like a token\. A token starts with cfat_/.test(await note()) && !/turned down/.test(await note()), `the token's name pasted instead is called what it is (${await note()})`);
want(JSON.stringify(await rows()) === JSON.stringify(['bad Getting the token', 'todo Finding your Cloudflare account', 'todo Uploading the relay', 'todo Turning on its address', 'todo Checking it works']), `it stops at Getting the token (${await rows()})`);
want(cf.state.log.length === 0, 'Cloudflare was never asked');
await shot(win, 'not-a-token');

await setUp('Try again', `${TOKEN.slice(0, -3)}nop`);
await bad();
want(/^Cloudflare turned down that token\. Make a new one with the link in step 3, pick Edit Cloudflare Workers/.test(await note()), `a wrong token is turned down with what to do (${await note()})`);
want(JSON.stringify(await rows()) === JSON.stringify(['done Getting the token', 'bad Finding your Cloudflare account', 'todo Uploading the relay', 'todo Turning on its address', 'todo Checking it works']), `it shows where it stopped (${await rows()})`);
want(cf.state.scripts.size === 0 && cf.state.subdomain === null, 'nothing was made on the account');
await shot(win, 'failure');

cf.state.hold = 2500; // the upload takes a moment, as a real one does
await setUp('Try again', `"${TOKEN}"`); // quotes and all: only the token itself is sent
await win.waitForFunction(() => document.querySelector('.rg-steps li[data-st="now"]')?.textContent === 'Uploading the relay', null, { timeout: 15_000 });
want(JSON.stringify(await rows()) === JSON.stringify(['done Getting the token', 'done Finding your Cloudflare account', 'now Uploading the relay', 'todo Turning on its address', 'todo Checking it works']), `it shows the stage it's on (${await rows()})`);
await shot(win, 'working');
want(!(await app.evaluate(({ clipboard }) => clipboard.readText())).includes(TOKEN), 'the token is off the clipboard once Falcon has it');
want(cf.state.log.some((l) => l.auth === `Bearer ${TOKEN}`) && cf.state.log.filter((l) => l.auth !== `Bearer ${TOKEN}`).length === 1, 'the quotes were dropped: after the wrong token, only the token itself was sent');
await win.waitForFunction(() => /still trying/.test(document.querySelector('.rg-note')?.textContent ?? ''), null, { timeout: 30_000 });
want(JSON.stringify(await rows()) === JSON.stringify(['done Getting the token', 'done Finding your Cloudflare account', 'done Uploading the relay', 'done Turning on its address', 'now Checking it works']), `the relay is up and Falcon waits for its address (${await rows()})`);
want(/^A new address can take a few minutes to come online\. Falcon is still trying/.test(await note()), `it says a new address takes a few minutes (${await note()})`);
const relay = cf.state.scripts.get('falcon-relay');
want(relay?.tag === 'v2' && [...(relay?.classes ?? [])].join() === 'Inbox,Room' && relay?.workersDev === true, `the relay went up with both migrations and its workers.dev address on (${relay?.tag}, ${[...(relay?.classes ?? [])]})`);
want(/^falcon-[a-z]{6}$/.test(cf.state.subdomain ?? '') && !cf.state.renamed, `a workers.dev subdomain was picked with no question (${cf.state.subdomain})`);
want(relay?.code === JSON.parse(fs.readFileSync(path.join(REPO, 'dist/relay-worker.json'), 'utf8')).code, 'the code uploaded is the relay the app ships');
want((await win.evaluate(() => localStorage.getItem('falcon.relayUrl'))) === null, 'nothing is saved before the relay answers');
await shot(win, 'waiting');

setTimeout(online, 4000); // its certificate arrives
await win.waitForFunction(() => /^It works/.test(document.querySelector('.rg-note')?.textContent ?? ''), null, { timeout: 40_000 });
want((await win.evaluate(() => localStorage.getItem('falcon.relayUrl'))) === RELAY, `once it answers, Falcon saves it (${await note()})`);
want((await rows()).every((r) => r.startsWith('done')), 'every stage is done');
await shot(win, 'done');
await win.click('.rg .cf-btns button:has-text("Done")');
await win.waitForTimeout(300);
want((await win.inputValue('[aria-label="Relay address"]')) === RELAY, 'the Relay box shows the new address');

// the token: only ever in the Authorization header, never on disk, never in the page
want(cf.state.log.length > 0 && cf.state.log.every((l) => !l.call.includes(TOKEN)), 'the token only went in the Authorization header');
want(!(await win.evaluate((t) => document.documentElement.outerHTML.includes(t) || Object.values(localStorage).some((v) => v.includes(t)) || Object.values(sessionStorage).some((v) => v.includes(t)), TOKEN)), 'the page never had the token');
await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), clipWas);
await app.close(); // flush the profile to disk before looking through it
/** The profile's files that hold `s`, as UTF-8 or UTF-16 (how Chromium keeps some strings). */
const holding = (s) => {
  const needles = [Buffer.from(s, 'utf8'), Buffer.from(s, 'utf16le')], hits = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.isFile() && needles.some((x) => fs.readFileSync(p).includes(x))) hits.push(path.relative(userData, p)); } };
  walk(userData);
  return hits;
};
const control = holding(RELAY);
want(control.length > 0, `control: the saved address is found on disk the same way (${control.join(', ')})`);
want(holding(TOKEN).length === 0, `the token is in no file of the profile (${holding(TOKEN).join(', ') || 'none'})`);
want(!errors.length, `no page errors (${errors.join('; ')})`);
await finish();
