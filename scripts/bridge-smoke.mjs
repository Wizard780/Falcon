// The debate-app bridge end to end: launches the Electron app with no visible window and a throwaway bridge
// folder, then plays Nimbus: reads falcon.session.json, pings, lists docs, gets asked to connect, and sends a
// CardMirror-format card into a doc that isn't on screen. Prints ok/FAIL lines, exits 1 on any FAIL.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
const dir = fs.mkdtempSync(`${os.tmpdir()}/falcon-bridge-`);
Object.assign(env, { FALCON_USER_DATA: fs.mkdtempSync(`${os.tmpdir()}/falcon-bridge-profile-`), FALCON_HEADLESS: '1', CARDMIRROR_BRIDGE_DIR: dir });
const results = [];
const want = (ok, what) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`); return ok; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const app = await electron.launch({ args: ['.'], env });
const win = await app.firstWindow();
await win.waitForSelector('.ProseMirror');
await win.keyboard.press('Escape'); await wait(300);
const sessionFile = path.join(dir, 'falcon.session.json');
for (let i = 0; i < 50 && !fs.existsSync(sessionFile); i++) await wait(100);
const s = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
want(JSON.parse(fs.readFileSync(path.join(dir, 'falcon.json'), 'utf8')).kind === 'editor', 'falcon.json says kind editor, next to CardMirror\'s');
// what Nimbus's cmbridge.rs does: token + X-App-Id, no Origin
fs.writeFileSync(path.join(dir, 'nimbus.json'), JSON.stringify({ schema: 1, app: 'nimbus', appVersion: '1.6.4', kind: 'flow' }));
const call = async (method, route, body) => (await fetch(`http://127.0.0.1:${s.port}${route}`, { method, body: body && JSON.stringify(body), headers: { 'X-Bridge-Token': s.token, 'X-App-Id': 'nimbus' } })).json();

const ping = await call('GET', '/ping');
want(ping.ok && ping.app === 'falcon' && ping.hasActiveDoc === true, `ping: ${JSON.stringify(ping)}`);
// make a second doc, so the first one is in the background
await win.evaluate(() => { const v = window.__falconView; v.dispatch(v.state.tr.insertText('First doc', 1)); });
await win.keyboard.press(process.platform === 'darwin' ? 'Meta+n' : 'Control+n'); await wait(300);

const first = await call('GET', '/docs');
want(first.ok && first.pending === 'consent', `first contact asks: ${JSON.stringify(first)}`);
await win.waitForSelector('.cf', { timeout: 3000 }).catch(() => {});
const q = await win.evaluate(() => document.querySelector('.cf h2')?.textContent ?? '');
want(q === 'Let Nimbus send cards to Falcon?', `Falcon asks in its window: "${q}"`);
await win.screenshot({ path: 'shots/bridge-consent.png' }).catch(() => {});
await win.click('.cf-ok'); await wait(200);

const docs = await call('GET', '/docs');
want(docs.ok && docs.docs.length === 2 && docs.docs[1].focusedWindow && !docs.docs[0].focusedWindow, `two docs, the new one focused: ${JSON.stringify(docs.docs)}`);
const back = docs.docs[0].target;
const html = '<div data-pm-slice="0 0 []"><div class="pmd-card"><h4 class="pmd-tag">Warming causes extinction</h4>'
  + '<p class="pmd-cite-para"><span class="pmd-cite">Chen 25</span>, Nature</p>'
  + '<p class="pmd-card-body"><span class="pmd-underline"><span class="pmd-highlight" data-highlight="cyan">emissions</span></span> keep rising</p></div></div>';
const ins = await call('POST', '/insert', { target: back, html, text: 'Warming causes extinction' });
want(ins.ok && ins.inserted && ins.docTitle, `insert into the background doc: ${JSON.stringify(ins)}`);
const onScreen = await win.evaluate(() => window.__falconView.state.doc.textContent);
want(!onScreen.includes('Warming'), 'the doc on screen is untouched (no focus stolen)');
const toast = await win.evaluate(() => document.querySelector('.toast.show')?.textContent ?? '');
want(/Nimbus sent “Warming causes extinction”/.test(toast), `Falcon says what came in: "${toast}"`);
await win.screenshot({ path: 'shots/bridge-sent.png' }).catch(() => {});
want((await call('POST', '/insert', { target: 'falcon-999', html, text: 'x' })).error === 'target-not-found', 'a closed doc is target-not-found, never another doc');

// go back to the first doc and look at the card
await win.keyboard.press('Control+Shift+Tab'); await wait(300);
const map = await win.evaluate(() => window.__falconMarkMap());
want(map.split('\n').join(' | ') === 'normal: First doc | tag: Warming causes extinction | normal: [Chen 25]{cite}, Nature | normal: [emissions]{highlight:cyan+underline} keep rising', `the card kept its tag, cite and highlight: ${map.split('\n').join(' | ')}`);

await app.close();
want(!fs.existsSync(sessionFile), 'quitting drops falcon.session.json');
console.log(results.join('\n'));
process.exitCode = results.some((r) => r.startsWith('FAIL')) ? 1 : 0;
