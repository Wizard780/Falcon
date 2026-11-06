// Templates in the real app: made in Settings (file dialog stubbed), then opened from the command center after a
// restart, with no recents, which is the case only the picker's allowance covers. Needs a build: npm run build first.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const profile = fs.mkdtempSync(`${os.tmpdir()}/falcon-tpl-profile-`);
const dir = fs.mkdtempSync(`${os.tmpdir()}/falcon-tpl-files-`);
Object.assign(env, { FALCON_USER_DATA: profile, FALCON_HEADLESS: '1' });
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const shots = process.env.TPL_SHOTS;
const seed = '.claude/skills/verify-falcon/fixtures/seed.docx';
const [a, b, c, outside] = ['Fem K', 'Fem Blocks', 'Fem Cards', 'Outside'].map((n) => path.join(dir, `${n}.docx`));
for (const p of [a, b, c, outside]) fs.copyFileSync(seed, p);

let failed = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)}`}`); if (!ok) failed++; };
const shot = async (win, name) => { if (shots) await win.screenshot({ path: path.join(shots, `${name}.png`), timeout: 15000 }).catch(() => {}); };

async function launch() {
  const app = await electron.launch({ args: ['.'], env });
  const win = await app.firstWindow();
  await win.waitForSelector('.ProseMirror, .hm-doc', { state: 'attached', timeout: 20000 });
  await win.waitForTimeout(800);
  return { app, win };
}
const tabs = (win) => win.$$eval('.doc-nm', (els) => els.map((e) => e.getAttribute('aria-label')));
const active = (win) => win.evaluate(() => window.__falconView.state.doc.textContent.length > 0 && document.title);
async function runTemplate(win, query) {
  await win.keyboard.press(`${mod}+Shift+Space`);
  await win.waitForSelector('.cc input');
  await win.keyboard.type(query);
  await win.waitForTimeout(250);
}

// ---- make it in Settings
let { app, win } = await launch();
await win.keyboard.press('Escape'); await win.waitForTimeout(400); // close Home (the later launches stay on it)
await app.evaluate(({ dialog }, files) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files }); }, [a, b, c]);
await win.keyboard.press(`${mod}+,`);
await win.click('[aria-label="Settings sections"] button:has-text("Templates")');
await shot(win, '1-settings-empty');
await win.click('.st-btn:has-text("New template")');
const focused = await win.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Name of Template 1', null, { timeout: 3000 }).then(() => true, () => false);
check('New template puts the caret in its name', focused, 'not focused');
await win.keyboard.type('AT Fem');
await win.click('.st-btn:has-text("Add files")');
await win.waitForSelector('.st-row:has-text("Fem Cards")', { timeout: 5000 });
await win.click('.st-btn:has-text("Add files")'); // the same files again add nothing
await win.waitForTimeout(300);
const rows = await win.$$eval('.st-row', (els) => els.map((e) => e.innerText));
check('lists each picked file once', rows.filter((t) => t.includes('Fem K')).length === 1 && rows.some((t) => t.includes('3 files')), rows);
await shot(win, '2-settings-filled');
await win.keyboard.press('Escape');
await win.waitForTimeout(300);
await app.close();

// ---- nothing made these files recent: only the template's allowance lets them open
const recents = path.join(profile, 'recent-paths.json');
check('picking files did not make them recents', !fs.existsSync(recents) || !fs.readFileSync(recents, 'utf8').includes('Fem'), 'recent');
({ app, win } = await launch());
const before = await tabs(win);
await runTemplate(win, 't');
await win.keyboard.press('Space');
await win.waitForSelector('.cc-row:has-text("AT Fem")', { timeout: 5000 });
check('t and a space lists templates, with nothing typed', (await win.$$eval('.cc-row', (r) => r.length)) === 1, await win.$$eval('.cc-row', (r) => r.map((x) => x.innerText)));
await win.keyboard.type('fem');
await win.waitForTimeout(250);
await shot(win, '3-command-center');
check('it is a TPL row saying how many files', /TPL/.test(await win.innerText('.cc-row[data-on]')) && /AT Fem/.test(await win.innerText('.cc-row[data-on]')), await win.innerText('.cc-row[data-on]'));
await win.keyboard.press('Enter');
await win.waitForSelector('.doc-nm[aria-label="Fem Cards"]', { state: 'attached', timeout: 10000 });
await win.waitForTimeout(500);
const after = await tabs(win);
check('Enter opens all three, in order, over the blank tab', after.join() === 'Fem K,Fem Blocks,Fem Cards', { before, after });
const lit = () => win.evaluate(() => [...document.querySelectorAll('[aria-current], [data-on]')].map((e) => e.querySelector?.('.doc-nm')?.getAttribute('aria-label')).find(Boolean));
check('you land on the first file', (await lit()) === 'Fem K', await lit());
await shot(win, '4-opened');

// ---- again: nothing doubles. By name, without the prefix
await win.keyboard.press(`${mod}+n`); await win.waitForTimeout(300);
await runTemplate(win, 'at fem');
check('its name finds it with no prefix', /AT Fem/.test(await win.innerText('.cc-row[data-on]')), await win.innerText('.cc-row[data-on]'));
await win.keyboard.press('Enter');
await win.waitForTimeout(800);
const again = await tabs(win);
check('opening it again adds no tabs', again.filter((t) => t.startsWith('Fem')).length === 3, again);
check('and goes back to the first file', (await lit()) === 'Fem K', await lit());

// ---- a file that moved: the rest still open, and it says which
await app.close();
fs.rmSync(b);
({ app, win } = await launch());
await runTemplate(win, 't fem');
await win.keyboard.press('Enter');
await win.waitForSelector('.doc-nm[aria-label="Fem Cards"]', { state: 'attached', timeout: 10000 });
await win.waitForTimeout(300);
const left = await tabs(win);
check('a missing file does not stop the others', left.join() === 'Fem K,Fem Cards', left);
const said = await win.evaluate(() => document.body.innerText.includes("AT Fem: couldn't open Fem Blocks"));
check('and the message names it', said, 'no message');
await shot(win, '5-missing-file');

// ---- the allowance covers picked files only
const refused = await win.evaluate((p) => window.falcon.openPath(p).then(() => 'opened', (e) => e.message), outside);
check('a file never picked still cannot be opened by path', /Open this file with Open first/.test(refused), refused);
await app.close();
fs.rmSync(profile, { recursive: true, force: true });
fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `${failed} failed` : 'all ok');
process.exit(failed ? 1 : 0);
