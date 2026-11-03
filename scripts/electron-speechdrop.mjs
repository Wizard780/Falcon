// The SpeechDrop tab in the real desktop app (no visible window), against tests/speechdrop-mock.mjs, a
// local stand-in that checks cookies and XSRF tokens the way speechdrop.net does. Nothing touches the
// real site. Opening a non-.docx file and showing a file in Finder/Explorer are stubbed, so no other
// app or window appears. Screenshots go to $SHOTS (default shots/).
//   npm run build && node scripts/electron-speechdrop.mjs
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMock } from '../tests/speechdrop-mock.mjs';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const shots = process.env.SHOTS || 'shots';
fs.mkdirSync(shots, { recursive: true });
const seedDocx = fs.readFileSync('.claude/skills/verify-falcon/fixtures/seed.docx');
const mock = await startMock();
mock.seed('abc234', 'Round 3 <Flight A>', [{ name: 'Aff 1AC.docx', bytes: seedDocx }, { name: 'Neg 1NC.pdf', bytes: '%PDF-1.4' }]);
const downloads = fs.mkdtempSync(`${os.tmpdir()}/falcon-sd-dl-`);
const picked = path.join(fs.mkdtempSync(`${os.tmpdir()}/falcon-sd-pick-`), 'Cards.txt');
fs.writeFileSync(picked, 'some cards');

const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
Object.assign(env, {
  FALCON_HEADLESS: '1', FALCON_USER_DATA: fs.mkdtempSync(`${os.tmpdir()}/falcon-sd-`),
  FALCON_SD_BASE: mock.url, FALCON_SD_MEDIA: `${mock.url}/media/uploads/`, FALCON_SD_WS: 'off', FALCON_SD_DOWNLOADS: downloads,
});
const app = await electron.launch({ args: ['.'], env });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
await app.evaluate(({ shell, dialog }, p) => {
  globalThis.__shell = [];
  shell.openPath = async (f) => { globalThis.__shell.push(['open', f]); return ''; };
  shell.showItemInFolder = (f) => { globalThis.__shell.push(['show', f]); };
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
}, picked);
await win.waitForSelector('.ProseMirror');
const results = [];
const want = (cond, msg) => { results.push(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) process.exitCode = 1; };
const shot = (n) => win.screenshot({ path: path.join(shots, `sd-${n}.png`) }).catch((e) => console.error('screenshot', n, e.message));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await win.waitForTimeout(100); } return false; };
const files = () => win.$$eval('.sd-f .nm', (n) => n.map((x) => x.textContent));
const tabs = () => win.$$eval('.fs-docs .doc-nm', (n) => n.map((x) => x.getAttribute('aria-label')));

// a doc with something in it, then Home > SpeechDrop
if (await win.$('.home.open')) { await win.keyboard.press('Escape'); await win.waitForTimeout(400); }
await win.click('.ProseMirror');
await win.keyboard.type('the plan solves');
await win.keyboard.press(`${mod}+t`);
await win.waitForSelector('.home.open');
await win.click('.home .hm-act:has-text("SpeechDrop")');
await win.waitForSelector('section.sd.open input[aria-label="Room code"]');
await win.waitForTimeout(350);
await shot('1-lobby');
want(JSON.stringify(await tabs()) === '["Untitled","SpeechDrop"]', `Home > SpeechDrop opens a tab after the doc: ${await tabs()}`);

// join by code: the 6th character joins
await win.click('input[aria-label="Room code"]');
await win.keyboard.type('abc234');
await win.waitForSelector('.sd-hi:has-text("Round 3")');
want(await win.$eval('.sd-hi', (h) => h.textContent) === 'Round 3 <Flight A>', 'the room name shows decoded');
want(JSON.stringify(await files()) === '["Neg 1NC.pdf","Aff 1AC.docx"]', `files newest first: ${await files()}`);
want((await tabs())[1] === 'SpeechDrop: Round 3 <Flight A>', 'the tab takes the room name');
await shot('2-room');

// Upload the doc you came from, unsaved
await win.click('.sd button:has-text("Upload Untitled")');
want(await until(async () => (await files())[0] === 'Untitled.docx'), 'Upload puts Untitled.docx at the top');
const up = mock.rooms.get('abc234').files.at(-1);
want(up?.name === 'Untitled.docx' && up.bytes.subarray(0, 2).toString() === 'PK' && up.bytes.length > 1000, `the stand-in got a real .docx (${up?.bytes.length} bytes)`);
want(!!(await win.$('[aria-label="Delete Untitled.docx"]')) && !(await win.$('[aria-label="Delete Aff 1AC.docx"]')), 'Delete shows on your own upload only');

