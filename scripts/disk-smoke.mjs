// The pill at the bottom right, end to end in the real Electron app on a real file: it names the cloud folder a
// file is in, notices when another program rewrites the file, and each choice (keep theirs, keep mine, keep both)
// does what it says. Prints ok/FAIL lines, exits 1 on any FAIL.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'falcon-disk-'));
const dir = path.join(root, 'Dropbox', 'DA');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'Impact.docx');
const seed = fs.readFileSync('.claude/skills/verify-falcon/fixtures/seed.docx');
fs.writeFileSync(file, seed);
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
Object.assign(env, { FALCON_USER_DATA: path.join(root, 'data'), FALCON_HEADLESS: '1' });
const results = [];
const want = (ok, what) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`); return ok; };
fs.mkdirSync('shots', { recursive: true });

// open it the way a person does: from Home's recent files (seeded, as an earlier session leaves them)
const { a: app, w: win } = await (async () => {
  const data = path.join(root, 'data');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'recent-paths.json'), JSON.stringify([file]));
  const a = await electron.launch({ args: ['.'], env });
  const w = await a.firstWindow();
  await w.waitForSelector('.ProseMirror');
  await w.evaluate(([f, n]) => localStorage.setItem('falcon.recents.v1', JSON.stringify([{ name: n, path: f, folder: 'DA', cards: 0, blocks: [], when: Date.now() }])), [file, 'Impact']);
  await w.reload();
  await w.waitForSelector('.ProseMirror');
  await w.waitForTimeout(500);
  await w.click('.home >> text=Impact');
  await w.waitForFunction(() => document.querySelector('.ProseMirror')?.textContent.length > 20, null, { timeout: 15000 });
  return { a, w };
})();
const pill = () => win.$eval('.status .disk', (b) => ({ text: b.textContent.trim(), state: b.dataset.state })).catch(() => null);
const text = () => win.evaluate(() => document.querySelector('.ProseMirror').textContent);
await win.waitForSelector('.status .disk', { timeout: 8000 });
let p = await pill();
want(p?.text === 'Dropbox' && p.state === 'synced', `a file in a Dropbox folder shows Dropbox: ${JSON.stringify(p)}`);

// another program saves a different file over it: another copy of the seed with a word changed inside the XML
const { unzipSync, zipSync, strFromU8, strToU8 } = await import('fflate');
const xmlOf = (f) => strFromU8(unzipSync(new Uint8Array(fs.readFileSync(f)))['word/document.xml']);
const other = async (from, to) => {
  const z = unzipSync(new Uint8Array(fs.readFileSync(file)));
  z['word/document.xml'] = strToU8(strFromU8(z['word/document.xml']).replace(from, to));
  return Buffer.from(zipSync(z));
};
const firstWord = (await text()).trim().split(/\s+/)[0];
fs.writeFileSync(file, await other(firstWord, 'THEIRS'));
await win.evaluate(() => window.dispatchEvent(new Event('focus')));
await win.waitForFunction(() => document.querySelector('.status .disk')?.dataset.state === 'changed', null, { timeout: 10000 });
p = await pill();
want(p.text.startsWith('Changed on disk'), `it notices the file changed on disk: ${p.text}`);
await win.screenshot({ path: 'shots/disk-changed.png' });

// Save while it's changed asks first instead of saving over theirs
await win.evaluate(() => { const v = window.__falconView ?? null; if (v) { v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.atEnd(v.state.doc))); v.focus(); } });
await win.click('.ProseMirror p:last-of-type');
await win.keyboard.press('End');
await win.keyboard.type(' MINE');
want((await text()).includes('MINE'), 'typed a change of my own');
await win.keyboard.press(`${MOD}+s`);
await win.waitForSelector('.cf.dk', { timeout: 5000 });
want(xmlOf(file).includes('THEIRS'), 'Save on a changed file asks first, and their file is untouched');
want((await win.$$eval('.dk-list b', (b) => b.map((x) => x.textContent))).join() === 'Keep their changes,Keep my changes,Keep both', 'it offers keep theirs, keep mine, keep both');
await win.screenshot({ path: 'shots/disk-choices.png' });

// keep theirs: their text comes in, and one undo brings mine back
await win.click('.dk-list button:has-text("Keep their changes")');
await win.waitForFunction(() => document.querySelector('.ProseMirror').textContent.includes('THEIRS'), null, { timeout: 8000 });
want(!(await text()).includes('MINE') && (await pill())?.state === 'synced', `keep theirs loads the file from disk and the pill settles: ${JSON.stringify(await pill())}`);
await win.waitForTimeout(300);
await win.keyboard.press(`${MOD}+z`);
await win.waitForTimeout(300);
want((await text()).includes('MINE'), 'one undo brings your version back');

// keep mine: overwrites the file
fs.writeFileSync(file, await other('THEIRS', 'THEIRS2'));
await win.evaluate(() => window.dispatchEvent(new Event('focus')));
await win.waitForFunction(() => document.querySelector('.status .disk')?.dataset.state === 'changed', null, { timeout: 10000 });
await win.click('.status .disk');
await win.click('.dk-list button:has-text("Keep my changes")');
await win.waitForFunction(() => document.querySelector('.status .disk')?.dataset.state === 'synced', null, { timeout: 8000 });
const onDisk = xmlOf(file);
want(onDisk.includes('MINE') && !onDisk.includes('THEIRS2'), 'keep mine saves your version over theirs');

// keep both: your version becomes a conflicted copy beside it, and the tab carries on in the copy
fs.writeFileSync(file, await other('MINE', 'THEIRS3'));
await win.evaluate(() => window.dispatchEvent(new Event('focus')));
await win.waitForFunction(() => document.querySelector('.status .disk')?.dataset.state === 'changed', null, { timeout: 10000 });
await win.click('.status .disk');
await win.click('.dk-list button:has-text("Keep both")');
await win.waitForFunction(() => document.querySelector('.status .disk')?.dataset.state === 'copy', null, { timeout: 8000 });
const copies = fs.readdirSync(dir).filter((f) => f.includes('conflicted copy'));
const copyXml = copies[0] && xmlOf(path.join(dir, copies[0]));
const origXml = xmlOf(file);
want(copies.length === 1 && copyXml.includes('MINE') && origXml.includes('THEIRS3'), `keep both writes your version beside theirs: ${copies.join()}`);
want((await pill())?.text === 'Conflicted copy', 'and the pill says you are in the conflicted copy');
await win.click('.status .disk');
await win.click('.dk-list button:has-text("Open the original")');
await win.waitForTimeout(2500);
const shown = await text();
want(shown.includes('THEIRS3') && !shown.includes('MINE'), 'Open the original opens it, with their changes');
await win.screenshot({ path: 'shots/disk-original.png' });

// a plain folder shows nothing
const plain = path.join(root, 'PlainFile.docx');
fs.writeFileSync(plain, seed);
await app.close();
const data2 = path.join(root, 'data2');
fs.mkdirSync(data2, { recursive: true });
fs.writeFileSync(path.join(data2, 'recent-paths.json'), JSON.stringify([plain]));
const app2 = await electron.launch({ args: ['.'], env: { ...env, FALCON_USER_DATA: data2 } });
const w2 = await app2.firstWindow();
await w2.waitForSelector('.ProseMirror');
await w2.evaluate((f) => localStorage.setItem('falcon.recents.v1', JSON.stringify([{ name: 'PlainFile', path: f, folder: '', cards: 0, blocks: [], when: Date.now() }])), plain);
await w2.reload();
await w2.waitForSelector('.ProseMirror');
await w2.waitForTimeout(500);
await w2.click('.home >> text=PlainFile');
await w2.waitForFunction(() => document.querySelector('.ProseMirror')?.textContent.length > 20, null, { timeout: 15000 });
await w2.waitForTimeout(1500);
want(!(await w2.$('.status .disk')), 'a file in a plain folder shows no pill');
await app2.close();
fs.rmSync(root, { recursive: true, force: true });
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
