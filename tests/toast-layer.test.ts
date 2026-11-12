// A toast is how a card or an invite coming in is announced. It must draw over every full-window layer
// (a dialog's backdrop, the command center, the switcher), or it shows blurred under the backdrop and is missed.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = (['src'] as const).flatMap(function walk(d: string): string[] {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.css') ? [fs.readFileSync(p, 'utf8')] : [];
  });
}).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

/** Each rule that covers the whole window (position: fixed; inset: 0), with its z-index. */
const layers = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
  .filter(([, , body]) => /position:\s*fixed/.test(body) && /inset:\s*0[;\s]/.test(body))
  .map(([, sel, body]) => ({ sel: sel.trim(), z: Number(/z-index:\s*(\d+)/.exec(body)?.[1] ?? 0) }));
const toastZ = Number(/\.toast\s*\{[^}]*z-index:\s*(\d+)/.exec(css)?.[1]);

describe('the toast layer', () => {
  it('finds the full-window layers', () => {
    for (const s of ['.cf-back', '.cc-back', '.pk-back', '.sw-back', '.st-back']) expect(layers.map((l) => l.sel)).toContain(s);
  });
  it('draws over every one of them', () => {
    for (const l of layers) expect(toastZ, `${l.sel} (${l.z}) covers the toast (${toastZ})`).toBeGreaterThan(l.z);
  });
});
