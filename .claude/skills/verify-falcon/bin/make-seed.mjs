// Rebuilds fixtures/seed.docx by typing it into Falcon with the real keys and saving it.
// Only needed when the seed's content must change:  falcon-verify run .claude/skills/verify-falcon/bin/make-seed.mjs
import fs from 'node:fs';
import { openFalcon, MOD, SEED } from '../lib/falcon.mjs';

const f = await openFalcon('make-seed');
const { page } = f;
const k = (key) => page.keyboard.press(key);

await page.click('.ProseMirror');
await k(`${MOD}+a`); await k('Backspace');
// plain text first (Enter keeps the marks at the caret, Verbatim-style), then style and mark by selection
const lines = ['Seed Pocket', 'Seed Hat', 'Economy Block', 'Growth is slowing', 'Smith 24', 'Global growth will fall to two percent next year.', 'Warming Block', 'Warming is real', 'Temperatures rose again. The needle finds this line.'];
for (const [i, l] of lines.entries()) { await page.keyboard.type(l); if (i < lines.length - 1) await k('Enter'); }
for (const [text, key] of [['Seed Pocket', 'F4'], ['Seed Hat', 'F5'], ['Economy Block', 'F6'], ['Growth is slowing', 'F7'], ['Warming Block', 'F6'], ['Warming is real', 'F7'], ['Smith 24', 'F8'], ['growth will fall to two percent', 'F9'], ['two percent', 'F11']]) {
  await f.select(text); await k(key);
}
const map = await f.markMap();
fs.writeFileSync(`${f.out}/seed.markmap.txt`, map + '\n');
console.log(map);
f.want(map === fs.readFileSync(new URL('../fixtures/seed.markmap.txt', import.meta.url), 'utf8').trim(), 'seed matches fixtures/seed.markmap.txt');
const saved = await f.save('seed.docx');
fs.copyFileSync(saved, SEED);
f.want(fs.statSync(SEED).size > 1000, `seed written to ${SEED}`);
await f.done();
