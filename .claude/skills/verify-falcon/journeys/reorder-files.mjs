// Drag open files up and down the rail and the hover files panel to reorder them.
import { openFalcon } from '../lib/falcon.mjs';

const f = await openFalcon('reorder-files');
const { page } = f;
// a blank Untitled is reused by New, so give each file some text first
const newDoc = async (text) => { await page.click('.ProseMirror'); await page.keyboard.type(text); await page.click('.tools [aria-label="New document"]'); };
await newDoc('one'); await newDoc('two'); await page.click('.ProseMirror'); await page.keyboard.type('three');
const order = (sel) => page.$$eval(sel, (rs) => rs.map((r) => r.dataset.id).join(','));
const active = () => page.$eval('.doc-row[data-on]', (r) => r.dataset.id);
const drag = async (from, to, name) => {
  const a = await from.boundingBox(), b = await to.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  // end a little past the target's middle, the way a hand overshoots
  const dy = b.y - a.y + Math.sign(b.y - a.y) * 8;
  for (let i = 1; i <= 10; i++) await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + (dy * i) / 10);
  await f.shot(`${name}-mid-drag`);
  await page.mouse.up();
};

const before = await order('.fs-docs .doc-row'), was = await active();
const ids = before.split(',');
f.want(ids.length === 3, `three files open (${before})`);
await f.shot('before');

// rail: drag the last icon to the top
let rows = await page.$$('.fs-docs .doc-row');
await drag(rows[2], rows[0], 'rail');
const want1 = [ids[2], ids[0], ids[1]].join(',');
const got1 = await order('.fs-docs .doc-row');
f.want(got1 === want1, `rail drag moves the last file to the top (${before} -> ${got1})`);
f.want(await active() === was, 'the rail drop does not switch files');
f.want(await order('.files-l .files-r') === want1, 'the files panel follows the new order');
await f.shot('after-rail-drag');

// files panel: hover it open, drag the first row to the bottom
await page.hover('.fs-docs .doc-row');
await page.waitForSelector('.files[data-open]');
await page.waitForTimeout(300);
rows = await page.$$('.files-l .files-r');
await drag(rows[0], rows[2], 'panel');
const want2 = [ids[0], ids[1], ids[2]].join(',');
const got2 = await order('.files-l .files-r');
f.want(got2 === want2, `panel drag moves the top file to the bottom (${want1} -> ${got2})`);
f.want(await order('.fs-docs .doc-row') === want2, 'the rail follows the panel');
f.want(await active() === was, 'the panel drop does not switch files');
await f.shot('after-panel-drag');

// a plain click still switches
await page.mouse.move(600, 400);
await page.waitForTimeout(400);
await (await page.$$('.fs-docs .doc-row .doc-nm'))[0].click();
f.want(await active() === ids[0], 'a click without a drag still switches');
f.want(!(await page.$('[data-drag]')), 'no row left lifted');
await f.done();
