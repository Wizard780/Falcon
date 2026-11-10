// Proves an importer change keeps output identical: imports every .docx with src/docx/import.ts and
// records a hash of doc.toJSON() per file, or compares against hashes recorded earlier.
//   node scripts/import-same.mjs save  <hashes.json> <dir | file.docx | list.txt>...
//   node scripts/import-same.mjs check <hashes.json> <dir | file.docx | list.txt>...
// A .txt argument is a list of .docx paths, one per line. Files the importer throws on are recorded as
// errors (and must still throw the same way on check).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'rolldown';

const [mode, hashFile, ...args] = process.argv.slice(2);
if (!['save', 'check'].includes(mode) || !hashFile || !args.length) { console.error('usage: import-same.mjs save|check <hashes.json> <paths>...'); process.exit(2); }

const root = resolve(import.meta.dirname, '..');
const out = join(mkdtempSync(join(tmpdir(), 'import-same-')), 'import.mjs');
await build({ input: join(root, 'src/docx/import.ts'), platform: 'node', logLevel: 'silent', output: { file: out, format: 'esm' } });
const { docxToDoc } = await import(pathToFileURL(out).href);

const files = [];
const add = (p) => {
  const s = statSync(p, { throwIfNoEntry: false });
  if (!s) return;
  if (s.isDirectory()) for (const f of readdirSync(p)) { if (!f.startsWith('~$')) add(join(p, f)); }
  else if (p.endsWith('.txt')) for (const l of readFileSync(p, 'utf8').split('\n')) { if (l.trim()) add(l.trim()); }
  else if (p.endsWith('.docx')) files.push(resolve(p));
};
args.forEach(add);

const old = mode === 'check' ? JSON.parse(readFileSync(hashFile, 'utf8')) : {};
const now = {};
let same = 0, diff = 0, missing = 0, errors = 0;
for (const f of files) {
  let h;
  try { h = createHash('sha256').update(JSON.stringify((await docxToDoc(new Uint8Array(readFileSync(f)))).toJSON())).digest('hex'); }
  catch (e) { h = `error: ${e?.message}`; errors++; }
  now[f] = h;
  if (mode !== 'check') continue;
  if (!(f in old)) missing++;
  else if (old[f] === h) same++;
  else { diff++; console.log(`DIFF ${f}\n  was ${old[f]}\n  now ${h}`); }
}
if (mode === 'save') { writeFileSync(hashFile, JSON.stringify(now, null, 1)); console.log(`saved ${files.length} files (${errors} throw)`); }
else { console.log(`${files.length} files: ${same} same, ${diff} differ, ${missing} not in ${hashFile} (${errors} throw)`); if (diff || missing) process.exit(1); }
