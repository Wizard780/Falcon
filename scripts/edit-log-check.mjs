// The record of the user's edits, in the desktop app with no visible window, on a COPY of FALCON_DOC (default: the
// verify seed): retag a card, highlight a word, delete a card, move a card, then read edits/<hash>.json. Save, quit
// and relaunch: the record carries on. Another program writes the file: the record starts over, and approving the
// card it added is recorded. node scripts/edit-log-check.mjs   (FALCON_SHOTS=<dir> keeps the screenshots)
import { _electron as electron } from 'playwright';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
env.FALCON_USER_DATA = fs.mkdtempSync(`${os.tmpdir()}/falcon-edits-`);
const src = process.env.FALCON_DOC || '.claude/skills/verify-falcon/fixtures/seed.docx';
const doc = path.join(fs.mkdtempSync(`${os.tmpdir()}/falcon-edits-doc-`), path.basename(src));
fs.copyFileSync(src, doc);
const name = path.basename(doc, '.docx');
const shots = process.env.FALCON_SHOTS || fs.mkdtempSync(`${os.tmpdir()}/falcon-edits-shots-`);
fs.mkdirSync(shots, { recursive: true });
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const status = () => readJson(path.join(env.FALCON_USER_DATA, 'open-docs.json'));
const results = [];
const want = (ok, what) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`); return ok; };
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await f(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } return null; };
const errors = [];

async function launch() {
  const app = await electron.launch({ args: ['.', doc], env: { ...env, FALCON_HEADLESS: '1' } });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push(e.message));
  await win.waitForSelector('.ProseMirror');
  await win.keyboard.press('Escape');
  await win.waitForSelector(`.doc-row .doc-nm[aria-label="${name}"]`, { timeout: 15000 });
  return { app, win };
}
// the caret at the end of (or a selection over the first `words` words of) the paragraph `pick` finds, through the editor
const place = (win, pick, words = 0) => win.evaluate(([pick, words]) => {
  const v = window.__falconView; const f = new Function('n', 'i', 'list', `return (${pick})(n, i, list)`);
  const list = []; v.state.doc.forEach((n, pos, i) => list.push({ n, pos, i }));
  const hit = list.find(({ n, i }) => f(n, i, list));
  const S = v.state.selection.constructor;
  if (words) { const t = hit.n.textContent; const end = t.split(' ').slice(0, words).join(' ').length; v.dispatch(v.state.tr.setSelection(S.create(v.state.doc, hit.pos + 1, hit.pos + 1 + end))); }
  else v.dispatch(v.state.tr.setSelection(S.near(v.state.doc.resolve(hit.pos + hit.n.nodeSize - 1), -1)));
  v.focus();
  return hit.n.attrs.card ?? null;
}, [pick, words]);
const tags = (win) => win.evaluate(() => { const o = []; window.__falconView.state.doc.forEach((n) => { if (n.attrs.style === 'tag') o.push([n.attrs.card, n.textContent]); }); return o; });

let { app, win } = await launch();
const t0 = await tags(win);
const [retag, light, gone, moved] = [t0[2], t0[4], t0[6], t0[9]];
// 1. retag: type at the end of a tag
await place(win, `(n) => n.attrs.card === '${retag[0]}'`);
await win.keyboard.type(' RETAGGED');
// 2. highlight the first two words of the first body paragraph of another card
await place(win, `(n, i, l) => n.attrs.style === 'normal' && n.textContent.trim() && l.slice(0, i).reverse().find((x) => x.n.attrs.style === 'tag')?.n.attrs.card === '${light[0]}' && l[i - 1].n.attrs.style === 'normal'`, 2);
await win.keyboard.press('F11');
// 3. delete a card
await place(win, `(n) => n.attrs.card === '${gone[0]}'`);
await win.keyboard.press(`${mod}+Alt+Backspace`);
// 4. move a card down twice
await place(win, `(n) => n.attrs.card === '${moved[0]}'`);
await win.keyboard.press(`${mod}+Alt+ArrowDown`);
await win.keyboard.press(`${mod}+Alt+ArrowDown`);

const editsFile = await until(() => status()?.docs?.find((d) => d.path === doc)?.edits);
want(!!editsFile, `open-docs.json points at the edit record: ${editsFile}`);
const by = (rec) => Object.fromEntries((rec?.cards ?? []).map((c) => [c.id, c.changes.join('+')]));
const rec1 = await until(() => { const r = readJson(editsFile); return r && r.cards.length >= 4 ? r : null; });
const m1 = by(rec1);
want(m1[retag[0]] === 'tag', `retagged card: ${m1[retag[0]]} ("${retag[1].slice(0, 40)}")`);
want(m1[light[0]] === 'highlight', `highlighted card: ${m1[light[0]]}`);
want(m1[gone[0]] === 'removed', `deleted card: ${m1[gone[0]]}`);
want(m1[moved[0]] === 'moved', `moved card: ${m1[moved[0]]}`);
want(rec1?.cards.length === 4, `nothing else recorded: ${JSON.stringify(m1)}`);
const after = rec1?.cards.find((c) => c.id === light[0])?.after?.find((p) => p.runs.some((r) => r.marks.some((m) => m.startsWith('highlight'))));
want(!!after, `the highlighted card's after has the highlight run: ${JSON.stringify(after?.runs.find((r) => r.marks.length))}`);
want(rec1?.unsaved === true && rec1?.checkpoint?.why === 'opened' && fs.existsSync(rec1.checkpoint.base), `unsaved, counted from a copy of the file as opened (${rec1?.checkpoint?.why})`);
await win.evaluate((card) => { const el = document.querySelector(`.ProseMirror [data-card="${card}"]`); el?.scrollIntoView({ block: 'center' }); }, retag[0]);
await win.waitForTimeout(300);
await win.screenshot({ path: path.join(shots, 'edits-1-made.png'), timeout: 15000 }).catch(() => {});
fs.writeFileSync(path.join(shots, 'edits-record.json'), JSON.stringify(rec1, null, 2));

