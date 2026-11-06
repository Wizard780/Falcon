// Join: shift-click files in the rail, right-click one, Join shows them side by side, one editor each.
// A click in a pane makes it the one the keys act on; ` sends into a speech doc showing beside you.
// A pane's name bar drags it onto another to swap them; its X takes that file out of the split. Pick one
// file and right-click it: it joins with the open one. Settings > Appearance > Files side by side caps how
// many (default 3). Right-click > Unjoin splits them up.
import { openFalcon, SEED } from '../lib/falcon.mjs';

const f = await openFalcon('join-files');
const { page, want } = f;
await f.open(SEED);
const seed = await f.markMap();

const NAMES = ['seed', 'Speech (speech doc)', 'Untitled'];
/** A rail row by file: 0 seed, 1 Speech, 2 Untitled. */
const row = (i) => page.locator('.fs-docs .doc-row', { has: page.locator(`.doc-nm[aria-label="${NAMES[i]}"]`) });
const away = () => page.mouse.move(900, 700); // the files panel slides out over the page while the pointer is on the rail
const panes = () => page.$$eval('.split .pane', (ps) => ps.map((p) => ({ name: p.querySelector('.pane-h .nm')?.textContent, on: p.hasAttribute('data-on'), text: p.querySelector('.ProseMirror').textContent, w: Math.round(p.getBoundingClientRect().width) })));
const joined = () => page.evaluate(() => document.querySelector('.app').hasAttribute('data-split'));

// a speech doc to send into, the usual way (first send makes it)
await page.click('.ProseMirror :text("Global")');
await page.keyboard.press('Backquote');
await page.waitForTimeout(300);
await page.click('.tools [aria-label="New document"]');
await page.click('.cf .sa-mode:has-text("Blank Doc")');
await page.waitForTimeout(200);
want((await page.locator('.fs-docs .doc-row').count()) === 3, 'three files open: seed, Speech, Untitled');

await row(0).locator('.doc-nm').click({ modifiers: ['Shift'] });
await row(1).locator('.doc-nm').click({ modifiers: ['Shift'] });
await away();
want((await row(0).getAttribute('data-sel')) !== null && (await row(1).getAttribute('data-sel')) !== null && (await row(2).getAttribute('data-sel')) === null, 'shift-click picks seed and Speech');
want(!(await joined()), 'picking does not open anything');
await f.shot('picked');
await row(1).click({ button: 'right' });
await page.waitForTimeout(200);
want((await page.textContent('.rail-menu')).includes('2 files selected'), 'the right-click menu says how many are picked');
await f.shot('menu');
await page.click('.rail-menu .mn-i:has-text("Join")');
await away();
await page.waitForTimeout(400);
let ps = await panes();
want(await joined(), 'Join shows the split');
want(ps.length === 2 && ps[0].name === 'seed' && ps[1].name === 'Speech', `two panes, seed then Speech: ${JSON.stringify(ps.map((p) => p.name))}`);
want(Math.abs(ps[0].w - ps[1].w) <= 2 && ps[0].w > 300, `the panes share the width: ${ps.map((p) => p.w)}`);
await f.shot('joined');

// click into the left pane, send a card: it lands in the Speech pane on the right
await page.locator('.split .pane').nth(0).locator('.ProseMirror :text("Warming Block")').click();
await page.waitForTimeout(150);
ps = await panes();
want(ps[0].on && !ps[1].on, 'clicking into seed focuses its pane');
want((await f.markMap()) === seed, 'the toolbar and keys act on seed (its mark map)');
const before = ps[1].text;
await page.keyboard.press('Backquote');
await page.waitForTimeout(400);
ps = await panes();
want(ps[1].text.length > before.length && ps[1].text.includes('Warming Block'), 'the send shows up in the Speech pane beside it');
want((await page.locator('.fs-docs .doc-row').count()) === 3, 'no second speech doc');
await f.shot('sent-into-pane');

// the outline shows the focused file's headings, and its clicks jump in that pane
const outline = () => page.$$eval('.sb-row.ol', (rs) => rs.map((r) => r.textContent.replace(/\d+$/, '').trim()));
const seedOutline = await outline();
want(seedOutline.includes('Seed Pocket') && seedOutline.includes('Economy Block'), `seed focused: the outline lists seed's headings: ${JSON.stringify(seedOutline)}`);
await page.locator('.split .pane').nth(1).locator('.ProseMirror :text("Warming Block")').click();
await page.waitForTimeout(400);
const speechOutline = await outline();
want(!speechOutline.includes('Seed Pocket') && speechOutline.includes('Warming Block'), `Speech focused: the outline switches to Speech's headings: ${JSON.stringify(speechOutline)}`);
await f.shot('outline-follows-speech');
await page.locator('.split .pane').nth(0).locator('.ProseMirror :text("Seed Hat")').click();
await page.waitForTimeout(400);
want(JSON.stringify(await outline()) === JSON.stringify(seedOutline), 'back in seed: its outline comes back');
await page.click('.sb-row.ol:has-text("Warming Block")');
await page.waitForTimeout(500);
ps = await panes();
want(ps[0].on && (await page.evaluate(() => window.__falconView.state.selection.$head.parent.textContent)) === 'Warming Block', 'an outline click jumps in the focused pane (seed), not the other one');

// type in the right pane
await page.locator('.split .pane').nth(1).locator('.ProseMirror').click();
await page.keyboard.press('End');
await page.keyboard.type(' zz');
await page.waitForTimeout(200);
ps = await panes();
want(ps[1].on && ps[1].text.includes('zz') && !ps[0].text.includes('zz'), 'typing goes into the focused pane only');

