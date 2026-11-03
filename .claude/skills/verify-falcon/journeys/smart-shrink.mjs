// Smart Shrink: off, Mod-8 cycles; turn it on in Settings → Editor, and Mod-8 shrinks in one pass
// (unread paragraphs 5 pt, unread words around underlining 8 pt), stays put when pressed again, and survives a reload.
import { openFalcon, SEED, MOD } from '../lib/falcon.mjs';

const f = await openFalcon('smart-shrink');
const { page, want } = f;
const key = (k) => page.keyboard.press(`${MOD}+${k}`);
const line = async (start) => (await f.markMap()).split('\n').find((l) => l.includes(start));
await f.open(SEED);

await f.select('Temperatures'); await page.keyboard.press('ArrowLeft');
await key('8');
want((await line('Temperatures')) === 'normal: [Temperatures rose again. The needle finds this line.]{size:8pt}', `off: first Mod-8 is 8pt: ${await line('Temperatures')}`);
await key('Shift+8');

await page.click('.fstrip [aria-label="Settings"]');
await page.click('[aria-label="Settings sections"] button:has-text("Editor")');
await page.click('[role=switch][aria-label="Smart Shrink"]');
await page.waitForTimeout(200);
want(await page.getAttribute('[role=switch][aria-label="Smart Shrink"]', 'aria-checked') === 'true', 'Smart Shrink switch is on');
want(await page.evaluate(() => localStorage.getItem('falcon.smartShrink')) === 'on', 'stored as falcon.smartShrink=on');
await f.shot('setting-on');
await page.click('[aria-label="Close settings"]');
await page.waitForTimeout(200);

await f.select('Temperatures'); await page.keyboard.press('ArrowLeft');
await key('8');
const unread = await line('Temperatures');
want(unread === 'normal: [Temperatures rose again. The needle finds this line.]{size:5pt}', `unread paragraph to 5pt: ${unread}`);
await key('8');
want((await line('Temperatures')) === unread, 'pressing again changes nothing');

await f.select('Global'); await page.keyboard.press('ArrowLeft');
await key('8');
const mixed = await line('Global');
want(mixed === 'normal: [Global ]{size:8pt}[growth will fall to ]{underline}[two percent]{highlight:yellow+underline}[ next year.]{size:8pt}', `words around underlining to 8pt: ${mixed}`);
want((await line('Smith 24')) === 'normal: [Smith 24]{cite}', 'cite left alone');
await f.shot('smart-shrunk');

await page.reload(); await page.waitForSelector('.ProseMirror'); await page.keyboard.press('Escape');
await page.click('.fstrip [aria-label="Settings"]');
await page.click('[aria-label="Settings sections"] button:has-text("Editor")');
want(await page.getAttribute('[role=switch][aria-label="Smart Shrink"]', 'aria-checked') === 'true', 'still on after a reload');
await f.done();
