// The speech doc's top-bar buttons in the real desktop app (no visible window), against the local stand-ins for
// SpeechDrop and openCaselist. Nothing touches the real sites. The keychain is stubbed, so no OS prompt appears.
// Screenshots go to $SHOTS (default shots/).
//   npm run build && node scripts/electron-speech-toolbar.mjs
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMock as startSd } from '../tests/speechdrop-mock.mjs';
import { startMock as startCl } from '../tests/caselist-mock.mjs';

const shots = process.env.SHOTS || 'shots';
fs.mkdirSync(shots, { recursive: true });
const sd = await startSd();
sd.seed('abc234', 'Round 3 Flight A', []);
const cl = await startCl();
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
Object.assign(env, {
  FALCON_HEADLESS: '1', FALCON_USER_DATA: fs.mkdtempSync(`${os.tmpdir()}/falcon-speechbar-`), CARDMIRROR_BRIDGE_DIR: fs.mkdtempSync(`${os.tmpdir()}/falcon-speechbar-bridge-`),
  FALCON_SD_BASE: sd.url, FALCON_SD_MEDIA: `${sd.url}/media/uploads/`, FALCON_SD_WS: 'off', FALCON_CASELIST_BASE: cl.url,
});
const app = await electron.launch({ args: ['.'], env });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
await app.evaluate(({ BrowserWindow, safeStorage }) => {
  safeStorage.isEncryptionAvailable = () => true;
  safeStorage.encryptString = (s) => Buffer.from(s);
  safeStorage.decryptString = (b) => b.toString();
  BrowserWindow.getAllWindows()[0].setContentSize(1600, 900);
});
await win.waitForSelector('.ProseMirror');
const results = [];
const want = (cond, msg) => { results.push(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) process.exitCode = 1; };
const shot = (n) => win.screenshot({ path: path.join(shots, `speechbar-${n}.png`) }).catch((e) => console.error('screenshot', n, e.message));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await win.waitForTimeout(100); } return false; };
const bar = () => win.$('.bar .g.sp');
const barBtn = (text) => win.locator('.bar .g.sp button', { hasText: text });
const dlg = (text) => win.locator('.cf.cl button', { hasText: new RegExp(`^${text}$`) });
const room = () => [...(sd.rooms.get('abc234')?.files ?? [])].filter(Boolean).map((f) => f.name);

if (await win.$('.home.open')) { await win.keyboard.press('Escape'); await win.waitForTimeout(400); }
await win.click('.ProseMirror');
want(!(await bar()), 'a regular doc leaves the gap empty');
want(!(await win.$('.tools button[aria-label="Read mode"]')), 'the left Read button is gone');
await shot('regular');

await win.click('.tools button[aria-label^="Speech doc"]');
await win.waitForSelector('.bar .g.sp');
want(true, 'marking the doc as a speech doc brings the buttons');
await win.evaluate(() => {
  const v = window.__falconView, { schema } = v.state, hl = schema.marks.highlight.create({ color: 'yellow' });
  const p = (style, text, marks) => schema.nodes.paragraph.create({ style }, schema.text(text, marks));
  const card = (tag, cite, read, rest) => [p('tag', tag), p('normal', cite, [schema.marks.cite.create()]), schema.nodes.paragraph.create({ style: 'normal' }, [schema.text(read, [hl]), schema.text(rest)])];
  v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, [
    p('pocket', '1NC'), p('hat', 'Offshoring DA'), p('block', 'Uniqueness'),
    ...card('Data center build-out stays home now', 'Smith 26', 'siting stays domestic while state rules are mixed, and new load is locked in through 2030', ' according to the filings we reviewed for this report'),
    p('block', 'Link'),
    ...card('A moratorium pushes the load overseas', 'Lee 26', 'operators shift capacity abroad within two years when domestic permits stop', ' though some wait it out'),
    p('hat', 'Econ DA'), p('block', 'Link'),
    ...card('Build-out is the only thing holding up growth', 'Park 26', 'AI capital spending accounted for most of GDP growth in the first half', ' of the year'),
  ]));
});
await win.waitForTimeout(400);
const words = await win.textContent('.bar .rc b');
want(/^\d+ words$/.test(words), `the counter reads ${words} · ${await win.textContent('.bar .rc i')}`);
await shot('speech');

