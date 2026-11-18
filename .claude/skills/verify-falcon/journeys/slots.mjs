// Slots (Settings > General > Workspace): three slots side by side, each a stack of files. Opening a file asks
// "Open X into…" Slot 1, 2 or 3 (1/2/3 keys, Esc cancels) unless nothing but a blank Untitled is open; the file
// goes on top of that slot, never replacing what's there. The ⌄ N button by a slot's name lists its files: pick
// one to bring it to the top, or close it. A rail click on a file under another brings it up too. A pane's X
// closes its top file (the next one down shows); an emptied slot goes and the others widen. Dragging a pane's
// name onto another swaps the two slots.
import path from 'node:path';
import { openFalcon, SEED } from '../lib/falcon.mjs';

const MARKED = path.join(path.dirname(SEED), 'marked.docx'), MEDIA = path.join(path.dirname(SEED), 'media.docx');
const f = await openFalcon('slots');
const { page, want } = f;
const panes = () => page.$$eval('.split .pane', (ps) => ps.map((p) => ({ name: p.querySelector('.pane-h .nm')?.textContent, stack: p.querySelector('.stk-b')?.textContent ?? '', on: p.hasAttribute('data-on'), w: Math.round(p.getBoundingClientRect().width) })));
const names = async () => (await panes()).map((p) => p.name).join(' | ');
const asking = () => page.locator('.slot-ask').isVisible();
const docCount = () => page.locator('.fs-docs .doc-row').count();
const away = () => page.mouse.move(900, 700);
const settle = () => page.waitForTimeout(400);
/** Open… with the file chooser, up to the slot question (f.open waits for the file to land, which waits on the answer). */
const openAsk = async (file) => {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.tools [aria-label="Open…"]')]);
  await fc.setFiles(file);
  await page.waitForSelector('.slot-ask');
};

// Settings > Workspace > Slots: the blank Untitled moves into slot 1
await page.click('.fstrip [aria-label="Settings"]');
await page.waitForTimeout(300);
await page.locator('.st-row', { hasText: 'Workspace' }).locator('button:has-text("Slots")').click();
want(await page.evaluate(() => localStorage.getItem('falcon.slots')) === 'on', 'Slots turns its setting on');
await page.click('[aria-label="Close settings"]');
await settle();
want((await names()) === 'Untitled', `the open Untitled sits in a pane of its own: ${await names()}`);

// the blank Untitled makes way: no question, one pane with its name
await f.open(SEED);
await settle();
want(!(await asking()), 'first file: no slot question (only a blank Untitled was open)');
want((await names()) === 'seed' && (await docCount()) === 1, `seed alone, in a pane with its name: ${await names()}, ${await docCount()} open`);

// a second file asks; 2 puts it in slot 2, beside seed
await openAsk(MARKED);
const labels = await page.$$eval('.slot-ask .slot-nm', (n) => n.map((x) => x.textContent));
want(labels.join(',') === 'On top of seed,Empty,Empty', `the question shows what each slot holds: ${labels}`);
await f.shot('ask');
await page.keyboard.press('2');
await settle();
let ps = await panes();
want((await names()) === 'seed | marked', `2: marked opens in slot 2, beside seed: ${await names()}`);
want(Math.abs(ps[0].w - ps[1].w) <= 2 && ps[1].on, `the two share the width and the new one has focus: ${ps.map((p) => p.w)}`);

// a third into slot 1: on top of seed, which stays open under it
await openAsk(MEDIA);
await page.locator('.slot-ask .slot-b').nth(0).click();
await settle();
ps = await panes();
want((await names()) === 'media | marked', `slot 1 now shows media: ${await names()}`);
want(ps[0].stack.trim() === '2' && ps[1].stack === '', `slot 1's button says 2 files, slot 2 has none: ${JSON.stringify(ps.map((p) => p.stack))}`);
want((await docCount()) === 3, 'nothing was replaced: three files open');
await f.shot('stacked');

// the button lists the slot's files, top first; picking seed brings it to the top
await page.locator('.split .pane').nth(0).locator('.stk-b').click();
await page.waitForTimeout(200);
const rows = await page.$$eval('.stk-menu .stk-r', (r) => r.map((x) => x.querySelector('.mn-i').textContent + (x.hasAttribute('data-top') ? '*' : '')));
want(rows.join(',') === 'media*,seed', `the menu lists media (on top) then seed: ${rows}`);
await f.shot('stack-menu');
await page.locator('.stk-menu .mn-i:has-text("seed")').click();
await settle();
want((await names()) === 'seed | marked', `picking seed puts it on top of slot 1: ${await names()}`);
want(!(await page.locator('.stk-menu').count()), 'the menu closes after the pick');

// a rail click on a file under another brings it up as well
await page.locator('.fs-docs .doc-nm[aria-label="media"]').click();
await away();
await settle();
want((await names()) === 'media | marked', `a rail click on media brings it to the top of slot 1: ${await names()}`);

// Esc on the question opens nothing
await page.click('.tools [aria-label="New document"]');
await page.click('.cf .sa-mode:has-text("Blank Doc")');
await page.waitForSelector('.slot-ask');
await page.keyboard.press('Escape');
await settle();
want(!(await asking()) && (await docCount()) === 3 && (await names()) === 'media | marked', 'Esc cancels: no new file');

