import { it, expect } from 'vitest';
import { compareTexts } from '../src/editor/doc-tools/compare';
const W = ['the', 'The', 'plan', 'colour', 'color', 'a', 'it’s', "it's", 'war', '.', ',', '\n', '  '];
let seed = 7; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const txt = () => Array.from({ length: 1 + rnd(25) }, () => W[rnd(W.length)]).join(rnd(3) ? ' ' : '');
it('edits rebuild text 2 from text 1', () => {
  for (let t = 0; t < 1500; t++) {
    const a = txt(), b = rnd(2) ? txt() : a.replace(/plan/g, 'war');
    const r = compareTexts(a, b, { ignoreCase: false, ignoreSpace: false });
    let out = '', ia = 0, last = 0;
    for (const e of r.edits) {
      expect(e.aFrom >= ia && e.aTo >= e.aFrom && e.bFrom >= last).toBe(true);
      out += a.slice(ia, e.aFrom) + b.slice(e.bFrom, e.bTo); ia = e.aTo; last = e.bTo;
    }
    out += a.slice(ia);
    let full = out;
    // trimmed edge text: the result must be a slice of b
    if (r.moreBefore || r.moreAfter) expect(b.includes(full), JSON.stringify({ a, b, full })).toBe(true);
    else expect(full, JSON.stringify({ a, b })).toBe(b);
  }
});