// Read mode still works from the one button left
await win.locator('.bar .end button', { hasText: /^Read$/ }).dispatchEvent('mousedown');
want(await until(async () => (await win.textContent('.status')).includes('Read mode')), 'Read mode turns on from the Read button');
await shot('read-mode');
await win.locator('.bar .end button', { hasText: /^Read$/ }).dispatchEvent('mousedown');
await win.waitForTimeout(200);

// SpeechDrop: no room, the code once, then one click
await barBtn('SpeechDrop').dispatchEvent('mousedown');
await win.waitForSelector('.cf input[aria-label="Room code"]');
await shot('room-ask');
await win.fill('.cf input[aria-label="Room code"]', 'abc234');
want(await until(() => room().length === 1), `the code joins and uploads: ${room()}`);
want(!(await win.$('section.sd.open')), 'the doc stays up behind it');
await barBtn('SpeechDrop').dispatchEvent('mousedown');
want(await until(() => room().length === 2), 'the next click just uploads');
want(!(await win.$('.cf input[aria-label="Room code"]')), 'and doesn\'t ask again');

// Caselist: sign in, pick the team, check the round, disclose
await barBtn('Caselist').dispatchEvent('mousedown');
await win.waitForSelector('input[aria-label="Tabroom email"]');
await shot('signin');
await win.fill('input[aria-label="Tabroom email"]', 'test@example.com');
await win.fill('input[aria-label="Tabroom password"]', 'wrong');
await dlg('Sign in').click();
want(await until(async () => (await win.textContent('.cl-err').catch(() => '')).includes('Wrong')), 'a wrong password says so');
await win.fill('input[aria-label="Tabroom password"]', 'test-pass');
await dlg('Sign in').click();
await win.waitForSelector('select[aria-label="School"]');
await until(() => win.$eval('select[aria-label="School"]', (s) => s.options.length > 1));
await win.selectOption('select[aria-label="School"]', 'Jericho');
await until(() => win.$eval('select[aria-label="Team"]', (s) => s.options.length > 1));
await win.selectOption('select[aria-label="Team"]', 'XG');
await shot('team');
await dlg('Continue').click();
await win.waitForSelector('input[aria-label="Tournament"]');
const val = (l) => win.inputValue(`[aria-label="${l}"]`);
want(await val('Tournament') === '3---Blake', `tournament numbered like the page: ${await val('Tournament')}`);
want(await val('Round') === '3' && await val('Opponent') === 'Sharon SS' && await val('Judge') === 'Raj Khan', 'round, opponent and judge come from Tabroom');
want(await val('Round report') === '1NC---Offshoring DA, Econ DA', `report: ${await val('Round report')}`);
want(cl.state.posts.length === 0, 'nothing has posted yet');
await shot('round');
await dlg('Disclose').click();
want(await until(() => cl.state.posts.length === 1), 'Disclose posts one round');
const post = cl.state.posts[0];
const docx = Buffer.from(post.opensource ?? '', 'base64');
want(post.path === '/caselists/hspf26/schools/Jericho/teams/XG/rounds' && post.side === 'N' && post.tournament === '3---Blake', `to ${post.path}, side ${post.side}`);
want(docx[0] === 0x50 && docx[1] === 0x4b && post.filename.endsWith('.docx'), `with the doc attached: ${post.filename}, ${docx.length} bytes`);
await barBtn('Caselist').dispatchEvent('mousedown');
await win.waitForSelector('input[aria-label="Tournament"]');
want((await win.textContent('.cf.cl')).includes('already on your page'), 'a second try warns the round is up');
await shot('already');
await dlg('Cancel').click();
want(cl.state.posts.length === 1, 'Cancel posts nothing');

want(errors.length === 0, `no page errors${errors.length ? `: ${errors[0]}` : ''}`);
console.log(results.join('\n'));
await app.close();
await sd.close();
await cl.close();
