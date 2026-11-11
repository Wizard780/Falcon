// Home sits open for hours between rounds: nothing on it may animate forever, or the GPU paints frames the whole time
// (a breathing glow behind the caption's blur cost a quarter of a core).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const css = ['src/styles.css', ...fs.readdirSync('src/ui').filter((f) => f.endsWith('.css')).map((f) => `src/ui/${f}`)]
  .map((f) => fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');

describe('Home at rest', () => {
  it('has no endless animation', () => {
    const endless = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /animation[^;]*\binfinite\b/.test(body))
      .map(([, sel]) => sel.trim())
      .filter((sel) => /\.(home|hm-|cap-|falcon-)/.test(sel));
    expect(endless).toEqual([]);
  });
});
