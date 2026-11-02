// ` sends the card, section or selection at the caret into the speech doc without touching the file:
// the speech doc appears in the rail, sends land in order, and Undo (toast button or Mod-Z) takes one back.
// The key changes in Settings > Keybindings: rebound to ~, ~ sends and ` types again.
import { openFalcon, SEED, MOD } from '../lib/falcon.mjs';

const f = await openFalcon('send-to-speech');
const { page, want } = f;
await f.open(SEED);
const seed = await f.markMap();
const lines = seed.split('\n');
const CARD1 = lines.slice(3, 6).join('\n');
const BLOCK2 = lines.slice(6, 9).join('\n');
const SPEECH = 'Speech (speech doc)';

const rows = () => page.$$eval('.doc-row', (rs) => rs.map((r) => ({
  label: r.querySelector('.doc-nm').getAttribute('aria-label'),
  on: r.hasAttribute('data-on'),
  mark: r.querySelector('.spk')?.textContent ?? null,
  unsaved: !!r.querySelector('i[aria-label="unsaved"]'),
})));
// the files panel slides out while the pointer is over the rail and would cover the tool row
const goto = async (label) => { await page.click(`.doc-row .doc-nm[aria-label="${label}"]`); await page.mouse.move(800, 600); await page.waitForTimeout(500); };
const caretIn = async (text) => { await page.click(`.ProseMirror :text("${text}")`); await page.waitForTimeout(100); };
const send = async () => { await page.keyboard.press('Backquote'); await page.waitForTimeout(300); };
const toast = async () => (await page.textContent('.toast')).trim();
const speechMap = async () => { await goto(SPEECH); return f.markMap(); };
const caretPara = () => page.evaluate(() => window.__falconView.state.selection.$head.parent.textContent);

await caretIn('Global');
await send();
const after = await rows();
want(after.length === 2 && after[1].label === SPEECH && after[1].mark === 'S', `a speech doc appears in the rail with the S marker: ${JSON.stringify(after.map((r) => r.label))}`);
want(after[0].on && !after[1].on, 'the source file is still the open one');
want((await f.markMap()) === seed && !(await f.markMap()).includes('`'), 'the source text is unchanged and has no `');
want(!after[0].unsaved && after[1].unsaved, 'only the speech doc is marked unsaved');
want((await caretPara()).startsWith('Global growth'), 'the caret did not move in the source');
want((await toast()) === 'Sent “Growth is slowing” to SpeechUndo', `toast names the send and offers Undo: ${await toast()}`);
await f.shot('first-send');

want((await speechMap()) === CARD1, 'the speech doc holds card 1: tag, cite and body');
want((await page.getAttribute('.tools [aria-label="Speech doc"]', 'aria-pressed')) === 'true', 'the Speech doc tool button is pressed on the speech doc');
want((await page.$eval('.doc-row .doc-nm[aria-selected="true"]', (b) => b.getAttribute('aria-label'))) === SPEECH, 'the speech doc is the selected tab');
await f.shot('speech-doc');

await goto('seed');
await caretIn('Warming Block');
await send();
await page.click('.toast button');
want((await speechMap()) === CARD1, 'Undo on the toast removes the last send while the speech doc is in the background');

await goto('seed');
await caretIn('Warming Block');
await send();
want((await speechMap()) === `${CARD1}\n${BLOCK2}`, 'a block heading sends the block with its cards, after card 1');
await f.shot('two-sends-in-order');
await page.keyboard.press(`${MOD}+z`);
await page.waitForTimeout(200);
want((await f.markMap()) === CARD1, `${MOD}-Z in the speech doc removes the last send`);
await f.shot('after-mod-z');

await goto('seed');
await caretIn('Warming Block');
await send();
await goto(SPEECH);
await page.click('.toast button');
await page.waitForTimeout(200);
want((await f.markMap()) === CARD1, 'Undo on the toast works once the speech doc is the open one');

await goto('seed');
await f.select('two percent');
await send();
const partial = (await speechMap()).split('\n');
want(partial.length === 4 && partial[3] === 'normal: [two percent]{highlight:yellow+underline}', `a selected phrase is sent as its own paragraph with its marks: ${partial[3]}`);

await goto('seed');
await caretIn('Warming Block');
await send();
await goto(SPEECH);
await page.keyboard.type('x');
await page.click('.toast button');
const typed = await f.markMap();
want(typed.endsWith('The needle finds this line.x') && (await toast()).includes('has changed since'), `Undo steps aside once the speech doc was edited: ${await toast()}`);
await page.keyboard.press(`${MOD}+z`);

const before = await f.markMap();
await send();
want((await f.markMap()) === before && (await toast()).startsWith('This is the speech doc'), `\` in the speech doc sends nothing and says so: ${await toast()}`);

await goto('seed');
await page.click(`.tools [aria-label="Speech doc"]`);
const moved = await rows();
want(moved[0].label === 'seed (speech doc)' && moved[0].mark === 'S' && moved[1].label === 'Speech' && moved[1].mark === null, `the Speech doc button moves the marker to this file: ${JSON.stringify(moved.map((r) => r.label))}`);
want((await page.getAttribute('.tools [aria-label="Speech doc"]', 'aria-pressed')) === 'true', 'the button shows pressed on the marked file');
await f.shot('marker-moved');
await page.click(`.tools [aria-label="Speech doc"]`);
want((await rows()).every((r) => r.mark === null), 'clicking it again unmarks the file');
await goto('Speech');
await page.click(`.tools [aria-label="Speech doc"]`);
want((await rows())[1].label === SPEECH, 'the speech doc is marked again');

