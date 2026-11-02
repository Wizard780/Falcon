// The F-keys and the format grid on a real selection: paragraph styles, cite, underline, emphasis,
// highlight, and Clear, each checked in the mark map and on screen.
import fs from 'node:fs';
import { openFalcon, SEED } from '../lib/falcon.mjs';

const f = await openFalcon('card-formatting');
const { page, want } = f;
await f.open(SEED);
const line = async (start) => (await f.markMap()).split('\n').find((l) => l.replace(/[[\]]|\{[^}]*\}/g, '').includes(start));
fs.writeFileSync(`${f.out}/before.markmap.txt`, (await f.markMap()) + '\n');
await f.shot('before');

await f.select('Temperatures rose again.'); await page.keyboard.press('F9');
want((await line('Temperatures')).includes('[Temperatures rose again.]{underline}'), 'F9 underlines the selection');
await f.select('rose'); await page.keyboard.press('F11');
want((await line('Temperatures')).includes('[rose]{highlight:yellow+underline}'), 'F11 highlights in the default yellow');
await f.select('needle'); await page.keyboard.press('F10');
want((await line('Temperatures')).includes('[needle]{emphasis}'), 'F10 applies emphasis');
await f.select('this line'); await page.click('.toolbar button[title^="Cite (F8)"]');
want((await line('Temperatures')).includes('[this line]{cite}'), 'the Cite button in the grid applies cite');
await f.shot('marked');

await f.select('Warming is real'); await page.keyboard.press('F6');
want((await line('Warming is real')).startsWith('block: '), 'F6 turns the tag line into a block');
await page.click('.toolbar button[title^="Tag (F7)"]');
want((await line('Warming is real')).startsWith('tag: '), 'the Tag button turns it back into a tag');

await f.select('Temperatures rose again. The needle finds this line.'); await page.keyboard.press('F12');
// Verbatim's Clear keeps highlight and shading (CLEAR_KEEPS), so only the highlight on "rose" stays
want((await line('Temperatures')) === 'normal: Temperatures [rose]{highlight:yellow} again. The needle finds this line.', 'F12 clears underline, emphasis and cite but keeps the highlight');
fs.writeFileSync(`${f.out}/after.markmap.txt`, (await f.markMap()) + '\n');
await f.shot('cleared');
await f.done();
