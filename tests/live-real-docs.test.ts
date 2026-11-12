// Going live must never change a real document: each .docx goes through what a session does to it (the editor's own
// state, the repair of what comes from Loro, Loro and back, a host and a joiner attaching) and must come out the same.
// The repo's fixtures always run; more real files locally: FALCON_DOCX="a.docx:b.docx" npx vitest run tests/live-real-docs.test.ts
import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { EditorView } from 'prosemirror-view';
import { docxToDoc } from '../src/docx/import';
import { createState, createView, markMap } from '../src/editor/editor';
import { docOf, liveState, newBinding, repairDoc, seed } from '../src/collab/live-doc';

const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));
beforeAll(() => {
  Object.assign(document, { elementFromPoint: () => null });
  const zero = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => zero as DOMRect;
  Element.prototype.scrollIntoView = () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});

const FIXTURES = ['seed', 'marked', 'media'].map((n) => `.claude/skills/verify-falcon/fixtures/${n}.docx`);
const files = [...FIXTURES, ...(process.env.FALCON_DOCX ?? '').split(':').filter(Boolean)];

describe('going live leaves a real document as it was', () => {
  for (const f of files) {
    it(f.split('/').pop()!, async () => {
      const doc = createState(await docxToDoc(new Uint8Array(fs.readFileSync(f)))).doc; // as the editor holds it
      if (process.env.FALCON_DOCX) { const n: Record<string, number> = {}; doc.descendants((x) => { n[x.type.name] = (n[x.type.name] ?? 0) + 1; return true; }); console.log('LIVE-DOC', f.split('/').pop(), doc.childCount, 'blocks', n.table ?? 0, 'tables', n.image ?? 0, 'images', n.footnote ?? 0, 'footnotes'); }
      expect(repairDoc(doc)).toBe(doc); // nothing a real file has is taken for something to repair
      const hb = newBinding(); hb.doc.setPeerId(1n);
      seed(hb, doc);
      expect(docOf(hb)!.eq(doc)).toBe(true); // into Loro and back, the same
      // a host and a joiner attach, and trade whatever attaching wrote
      const mount = (b: typeof hb, d: typeof doc) => { const el = document.createElement('div'); document.body.append(el); return createView(el, () => {}, liveState(createState(d), b, { name: 'x', color: '#2563eb' })); };
      const host: EditorView = mount(hb, doc);
      const jb = newBinding(); jb.doc.setPeerId(2n);
      jb.doc.import(hb.doc.export({ mode: 'snapshot' }));
      const joiner: EditorView = mount(jb, docOf(jb)!);
      await tick();
      for (let i = 0; i < 2; i++) {
        jb.doc.import(hb.doc.export({ mode: 'update', from: jb.doc.oplogVersion() }));
        hb.doc.import(jb.doc.export({ mode: 'update', from: hb.doc.oplogVersion() }));
        await tick();
      }
      expect(host.state.doc.eq(doc)).toBe(true);
      expect(markMap(joiner.state.doc)).toBe(markMap(doc));
      expect(joiner.state.doc.eq(doc)).toBe(true);
      host.destroy(); joiner.destroy();
      document.body.innerHTML = '';
    }, 120_000);
  }
});
