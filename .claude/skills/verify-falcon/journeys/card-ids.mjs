// Every heading gets a hidden card id on open, keeps it through edits, and saves it as a _fc_ bookmark that
// a fresh browser reads back. FALCON_DOC=<a copy of a real block file> drives a real file; default is the seed.
import fs from 'node:fs';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { openFalcon, SEED } from '../lib/falcon.mjs';

const DOC = process.env.FALCON_DOC || SEED;
const name = path.basename(DOC, '.docx');
// [style, text, id] for every top-level heading, read from the editor state (evidence only)
const heads = (page) => page.evaluate(() => {
  const out = [];
  window.__falconView.state.doc.forEach((n) => { if (['pocket', 'hat', 'block', 'tag', 'analytic'].includes(n.attrs.style)) out.push([n.attrs.style, n.textContent, n.attrs.card]); });
  return out;
});

const f = await openFalcon('card-ids');
const { page, want } = f;
await f.open(DOC);
want(await page.locator('.doc-row i[aria-label="unsaved"]').count() === 0, 'opening the file leaves it clean (ids are given on open, not as an edit)');
const opened = await heads(page);
const ids = opened.map((h) => h[2]);
want(opened.length > 0 && ids.every((id) => /^[a-z0-9]{8}$/.test(id ?? '')), `all ${opened.length} headings have an id`);
want(new Set(ids).size === ids.length, 'no two headings share an id');
fs.writeFileSync(`${f.out}/opened.ids.txt`, opened.map((h) => h.join('\t')).join('\n') + '\n');

// show the hidden ids beside each heading, for this screenshot only
const tag = opened.find((h) => h[0] === 'tag');
await page.evaluate((t) => {
  const s = document.createElement('style');
  s.id = 'show-ids';
  s.textContent = '[data-card]::after{content:"  id " attr(data-card);font:600 11px ui-monospace,monospace;color:#c2410c;background:#fff7ed;padding:1px 4px;border-radius:3px;margin-left:8px}';
  document.head.append(s);
  const el = [...document.querySelectorAll('.ProseMirror [data-card]')].find((e) => e.textContent === t);
  el?.scrollIntoView({ block: 'center' });
}, tag[1]);
await page.waitForTimeout(300);
await f.shot('ids-shown');
await page.evaluate(() => document.getElementById('show-ids')?.remove());

// edit the first tag: its id stays
await f.select(tag[1].slice(0, 12));
await page.keyboard.type('EDITED ');
const edited = await heads(page);
const now = edited.find((h) => h[2] === tag[2]);
want(now?.[1].startsWith('EDITED '), `typing in tag "${tag[1].slice(0, 30)}" keeps its id ${tag[2]}`);
want(edited.length === opened.length && edited.every((h, i) => h[2] === ids[i]), 'every other heading keeps its id');

const saved = await f.save(`${name}-saved.docx`);
const xml = strFromU8(unzipSync(fs.readFileSync(saved), { filter: (x) => x.name === 'word/document.xml' })['word/document.xml']);
const marks = xml.match(/w:name="_fc_[a-z0-9]+"/g) ?? [];
want(marks.length === opened.length, `saved file holds ${marks.length} _fc_ bookmarks (one per heading)`);
await f.done();

// a fresh browser reads the saved ids back
const g = await openFalcon('card-ids/reopen');
await g.open(saved);
const reopened = await heads(g.page);
g.want(JSON.stringify(reopened) === JSON.stringify(edited), 'reopened file has the same headings with the same ids');
await g.shot('reopened');
await g.done();
