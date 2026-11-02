// Keybindings: rebind Tag and Find in Settings by pressing new keys, see the old keys stop and the new ones
// work, see a taken key refused with a reason, Esc cancel, Backspace remove, the arrow and Restore defaults
// put keys back, and a new key survive a reload.
import { openFalcon, SEED, MOD } from '../lib/falcon.mjs';

const f = await openFalcon('keybindings');
const { page, want } = f;
const M = 'Mod'; // saved keys say Mod on every platform
await f.open(SEED);

const openKeys = async () => {
  await page.click('.fstrip [aria-label="Settings"]');
  await page.waitForTimeout(250);
  await page.click('[aria-label="Settings sections"] button:has-text("Keybindings")');
  await page.waitForTimeout(150);
};
const field = (label) => page.locator(`.st-keyb[aria-label^="${label}:"]`).first();
const stored = (id) => page.evaluate((k) => localStorage.getItem(`falcon.key.${k}`), id);
const hintOf = (label) => page.locator('.st-row', { has: field(label) }).locator('.st-txt small').textContent().catch(() => null);
const close = async () => { await page.click('[aria-label="Close settings"]'); await page.waitForTimeout(200); };

await openKeys();
await f.shot('keybindings-page');

// rebind Tag: click its keys, press the new ones
await field('Tag').click();
await page.waitForTimeout(100);
want(await field('Tag').getAttribute('data-listen') === 'true', 'clicking the field listens');
want((await field('Tag').textContent()).includes('Type a shortcut'), 'listening field says Type a shortcut');
await page.keyboard.down(MOD); await page.keyboard.down('Shift');
await page.waitForTimeout(80);
await f.shot('listening-modifiers-held');
await page.keyboard.press('KeyY');
await page.keyboard.up('Shift'); await page.keyboard.up(MOD);
await page.waitForTimeout(200);
want(await stored('tag') === `${M}-Shift-y`, `Tag stored as ${await stored('tag')}`);
want(await page.locator('.st-row', { has: field('Tag') }).locator('.st-keyreset').count() === 1, 'a changed key shows the reset arrow');
await f.shot('tag-rebound');

// a key another command has is refused, with the reason
await field('Pocket').click();
await page.keyboard.press('F9');
await page.waitForTimeout(150);
want(await stored('pocket') === null, 'Pocket keeps F4 when F9 is refused');
const why = await hintOf('Pocket');
want(why === 'F9 is already Underline', `refusal says why: ${why}`);
await f.shot('refused');

// Esc cancels and leaves Settings open; Backspace removes a shortcut
await field('Hat').click();
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
want(await page.locator('.st').count() === 1, 'Esc while listening cancels without closing Settings');
want(await stored('hat') === null, 'Hat keeps F5 after Esc');
await field('Block').click();
await page.keyboard.press('Backspace');
await page.waitForTimeout(150);
want(await stored('block') === '', 'Backspace removes Block\'s shortcut');
want((await field('Block').textContent()).includes('Set shortcut'), 'a removed shortcut shows Set shortcut');
await page.locator('.st-row', { has: field('Block') }).locator('.st-keyreset').click();
want(await stored('block') === null, 'the reset arrow puts F6 back');

// an app command: Find
await field('Find').click();
await page.keyboard.press(`${MOD}+Alt+KeyK`);
await page.waitForTimeout(150);
want(await stored('find') === `${M}-Alt-k`, `Find stored as ${await stored('find')}`);
// search finds a shortcut by its key
await page.fill('[aria-label="Search settings"]', 'F8');
await page.waitForTimeout(150);
const found = await page.$$eval('.st-row .st-txt > span', (s) => s.map((x) => x.textContent));
want(found.includes('Cite'), `searching F8 finds Cite (${found.join(', ')})`);
await page.fill('[aria-label="Search settings"]', '');
await close();

// the editor answers to the new key and not the old one
const tagTitle = await page.$eval('.toolbar button:is([title^="Tag"], [data-tip^="Tag"])', (b) => b.title || b.dataset.tip);
want(/^Tag \(⌘⇧Y\)|^Tag \(Ctrl\+Shift\+Y\)/.test(tagTitle), `Tag button tip shows the new key: ${tagTitle}`);
await f.select('Temperatures');
const before = await f.markMap();
await page.keyboard.press('F7');
want((await f.markMap()) === before, 'F7 no longer makes a tag');
await page.keyboard.press(`${MOD}+Shift+KeyY`);
want((await f.markMap()).includes('tag: Temperatures rose again'), 'the new key makes a tag');
await f.shot('new-key-tagged');

// the app answers to the new Find key and not the old one
await page.keyboard.press(`${MOD}+KeyF`);
await page.waitForTimeout(150);
want(await page.locator('.findbar').count() === 0, 'the old Find key does nothing');
await page.keyboard.press(`${MOD}+Alt+KeyK`);
await page.waitForTimeout(150);
want(await page.locator('.findbar').count() === 1, 'the new Find key opens Find');
await page.keyboard.press('Escape');

// read mode locks the keyboard, but its rebound key still turns it on and back off
await openKeys();
await field('Read mode').click();
await page.keyboard.press(`${MOD}+Alt+KeyR`);
await page.waitForTimeout(150);
want(await stored('read') === `${M}-Alt-r`, `Read mode stored as ${await stored('read')}`);
await close();
await page.click('.ProseMirror');
const reading = () => page.$eval('.ProseMirror', (x) => x.classList.contains('f-read'));
await page.keyboard.press(`${MOD}+Alt+KeyR`);
await page.waitForTimeout(150);
want(await reading(), 'the new Read mode key turns read mode on');
await page.keyboard.press(`${MOD}+Alt+KeyR`);
await page.waitForTimeout(150);
want(!(await reading()), 'and, with the keyboard locked, turns it back off');

// survives a reload; Restore defaults brings everything back
await page.reload(); await page.waitForSelector('.ProseMirror'); await page.keyboard.press('Escape');
await openKeys();
want((await field('Tag').getAttribute('aria-label')).includes('⇧') || (await field('Tag').getAttribute('aria-label')).includes('Shift'), 'Tag keeps its new key after a reload');
await page.click('.st-restore');
await page.waitForTimeout(150);
want(await stored('tag') === null && await stored('find') === null, 'Restore defaults forgets the keys');
want((await field('Tag').getAttribute('aria-label')).startsWith('Tag: F7'), 'Tag shows F7 again');
await f.shot('restored');
await close();
await f.done();
