// Save As: the dialog, and each of its four copies (As-Is, Send, Read, Marked), reopened and checked.
import path from 'node:path';
import { openFalcon, SEED, MOD } from '../lib/falcon.mjs';

const f = await openFalcon('save-as');
const { page } = f;
await f.open(SEED);

// an analytic after the Economy card, and a red reading marker in the Warming card
await f.select('next year.');
await page.keyboard.press('ArrowRight');
await page.keyboard.press('Enter');
await page.keyboard.type('They concede growth');
await page.keyboard.press(`${MOD}+F7`);
await f.select('finds this line.');
await page.keyboard.press('ArrowRight');
await page.keyboard.press(`${MOD}+Shift+D`);
const before = await f.markMap();
f.want(/analytic: They concede growth/.test(before), 'analytic typed');
f.want(/Marked/.test(before), 'red marker dropped');
await f.shot('doc-before');

const dialog = page.locator('.cf.sa');
async function saveAs(mode, file) {
  await page.click('.tools [aria-label="Save As…"]');
  await dialog.waitFor();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`.sa-mode[data-mode="${mode}"]`)]);
  const p = path.join(f.out, file);
  await dl.saveAs(p);
  f.want(dl.suggestedFilename() === 'seed.docx', `${mode}: downloaded ${dl.suggestedFilename()}`);
  return p;
}
// reopen the copy, read it, then go back to the original so the next Save As starts from it
const reopen = async (p) => {
  await f.open(p);
  const m = await f.markMap();
  await f.shot(`${path.basename(p, '.docx')}-reopened`);
  await page.hover('.fstrip');
  await page.click('.doc-row .doc-nm[aria-label="seed"]');
  await page.mouse.move(1100, 500); // off the files panel, so it slides away
  await page.waitForTimeout(600);
  return m;
};

// the dialog itself
await page.click('.tools [aria-label="Save As…"]');
await dialog.waitFor();
f.want(await page.locator('.sa-mode').count() === 4, 'dialog offers four kinds of save');
await page.waitForFunction(() => document.querySelector('.sa-name')?.value);
f.want(await page.locator('.sa-name').inputValue() === 'seed.docx', 'name field filled with the doc name');
await page.waitForTimeout(400); // past the fade-in
await f.shot('dialog');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
f.want(await dialog.count() === 0, 'Esc closes it');

f.want((await f.markMap()) === before, 'the open doc is unchanged by the copies');
const send = await reopen(await saveAs('send', 'send.docx'));
f.want(!/analytic:/.test(send) && /tag: Growth is slowing/.test(send) && /next year\./.test(send) && /needle/.test(send), 'Send Doc: no analytics, cards kept');

const read = await reopen(await saveAs('read', 'read.docx'));
f.want(/two percent/.test(read) && !/growth will fall to/.test(read) && !/Temperatures rose/.test(read) && /tag: Warming is real/.test(read), 'Read Doc: only headings, cites, highlights, markers');

// a red reading stamp alone doesn't mark a card: nothing is saved, and the toast says why
await page.click('.tools [aria-label="Save As…"]');
await dialog.waitFor();
let downloaded = false;
page.once('download', () => { downloaded = true; });
await page.click('.sa-mode[data-mode="marked"]');
await page.waitForTimeout(500);
f.want(!downloaded && /No marked cards/.test(await page.locator('.toast').innerText().catch(() => '')), 'Marked Doc: a stamp-only doc saves nothing and says so');
await f.shot('marked-none');

f.want((await f.markMap()) === before, 'the open doc is still unchanged after all copies');

// a card turned all red is marked: only it survives, under its headings
await f.open(path.join(path.dirname(SEED), 'marked.docx'));
const [dl] = await Promise.all([page.waitForEvent('download'), (async () => {
  await page.click('.tools [aria-label="Save As…"]'); await dialog.waitFor(); await page.click('.sa-mode[data-mode="marked"]');
})()]);
const mp = path.join(f.out, 'marked-out.docx');
await dl.saveAs(mp);
await f.open(mp);
const marked = await f.markMap();
await f.shot('marked-reopened');
f.want(marked.trim().split('\n').join('|') === ['pocket: Seed Pocket', 'hat: Seed Hat', 'block: Marked Block', 'tag: [Trade is collapsing]{color}', 'normal: [Lee 25]{cite+color}[ [cite]]{color}', 'normal: [Tariffs ]{color}[cut trade in half]{color+highlight:yellow+underline}[ this year.]{color}'].join('|'), 'Marked Doc: only the all-red card, under its headings');
console.log('--- send\n' + send + '\n--- read\n' + read + '\n--- marked\n' + marked);
await f.done();
