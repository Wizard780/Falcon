import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { docToDocx } from '../src/docx/export';
import { docxToDoc } from '../src/docx/import';
import { markMap } from '../src/editor/editor';
import { falconKeys as K } from '../src/editor/keymap';
import { make, run, select } from './helpers';

describe('docx round trip', () => {
  it('keeps styles and marks through save and open', async () => {
    let s = make([['pocket', '1AC'], ['hat', 'Adv'], ['block', 'Uniqueness'], ['tag', 'Grid tag here'], ['normal', 'Smith 24, Professor\tat MIT'], ['normal', 'The rapid expansion of AI has pushed utilities to their limits.'], ['analytic', 'An analytic'], ['undertag', 'an undertag']]);
    s = run(select(s, 'Smith 24'), K.F8);
    s = run(select(s, 'pushed utilities'), K.F9);
    s = run(select(s, 'utilities'), K.F11);
    s = run(select(s, 'their'), K.F10);
    s = run(select(s, 'rapid'), K['Mod-F11']);
    s = run(select(s, 'Grid'), K['Mod-b']);
    s = run(select(s, 'The rapid', 'AI'), K['Mod-8']);
    const back = await docxToDoc(await docToDocx(s.doc));
    expect(markMap(back)).toBe(markMap(s.doc));
  });

  it('deep turquoise saves as Turquoise with a deep turquoise fill (Word has no deep turquoise) and opens as deep turquoise', async () => {
    const { schema } = await import('../src/editor/schema');
    const { unzipSync, strFromU8 } = await import('fflate');
    const M = schema.marks;
    const doc = schema.node('doc', null, [schema.node('paragraph', { style: 'normal' }, [
      schema.text('sky', [M.highlight.create({ color: 'deepTurquoise' })]), schema.text(' plain '),
      schema.text('turq', [M.highlight.create({ color: 'cyan' })]),
    ])]);
    const bytes = await docToDocx(doc);
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(xml).toContain('<w:highlight w:val="cyan"/><w:shd w:val="clear" w:color="auto" w:fill="00DAFF"/>');
    expect(xml).not.toContain('deepTurquoise');
    const back = await docxToDoc(bytes);
    expect(markMap(back)).toBe(markMap(doc));
  });
});

// Local-only: FALCON_DOCX="a.docx:b.docx" npx vitest run tests/docx.test.ts
const real = (process.env.FALCON_DOCX ?? '').split(':').filter(Boolean);
describe.skipIf(!real.length)('real Verbatim files', () => {
  for (const f of real) {
    it(`imports and round-trips ${f.split('/').pop()}`, async () => {
      const t0 = performance.now();
      const doc = await docxToDoc(new Uint8Array(fs.readFileSync(f)));
      const t1 = performance.now();
      const counts: Record<string, number> = {};
      doc.forEach((p) => { counts[p.attrs.style] = (counts[p.attrs.style] ?? 0) + 1; });
      const marks: Record<string, number> = {};
      doc.descendants((n) => { for (const m of n.marks) marks[m.type.name] = (marks[m.type.name] ?? 0) + 1; return true; });
      console.log(f.split('/').pop(), `${Math.round(t1 - t0)}ms`, JSON.stringify(counts), JSON.stringify(marks));
      expect(doc.childCount).toBeGreaterThan(0);
      const back = await docxToDoc(await docToDocx(doc));
      expect(markMap(back)).toBe(markMap(doc));
    }, 60000);
  }
});