// a blank doc into slot 3: three thirds
await page.click('.tools [aria-label="New document"]');
await page.click('.cf .sa-mode:has-text("Blank Doc")');
await page.waitForSelector('.slot-ask');
await page.keyboard.press('3');
await settle();
ps = await panes();
want((await names()) === 'media | marked | Untitled', `3: Untitled in slot 3: ${await names()}`);
want(Math.max(...ps.map((p) => p.w)) - Math.min(...ps.map((p) => p.w)) <= 2, `three equal panes: ${ps.map((p) => p.w)}`);
const secs = await page.$$eval('.olp .ol-sec .sb-label', (n) => n.map((x) => x.textContent));
want(secs.join(',') === 'media,marked,Untitled', `the outline has a section per slot: ${secs}`);
await f.shot('three-slots');

// dragging slot 1's name onto slot 2 swaps the slots, stacks and all
const h0 = await page.locator('.split .pane').nth(0).locator('.pane-h .nm').boundingBox(), p1 = await page.locator('.split .pane').nth(1).boundingBox();
await page.mouse.move(h0.x + 10, h0.y + 5);
await page.mouse.down();
await page.mouse.move(h0.x + 60, h0.y + 40, { steps: 4 });
await page.mouse.move(p1.x + p1.width / 2, p1.y + 200, { steps: 6 });
await page.mouse.up();
await settle();
ps = await panes();
want((await names()) === 'marked | media | Untitled' && ps[1].stack.trim() === '2', `the drag swaps slots 1 and 2, media keeping its stack: ${await names()} ${JSON.stringify(ps.map((p) => p.stack))}`);

// closing from the menu: seed goes, media stays on top, the button goes with the stack of one
await page.locator('.split .pane').nth(1).locator('.stk-b').click();
await page.locator('.stk-menu .stk-x[aria-label="Close seed"]').click();
await settle();
ps = await panes();
want((await docCount()) === 3 && (await names()) === 'marked | media | Untitled' && ps[1].stack === '', `closing seed from the menu leaves media alone in its slot: ${await names()}`);

// a pane's X closes its file; the emptied slot goes and the rest widen
await page.locator('.split .pane').nth(2).locator('.pane-x').click();
await settle();
ps = await panes();
want((await names()) === 'marked | media' && Math.abs(ps[0].w - ps[1].w) <= 2, `closing Untitled empties slot 3; two halves: ${await names()} ${ps.map((p) => p.w)}`);
await f.shot('after-close');

// a new speech doc is the speech doc (not the file you were on), on top of your slot, caret in it
await page.locator('.split .pane').nth(0).locator('.ProseMirror').click();
await page.click('.tools [aria-label="New document"]');
await page.click('.cf .sa-mode:has-text("Speech Doc")');
await page.waitForSelector('input[aria-label="Speech name"]');
await page.keyboard.type('1AR');
await page.keyboard.press('Enter');
await settle();
const spk = await page.$$eval('.fs-docs .doc-nm', (n) => n.filter((x) => x.querySelector('.spk')).map((x) => x.getAttribute('aria-label')));
ps = await panes();
want(spk.length === 1 && spk[0].startsWith('Speech 1AR') && ps[0].name.startsWith('Speech 1AR') && ps[0].on, `the new speech doc is the speech doc, on top of slot 1 and focused: ${JSON.stringify(spk)} ${await names()}`);
want(await page.evaluate(() => window.__falconView.state.doc.textContent.startsWith('1AR')), 'the keys act on the new speech doc');
await page.locator('.split .pane').nth(0).locator('.pane-x').click();
await settle();

// Cmd-1 while the question is up is not an answer
await openAsk(SEED); // seed is closed by now: asks
await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+1`);
await page.waitForTimeout(200);
want(await asking(), 'Cmd-1 leaves the question up');
want((await page.locator('.slot-ask h2').textContent()).includes('seed'), 'the question still asks about seed');
await page.keyboard.press('3');
await settle();
want((await names()).split(' | ').includes('seed') && !(await asking()), `3 opens seed: ${await names()}`);

// the tutorial runs in Slots (its sample opens on top and stays)
await page.click('.fstrip [aria-label="Settings"]');
await page.waitForTimeout(300);
await page.click('.st-row:has-text("Replay tutorial") button');
await page.waitForTimeout(1500);
want(await page.evaluate(() => !!document.querySelector('.tour-card h2')), 'Replay starts the tour in Slots');
await f.shot('tour-in-slots');
await page.keyboard.press('Escape');
await settle();

// Settings: the Workspace choice, and back to Tabs takes the slots down
await page.click('.fstrip [aria-label="Settings"]');
await page.waitForTimeout(300);
const seg = page.locator('.st-row', { hasText: 'Workspace' });
want(await seg.isVisible(), 'Settings > General has a Workspace row');
await seg.locator('button:has-text("Tabs")').click();
await page.waitForTimeout(200);
want(await page.evaluate(() => localStorage.getItem('falcon.slots')) === 'off', 'Tabs turns the Slots setting off');
await page.click('[aria-label="Close settings"]');
await settle();
want(!(await page.locator('.split .pane').count()), 'in Tabs the files show one at a time again');
want((await docCount()) === 3, 'the files stay open');

await f.done();