// save, quit, relaunch: the record carries on from the same checkpoint
await win.keyboard.press(`${mod}+s`);
const saved = await until(() => readJson(editsFile)?.unsaved === false);
want(!!saved, 'after Save the record says saved');
await app.close();
({ app, win } = await launch());
const rec2 = await until(() => { const r = readJson(editsFile); return r && r.updated !== rec1.updated && r.cards.length ? r : null; });
want(rec2 && rec2.checkpoint.at === rec1.checkpoint.at && JSON.stringify(by(rec2)) === JSON.stringify(m1), `relaunched: same checkpoint, same 4 edits: ${JSON.stringify(by(rec2))}`);

// another program writes the file: the record starts over; approving the card it added is the user's
const files = unzipSync(fs.readFileSync(doc));
const xml = strFromU8(files['word/document.xml']);
const at = [...xml.matchAll(/<w:p\b[^>]*>(?:(?!<\/w:p>).)*?<w:pStyle w:val="Heading4"\/>/gs)][12].index;
files['word/document.xml'] = strToU8(`${xml.slice(0, at)}<w:p><w:pPr><w:pStyle w:val="Heading4"/></w:pPr><w:bookmarkStart w:id="990" w:name="_fcp_claude9"/><w:bookmarkEnd w:id="990"/><w:r><w:t>Claude's new card</w:t></w:r></w:p><w:p><w:r><w:t>new body</w:t></w:r></w:p>${xml.slice(at)}`);
fs.writeFileSync(doc, zipSync(files));
const rec3 = await until(() => { const r = readJson(editsFile); return r && r.checkpoint.why === 'changed-on-disk' ? r : null; });
want(rec3 && rec3.cards.length === 0, `another program's write starts the record over (${rec3?.checkpoint.why}, ${rec3?.cards.length} edits)`);
await until(() => win.evaluate(() => window.__falconView.state.doc.textContent.includes("Claude's new card")));
await place(win, `(n) => n.attrs.card === 'claude9'`);
await win.keyboard.press(`${mod}+Shift+Enter`);
const rec4 = await until(() => { const r = readJson(editsFile); return r && r.cards.length ? r : null; });
want(JSON.stringify(by(rec4)) === '{"claude9":"approved"}', `approving Claude's card is recorded: ${JSON.stringify(by(rec4))}`);
await app.close();

want(!errors.length, `page errors: ${errors.join('; ')}`);
console.log(`${results.join('\n')}\nshots: ${shots}`);
process.exitCode = results.some((r) => r.startsWith('FAIL')) ? 1 : 0;