// Upload file… through the (stubbed) native picker
await win.click('.sd button:has-text("Upload file")');
want(await until(async () => (await files())[0] === 'Cards.txt'), 'Upload file… uploads the picked file');
want(mock.rooms.get('abc234').files.at(-1)?.bytes.toString() === 'some cards', 'with its bytes');

// someone else uploads while you're in the doc: it appears (polled, the socket is off here), a toast and a dot
await win.click('.fs-docs .doc-nm[aria-label="Untitled"]');
want(!(await win.$('section.sd.open')), 'clicking the doc tab shows the doc');
mock.rooms.get('abc234').files.push({ name: 'Neg 2NC.docx', ctime: Date.now(), bytes: seedDocx });
want(await until(async () => (await win.textContent('.toast'))?.includes('New in SpeechDrop: Neg 2NC.docx'), 9000), 'a new file in the room shows a toast');
want(!!(await win.$('.fs-docs .sd-tab .dot.new')), 'and a dot on the SpeechDrop tab');
await shot('3-new-file-toast');
await win.click('.toast button');
await win.waitForSelector('section.sd.open');
want(await win.$eval('.sd-row[data-fresh] .nm', (n) => n.textContent).catch(() => null) === 'Neg 2NC.docx', 'Show opens the tab with the new file marked');
await win.waitForTimeout(350);
await shot('4-room-new');

// open a .docx: downloaded into the room's folder, opened as a Falcon tab
await win.click('.sd-f:has-text("Aff 1AC.docx")');
want(await until(async () => (await tabs()).includes('Aff 1AC')), `the .docx opens as a tab: ${await tabs()}`);
want(fs.existsSync(path.join(downloads, 'abc234', 'Aff 1AC.docx')), 'it was saved to Downloads/SpeechDrop/<room>');
want((await win.evaluate(() => window.__falconView.state.doc.textContent)).includes('needle'), 'the opened tab shows the file');
// open a PDF: handed to its app (stubbed)
await win.click('.fs-docs .sd-tab .doc-nm');
await win.click('.sd-f:has-text("Neg 1NC.pdf")');
want(await until(async () => (await app.evaluate(() => globalThis.__shell)).some(([k, f]) => k === 'open' && f.endsWith('Neg 1NC.pdf'))), 'a PDF opens in its own app');

// delete your own upload, after the question
await win.click('[aria-label="Delete Untitled.docx"]');
await win.waitForSelector('.cf');
await win.click('.cf .cf-ok');
want(await until(async () => !(await files()).includes('Untitled.docx')), 'Delete takes it out of the list');
want(mock.rooms.get('abc234').files.every((f) => f?.name !== 'Untitled.docx'), 'and out of the room');

// download all: one zip
await win.click('.sd button:has-text("Download all")');
want(await until(() => fs.readdirSync(downloads).some((f) => f.endsWith('.zip'))), `Download all writes a zip: ${fs.readdirSync(downloads)}`);
const zip = fs.readdirSync(downloads).find((f) => f.endsWith('.zip'));
want(zip === 'Round 3 -Flight A-.zip', `named for the room: ${zip}`);

// make a room
await win.click('.sd button:has-text("Leave room")');
await win.fill('input[aria-label="New room name"]', 'Doubles Flight B');
await win.click('.sd-make button[type="submit"]');
await win.waitForSelector('.sd-hi:has-text("Doubles Flight B")');
const made = [...mock.rooms.entries()].find(([, r]) => r.name === 'Doubles Flight B');
want(!!made && (await win.textContent('.sd-code'))?.trim() === made[0], `Make room makes it on SpeechDrop and joins it (${made?.[0]})`);
want((await win.$$eval('.sd-rr', (r) => r.length).catch(() => 0)) === 0, 'in the room, not the lobby');
await shot('5-made-room');

// Mod-W closes the tab and leaves the docs alone
await win.keyboard.press(`${mod}+w`);
await win.waitForTimeout(300);
want(JSON.stringify(await tabs()) === '["Untitled","Aff 1AC"]', `Mod-W closes the SpeechDrop tab only: ${await tabs()}`);
want(!(await win.$('.cf')), 'without asking about the unsaved doc');

const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()));
want(visible.every((v) => !v), `no window was shown: ${visible}`);
want(!errors.length, `no page errors: ${errors.join(' | ')}`);
await app.evaluate(() => { globalThis.falconSkipUnloadGuard = true; });
await app.close();
await mock.close();
console.log(results.join('\n'));
