import { it } from 'vitest';
import fs from 'node:fs';
import { docToDocx } from '../src/docx/export';
import { docxToDoc } from '../src/docx/import';
import { markMap } from '../src/editor/editor';
const f = process.env.FALCON_DIFF;
it.skipIf(!f)('diff', async () => {
  const doc = await docxToDoc(new Uint8Array(fs.readFileSync(f!)));
  const a = markMap(doc).split('\n'), b = markMap(await docxToDoc(await docToDocx(doc))).split('\n');
  let shown = 0;
  for (let i = 0; i < Math.max(a.length, b.length) && shown < 4; i++) if (a[i] !== b[i]) { shown++; { let j = 0; while (a[i]?.[j] === b[i]?.[j]) j++; console.log(`#${i} @${j}\nA: ${a[i]?.slice(Math.max(0, j - 150), j + 150)}\nB: ${b[i]?.slice(Math.max(0, j - 150), j + 150)}`); } }
}, 60000);