await goto('seed');
await page.keyboard.press(`${MOD}+f`);
await page.waitForSelector('.findbar input[placeholder="Find"]:focus');
await page.keyboard.press('Backquote');
want((await page.inputValue('.findbar input[placeholder="Find"]')) === '`', 'a text box still takes a typed `');
await page.keyboard.press('Escape');

await page.waitForTimeout(2000);
page.on('dialog', (d) => d.accept());
await page.reload();
await page.waitForSelector('.doc-row');
await page.waitForTimeout(500);
want((await rows()).some((r) => r.label === SPEECH && r.mark === 'S'), `the speech doc is still marked after a reload: ${JSON.stringify((await rows()).map((r) => r.label))}`);
want((await speechMap()).includes('tag: Growth is slowing'), 'and it still has what was sent');

await page.keyboard.press(`${MOD}+w`);
await page.click('button:has-text("Close Without Saving")');
await page.waitForTimeout(300);
want((await rows()).length === 1 && (await rows())[0].mark === null, 'closing the speech doc leaves no speech doc');
await caretIn('Global');
await send();
const again = await rows();
want(again.length === 2 && again[1].label === SPEECH && (await speechMap()) === CARD1, 'the next send makes a fresh speech doc');
await f.shot('fresh-speech-doc');

await goto('seed');
await caretIn('Warming Block');
await page.evaluate(() => document.querySelector('.ProseMirror').dispatchEvent(new KeyboardEvent('keydown', { key: '`', ctrlKey: true, altKey: true, modifierAltGraph: true, bubbles: true, cancelable: true })));
await page.waitForTimeout(300);
want((await speechMap()) === `${CARD1}\n${BLOCK2}`, 'an AltGr-typed ` (Ctrl+Alt held on Windows layouts) sends too');

await goto('seed');
await caretIn('Warming Block');
await page.evaluate(() => document.querySelector('.ProseMirror').dispatchEvent(new KeyboardEvent('keydown', { key: 'Dead', code: 'Backquote', bubbles: true, cancelable: true })));
await page.waitForTimeout(300);
want((await speechMap()) === `${CARD1}\n${BLOCK2}\n${BLOCK2}`, 'a dead-key ` (US International layout) sends too');

await goto('seed');
await page.keyboard.press(`${MOD}+n`);
await page.waitForTimeout(300);
await page.click(`.tools [aria-label="Speech doc"]`);
await goto('seed');
await page.waitForTimeout(2000);
await page.reload();
await page.waitForSelector('.doc-row');
await page.waitForTimeout(500);
want((await rows()).some((r) => r.label === 'Untitled (speech doc)' && r.mark === 'S'), `a saved, untouched speech doc keeps its marker after a reload: ${JSON.stringify((await rows()).map((r) => r.label))}`);

// Settings > Keybindings: Send to speech is listed with `, and can be rebound to ~ by pressing Shift+`
await goto('seed');
await page.click('.fstrip [aria-label="Settings"]');
await page.waitForTimeout(250);
await page.click('[aria-label="Settings sections"] button:has-text("Keybindings")');
await page.waitForTimeout(150);
const sendField = page.locator('.st-keyb[aria-label^="Send to speech:"]').first();
want((await sendField.getAttribute('aria-label')) === 'Send to speech: `. Change shortcut', `Settings lists Send to speech with \`: ${await sendField.getAttribute('aria-label')}`);
await f.shot('settings-send-key');
await sendField.click();
await page.waitForTimeout(100);
await page.keyboard.press('Shift+Backquote');
await page.waitForTimeout(200);
want((await page.evaluate(() => localStorage.getItem('falcon.key.sendToSpeech'))) === 'Shift-`', `Shift+\` is saved as the new key: ${await page.evaluate(() => localStorage.getItem('falcon.key.sendToSpeech'))}`);
await f.shot('settings-send-key-tilde');
await page.click('[aria-label="Close settings"]');
await page.waitForTimeout(200);
const untitled = async () => { await goto('Untitled (speech doc)'); return f.markMap(); }; // the speech doc is Untitled by now
const sentBefore = await untitled();
await goto('seed');
await caretIn('Global');
await page.keyboard.press('Backquote');
await page.waitForTimeout(300);
want((await f.markMap()).includes('`') && (await untitled()) === sentBefore, 'once rebound, ` types in the page and sends nothing');
await goto('seed');
await page.keyboard.press(`${MOD}+z`);
await caretIn('Global');
await page.keyboard.press('Shift+Backquote');
await page.waitForTimeout(300);
const srcClean = !(await f.markMap()).includes('~');
const now = await untitled();
want(srcClean && now !== sentBefore && now.endsWith(CARD1), `and ~ sends instead: ${JSON.stringify(now.slice(-60))}`);
await f.shot('tilde-sends-after-rebind');
await f.done();
