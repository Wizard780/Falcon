// The desktop app with an open doc that another program writes (the way Claude's scripts do), with no visible window.
// Opens a COPY of FALCON_DOC (default: the verify seed), makes an unsaved edit, then writes the file from outside:
// a new pending card (merged in, the edit kept), the same card changed on both sides (Falcon asks), and a write
// right before Save (the save is refused, merged, then written). Checks open-docs.json along the way.
// node scripts/disk-sync-check.mjs   (FALCON_SHOTS=<dir> keeps the screenshots)
import { _electron as electron } from 'playwright';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
env.FALCON_USER_DATA = fs.mkdtempSync(`${os.tmpdir()}/falcon-sync-`);
const src = process.env.FALCON_DOC || '.claude/skills/verify-falcon/fixtures/seed.docx';
const doc = path.join(fs.mkdtempSync(`${os.tmpdir()}/falcon-sync-doc-`), path.basename(src));
fs.copyFileSync(src, doc);
const name = path.basename(doc, '.docx');
const shots = process.env.FALCON_SHOTS || fs.mkdtempSync(`${os.tmpdir()}/falcon-sync-shots-`);
fs.mkdirSync(shots, { recursive: true });
const statusFile = path.join(env.FALCON_USER_DATA, 'open-docs.json');
const status = () => { try { return JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch { return null; } };
const results = [];
const want = (ok, what) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`); return ok; };
const until = async (f, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await f(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };

// another program writing the file: edit word/document.xml and zip it back, in place
function outside(edit) {
  const files = unzipSync(fs.readFileSync(doc));
  files['word/document.xml'] = strToU8(edit(strFromU8(files['word/document.xml'])));
  fs.writeFileSync(doc, zipSync(files));
}
const tagStarts = (xml) => [...xml.matchAll(/<w:p\b[^>]*>(?:(?!<\/w:p>).)*?<w:pStyle w:val="Heading4"\/>/gs)].map((m) => m.index);
const newCard = (id, tag, body) => `<w:p><w:pPr><w:pStyle w:val="Heading4"/></w:pPr><w:bookmarkStart w:id="${900 + id.length}" w:name="_fcp_${id}"/><w:bookmarkEnd w:id="${900 + id.length}"/><w:r><w:t>${tag}</w:t></w:r></w:p><w:p><w:r><w:t>${body}</w:t></w:r></w:p>`;

const app = await electron.launch({ args: ['.', doc], env: { ...env, FALCON_HEADLESS: '1' } });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
await win.waitForSelector('.ProseMirror');
await win.keyboard.press('Escape');
await win.waitForSelector(`.doc-row .doc-nm[aria-label="${name}"]`, { timeout: 15000 });
const text = () => win.evaluate(() => window.__falconView.state.doc.textContent);
const pending = () => win.evaluate(() => { const o = []; window.__falconView.state.doc.forEach((n) => { if (n.attrs.pending) o.push(n.textContent); }); return o; });
const shot = (n) => win.screenshot({ path: path.join(shots, n), timeout: 15000 }).catch((e) => console.error('screenshot failed:', e.message.split('\n')[0]));

const s0 = await until(() => status()?.docs?.find((d) => d.path === doc));
want(s0 && s0.unsaved === false && s0.active === true && !!s0.readAt, `open-docs.json lists the open file, saved: ${JSON.stringify(s0)}`);

// an unsaved edit at the end of the first body paragraph under the first tag (selection set through the editor: a
// hidden window has no OS focus). `k` is its paragraph number, the same in the file's XML
const k = await win.evaluate(() => {
  const v = window.__falconView; let at = -1, k = -1, tag = false;
  v.state.doc.forEach((n, pos, i) => { if (at < 0 && tag && n.attrs.style === 'normal' && n.textContent.trim()) { at = pos + n.nodeSize - 1; k = i; } if (n.attrs.style === 'tag') tag = true; });
  v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(at), -1))); v.focus();
  return k;
});
await win.keyboard.type(' MY UNSAVED EDIT');
const s1 = await until(() => status()?.docs?.find((d) => d.path === doc && d.unsaved));
want(!!s1, 'open-docs.json marks it unsaved after typing');

// 1. a new card on disk, ten tags down
outside((xml) => { const at = tagStarts(xml)[10]; return xml.slice(0, at) + newCard('outside1', 'Outside card one', 'outside body one') + xml.slice(at); });
const came = await until(async () => (await text()).includes('Outside card one'));
want(!!came, 'the card written on disk shows up in the open doc');
want((await text()).includes('MY UNSAVED EDIT'), 'the unsaved edit is still there');
want(JSON.stringify(await pending()) === '["Outside card one"]', `the new card is pending (orange): ${JSON.stringify(await pending())}`);
want(await win.locator('.doc-row i[aria-label="unsaved"]').count() === 1, 'the doc is still unsaved (the edit is not on disk yet)');
await win.evaluate(() => { const el = [...document.querySelectorAll('.ProseMirror .f-pending-head')][0]; el?.scrollIntoView({ block: 'center' }); });
await win.waitForTimeout(300);
await shot('sync-1-new-card.png');

// 2. the same paragraph changed on disk too: a true conflict, so Falcon asks
outside((xml) => {
  const end = xml.indexOf('</w:p>', [...xml.matchAll(/<w:p[ >]/g)][k].index);
  return `${xml.slice(0, end)}<w:r><w:t xml:space="preserve"> FILE EDIT</w:t></w:r>${xml.slice(end)}`;
});
const asked = await until(() => win.$('.cf.ch'));
want(!!asked && /changed on disk/.test(await win.$eval('.cf.ch h2', (h) => h.textContent)), 'a card changed on both sides opens the "changed on disk" dialog');
await win.waitForTimeout(300);
await shot('sync-2-conflict.png');
await win.click('.cf.ch button:has-text("Keep both")');
await win.waitForTimeout(400);
const t2 = await text();
want(t2.includes('MY UNSAVED EDIT') && t2.includes('FILE EDIT'), 'Keep both: my version and the file\'s are both in the doc');
want((await pending()).length === 2, `the file's version came in as a pending copy: ${JSON.stringify(await pending())}`);

// 3. a write right before Save: the save is refused, the change merged in, then saved
outside((xml) => { const at = tagStarts(xml)[20]; return xml.slice(0, at) + newCard('outside2', 'Outside card two', 'outside body two') + xml.slice(at); });
await win.keyboard.press(`${mod}+s`);
const saved = await until(async () => (await win.locator('.doc-row i[aria-label="unsaved"]').count()) === 0, 8000);
const disk = strFromU8(unzipSync(fs.readFileSync(doc))['word/document.xml']);
want(!!saved, 'Save finished (after merging the last-second change)');
want(['MY UNSAVED EDIT', 'FILE EDIT', 'Outside card one', 'Outside card two'].every((s) => disk.includes(s)), 'the saved file has my edit and every outside change');
want((disk.match(/_fcp_/g) ?? []).length === 3, `three cards are still pending in the file: ${(disk.match(/_fcp_/g) ?? []).length}`);
const s3 = status()?.docs?.find((d) => d.path === doc);
want(s3 && s3.unsaved === false && !!s3.savedAt, `open-docs.json: saved, with savedAt: ${JSON.stringify(s3)}`);
await shot('sync-3-saved.png');

await app.close();
want(JSON.stringify(status()?.docs) === '[]', 'quitting empties open-docs.json');
want(!errors.length, `page errors: ${errors.join('; ')}`);
console.log(`${results.join('\n')}\nshots: ${shots}`);
process.exitCode = results.some((r) => r.startsWith('FAIL')) ? 1 : 0;
