// Times src/docx/import.ts alone on one .docx: median of RUNS imports, plus the process's peak RSS
// after a single cold import (RUNS=1) as a stand-in for the import's memory high-water mark.
//   RUNS=9 node scripts/import-bench.mjs <file.docx>      (IMPORT_TS=<other import.ts> times another copy, e.g. the base commit's)
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'rolldown';

const file = process.argv[2];
const runs = Number(process.env.RUNS ?? 9);
const root = resolve(import.meta.dirname, '..');
const out = join(mkdtempSync(join(tmpdir(), 'import-bench-')), 'import.mjs');
await build({ input: process.env.IMPORT_TS ? resolve(process.env.IMPORT_TS) : join(root, 'src/docx/import.ts'), platform: 'node', logLevel: 'silent', output: { file: out, format: 'esm', minify: process.env.MINIFY === '1' } });
const { docxToDoc } = await import(pathToFileURL(out).href);
const bytes = new Uint8Array(readFileSync(file));
const rss0 = process.memoryUsage().rss;
const ms = [];
let doc;
for (let i = 0; i < runs; i++) {
  const t = performance.now();
  doc = await docxToDoc(bytes);
  ms.push(performance.now() - t);
}
ms.sort((a, b) => a - b);
const peak = process.resourceUsage().maxRSS * 1024;
console.log(JSON.stringify({ file: file.split('/').pop(), paragraphs: doc.childCount, runs, medianMs: Math.round(ms[ms.length >> 1]), minMs: Math.round(ms[0]), peakRssMB: Math.round(peak / 1e6), startRssMB: Math.round(rss0 / 1e6) }));
