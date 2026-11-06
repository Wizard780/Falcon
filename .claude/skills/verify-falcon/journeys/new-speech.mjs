// New speech doc: set the name template in Settings, press Mod-Shift-N, name it 1NC, and get a speech doc
// that opens on a 1NC pocket and saves under the template's name. Then the Home button and Shift-click + paths.
import { openFalcon, MOD } from '../lib/falcon.mjs';

const f = await openFalcon('new-speech');
const { page, want } = f;

await page.click('.fstrip [aria-label="Settings"]');
await page.waitForTimeout(300);
const field = page.locator('input[aria-label="Speech doc name"]');
want(await field.inputValue() === 'Speech {speech} {date:M-D h-mmA}', 'default template');
await field.fill('{speech} [x] {date:YYYY}');
await page.waitForTimeout(200);
want(await page.evaluate(() => localStorage.getItem('falcon.speechName')) === '{speech} [x] {date:YYYY}', 'template stored as falcon.speechName');
const year = String(new Date().getFullYear());
want((await page.locator('.st-row:has(input[aria-label="Speech doc name"])').textContent()).includes(`Example: 1NC [x] ${year}.docx`), 'hint example follows the template');
await f.shot('settings-template');
await field.fill('Speech {speech} {date:YYYY}');
await page.click('[aria-label="Close settings"]');
await page.waitForTimeout(200);

await page.keyboard.press(`${MOD}+Shift+n`);
await page.waitForSelector('input[aria-label="Speech name"]');
await page.keyboard.type('1NC'); // straight away, as a user would: the field has focus as it appears
await page.waitForTimeout(250);
want((await page.textContent('.ns-file')) === `Saves as Speech 1NC ${year}.docx`, 'dialog previews the file name');
await f.shot('dialog');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
want(!(await page.$('input[aria-label="Speech name"]')), 'dialog closes on Enter');
await page.keyboard.type('first card');
const map = await f.markMap();
want(map.startsWith('pocket: 1NC'), `doc opens on a 1NC pocket: ${map.split('\n')[0]}`);
want(map.includes('normal: first card'), 'typing lands under the pocket');
want(await page.getAttribute('.tools [aria-label="Speech doc"]', 'aria-pressed') === 'true', 'mic is on: it is the speech doc');
want(!!(await page.$(`.doc-nm[aria-label="Speech 1NC ${year} (speech doc)"]`)), 'rail lists it as the speech doc');
await f.shot('speech-doc');
const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press(`${MOD}+s`)]);
want(dl.suggestedFilename() === `Speech 1NC ${year}.docx`, `saves as the template name: ${dl.suggestedFilename()}`);

await page.waitForTimeout(300); // Shift-click on the tool row's + opens the same dialog; Esc cancels it
await page.click('.tools [aria-label="New document"]', { modifiers: ['Shift'] });
want(!!(await page.waitForSelector('input[aria-label="Speech name"]', { timeout: 2000 }).catch(() => null)), 'Shift-click + asks for a speech name');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
want(!(await page.$('input[aria-label="Speech name"]')), 'Esc cancels');

// + opens New Document: Esc and Cancel make nothing, Enter takes Blank Doc, Speech Doc goes on to the normal prompt
const docs = () => page.locator('.fs-docs .doc-row').count();
const plus = '.tools [aria-label="New document"]';
const before = await docs();
await page.click(plus);
await page.waitForSelector('.cf h2:has-text("New Document")');
await page.waitForTimeout(250);
await f.shot('new-document');
await page.keyboard.press(`${MOD}+n`); // the shortcut behind the dialog does nothing
await page.waitForTimeout(100);
want((await docs()) === before, 'Mod-N behind the dialog makes nothing');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
want(!(await page.$('.nd-kinds')) && (await docs()) === before, 'Esc cancels New Document');
want(await page.evaluate(() => !!document.activeElement?.closest('.ProseMirror')), 'focus is back in the page after Esc');
await page.click(plus);
await page.click('.cf-btns button:has-text("Cancel")');
await page.waitForTimeout(150);
want(!(await page.$('.nd-kinds')) && (await docs()) === before, 'Cancel makes nothing');
await page.click(plus);
await page.waitForSelector('.nd-kinds');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
want(!(await page.$('.nd-kinds')) && (await docs()) === before + 1 && !!(await page.$('.doc-nm[aria-label="Untitled"]')), 'Enter makes a blank doc');
await page.keyboard.type('x'); // an untouched blank doc is reused, so give this one text
await page.keyboard.press(`${MOD}+n`);
await page.waitForTimeout(200);
want(!(await page.$('.nd-kinds')) && (await docs()) === before + 2, 'Mod-N still makes a blank doc with no popup');
await page.click(plus);
await page.click('.cf .sa-mode:has-text("Speech Doc")');
await page.waitForSelector('input[aria-label="Speech name"]');
want(!(await page.$('.nd-kinds')), 'Speech Doc swaps to the speech prompt');
await page.keyboard.type('1AR');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
want(!!(await page.$(`.doc-nm[aria-label="Speech 1AR ${year} (speech doc)"]`)), 'Speech Doc goes through the normal speech doc flow');

// Home's New speech doc button; it moves the speech doc to the new file
await f.shot('before-home');
await page.click('.fstrip [aria-label="Home"]');
await page.click('.hm-act:has-text("New speech doc")');
await page.waitForSelector('input[aria-label="Speech name"]');
await page.waitForTimeout(250);
await f.shot('home-dialog');
await page.keyboard.type('2AC');
await page.click('.cf-btns button:has-text("Create")');
await page.waitForTimeout(200);
want((await f.markMap()).startsWith('pocket: 2AC'), 'Create button makes the 2AC doc');
want(!!(await page.$(`.doc-nm[aria-label="Speech 2AC ${year} (speech doc)"]`)) && !(await page.$(`.doc-nm[aria-label="Speech 1AR ${year} (speech doc)"]`)), 'the speech doc is now 2AC');
await f.done();