// another file shows alone; coming back shows the pair as it was
await row(2).locator('.doc-nm').click();
await away();
await page.waitForTimeout(300);
want(!(await joined()), 'the Untitled file shows alone');
await row(0).locator('.doc-nm').click();
await away();
await page.waitForTimeout(300);
ps = await panes();
want((await joined()) && ps[1].text.includes('zz'), 'back on seed: the pair shows again with the typing kept');

// drag a pane by its name onto the other: they swap, in the split and in the rail
const railOrder = () => page.$$eval('.fs-docs .doc-row .doc-nm', (bs) => bs.map((b) => b.getAttribute('aria-label')));
const hb = async (i) => page.locator('.split .pane-h').nth(i).boundingBox();
let [h0, h1] = [await hb(0), await hb(1)];
await page.mouse.move(h0.x + 40, h0.y + h0.height / 2);
await page.mouse.down();
await page.mouse.move(h0.x + 80, h0.y + h0.height / 2, { steps: 4 });
await page.mouse.move(h1.x + h1.width / 2, h1.y + 200, { steps: 8 });
want(await page.locator('.split .pane').nth(1).evaluate((p) => p.hasAttribute('data-drop')), 'dragging over the other pane marks it as the drop spot');
await f.shot('pane-drag');
await page.mouse.up();
await page.waitForTimeout(300);
ps = await panes();
want(ps[0].name === 'Speech' && ps[1].name === 'seed' && ps[0].text.includes('zz'), `dropped: Speech then seed, typing kept: ${JSON.stringify(ps.map((p) => p.name))}`);
await f.shot('swapped');
want(JSON.stringify((await railOrder()).slice(0, 2)) === JSON.stringify(['Speech (speech doc)', 'seed']), `the rail follows the swap: ${await railOrder()}`);
// Esc mid-drag puts it back
[h0, h1] = [await hb(0), await hb(1)];
await page.mouse.move(h0.x + 40, h0.y + h0.height / 2);
await page.mouse.down();
await page.mouse.move(h1.x + h1.width / 2, h1.y + 200, { steps: 8 });
await page.keyboard.press('Escape');
await page.mouse.up();
await page.waitForTimeout(200);
ps = await panes();
want(ps[0].name === 'Speech' && ps[1].name === 'seed', 'Esc mid-drag changes nothing');

// the X on a pane takes that file out of the split; it stays open
await page.locator('.split .pane').nth(0).locator('.pane-x').click();
await away();
await page.waitForTimeout(300);
want(!(await joined()) && (await page.locator('.fs-docs .doc-row').count()) === 3, 'X on a pane of two: the split comes apart, all three files still open');
await f.shot('pane-x');

// pick one file and right-click it: it joins with the open one
await row(0).locator('.doc-nm').click();
await row(2).locator('.doc-nm').click({ modifiers: ['Shift'] });
await row(2).click({ button: 'right' });
await page.waitForTimeout(200);
want((await page.textContent('.rail-menu')).includes('2 files selected'), 'right-clicking the one picked file offers Join with the open file');
await page.click('.rail-menu .mn-i:has-text("Join")');
await away();
await page.waitForTimeout(400);
ps = await panes();
want(ps.length === 2 && ps.map((p) => p.name).sort().join() === 'Untitled,seed', `joined seed and Untitled: ${JSON.stringify(ps.map((p) => p.name))}`);

// three joined, X on the middle one: the other two stay side by side, and it sits after them in the rail
for (const i of [0, 1, 2]) await row(i).locator('.doc-nm').click({ modifiers: ['Shift'] });
await row(0).click({ button: 'right' });
await page.waitForTimeout(200);
await page.click('.rail-menu .mn-i:has-text("Join")');
await away();
await page.waitForTimeout(400);
ps = await panes();
want(ps.length === 3, `three panes: ${JSON.stringify(ps.map((p) => p.name))}`);
const mid = ps[1].name;
await page.locator('.split .pane').nth(1).locator('.pane-x').click();
await away();
await page.waitForTimeout(300);
ps = await panes();
want((await joined()) && ps.length === 2 && !ps.some((p) => p.name === mid), `X on the middle pane of three: two stay joined: ${JSON.stringify(ps.map((p) => p.name))}`);
const ro = await railOrder();
want(ro.length === 3 && ro[2].startsWith(mid), `the closed-out file sits after the pair in the rail: ${ro}`);

// the max, from Settings
await page.click('.fstrip [aria-label="Settings"]');
await page.click('[aria-label="Settings sections"] button:has-text("Appearance")');
await page.waitForTimeout(200);
const setting = page.locator('.st-row, [class*="row"]', { hasText: 'Files side by side' }).first();
await f.shot('setting');
await setting.locator('button', { hasText: /^2$/ }).click();
want((await page.evaluate(() => localStorage.getItem('falcon.joinMax'))) === '2', 'Files side by side: 2 is stored');
await page.click('[aria-label="Close settings"]');
await page.waitForTimeout(300);
for (const i of [0, 1, 2]) await row(i).locator('.doc-nm').click({ modifiers: ['Shift'] });
await away();
await page.waitForTimeout(200);
want((await page.textContent('.toast')).includes('You can join up to 2 files'), 'a third pick past the max says so');
await page.keyboard.press('Escape');

// Unjoin
await row(0).click({ button: 'right' });
await page.waitForTimeout(200);
await page.click('.rail-menu .mn-i:has-text("Unjoin")');
await away();
await page.waitForTimeout(300);
want(!(await joined()) && (await page.locator('.split .pane').count()) === 0, 'Unjoin goes back to one file at a time');
await f.shot('unjoined');
await f.done();
