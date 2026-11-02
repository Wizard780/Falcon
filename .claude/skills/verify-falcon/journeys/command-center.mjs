// Command center (Mod-Shift-Space): commands, settings with choices, headings and cites in the file,
// typed values, find, Shift-Enter to stay open, undo inside it, Tab to Settings, and no file search.
import { openFalcon, SEED, MOD } from '../lib/falcon.mjs';
const f = await openFalcon('command-center');
const p = f.page;
await f.open(SEED);

const openCC = async () => { await p.keyboard.press(`${MOD}+Shift+Space`); await p.waitForSelector('.cc input'); await p.waitForTimeout(250); };
const rows = () => p.$$eval('.cc-row .cc-nm', (r) => r.map((x) => x.textContent));
const cur = () => p.$eval('.cc-row[data-on] .cc-nm', (x) => x.textContent).catch(() => null);
const typeIn = async (t) => { await p.fill('.cc input', t); await p.waitForTimeout(80); };
const caretText = () => p.evaluate(() => window.__falconView.state.selection.$from.parent.textContent);
const open = () => p.$('.cc').then(Boolean);

await openCC();
f.want(await p.evaluate(() => document.activeElement?.closest('.cc') !== null), 'Mod-Shift-Space opens it with focus in the box');
f.want((await p.$eval('.cc-start', (x) => x.textContent)).startsWith('Type to search everything') && await p.locator('.cc-chips button').count() === 4, 'an empty box shows the prompt and the prefix chips');
f.want(await p.evaluate(() => { const r = document.querySelector('.cc').getBoundingClientRect(); return r.bottom > innerHeight * 0.6 && document.querySelector('.cc-list').getBoundingClientRect().bottom <= document.querySelector('.cc-bar').getBoundingClientRect().top; }), 'it sits low on the page with results above the box');
await f.shot('empty');
await typeIn('c ');
for (let i = 0; i < 12 && await p.$('.cc-more'); i++) await p.click('.cc-more');
const heads = await p.$$eval('.cc-head', (r) => r.map((x) => x.textContent));
f.want(['Cutting', 'Moving around', 'Doc tools', 'Card tools', 'Appearance', 'Speech and timers'].every((h) => heads.includes(h)), `c browses every command, toggle and cycle: ${heads.join(', ')}`);
await f.shot('browse-commands');

// a command acts on the caret's paragraph
await p.keyboard.press('Escape');
await f.select('Temperatures');
await openCC();
await typeIn('hat');
f.want(await cur() === 'Hat', `"hat" puts Hat first (got ${await cur()})`);
await f.shot('typed-hat');
await p.keyboard.press('Enter');
await p.waitForTimeout(150);
f.want(!(await open()), 'Enter runs and closes');
f.want((await f.markMap()).includes('hat: Temperatures rose again.'), 'Hat turned the line into a hat');
f.want(await p.evaluate(() => document.activeElement?.closest('.ProseMirror') !== null), 'focus is back in the editor');

// Mod-Z inside the command center undoes the document
await openCC();
await p.keyboard.press(`${MOD}+z`);
await p.waitForTimeout(100);
f.want((await f.markMap()).includes('normal: Temperatures rose again.'), 'Mod-Z in the box undid the hat');
f.want(await open(), 'and it stayed open');

// key names find commands
await typeIn('f12');
f.want(await cur() === 'Clear formatting', `"f12" finds Clear formatting (got ${await cur()})`);
await typeIn('cwp');
f.want((await rows()).includes('Condense with pilcrows'), 'initials: "cwp" finds Condense with pilcrows');

// toggles flip in place
await typeIn('bold cites');
const st = () => p.$eval('.cc-row[data-on]', (r) => r.querySelector('.cc-tog')?.getAttribute('aria-label') ?? r.querySelector('.cc-cyc')?.textContent);
f.want(await cur() === 'Toggle Bold cites' && await st() === 'On', `Toggle Bold cites shows On (got ${await cur()})`);
await p.keyboard.press('Shift+Enter');
await p.waitForTimeout(100);
f.want(await open() && await st() === 'Off', 'Shift-Enter flipped it to Off and kept the box open');
f.want(await p.evaluate(() => document.documentElement.classList.contains('cite-plain')), 'cites redraw plain');
await f.shot('toggle-off');

// a choice setting drills into its options, Esc comes back
await typeIn('theme');
f.want(await cur() === 'Cycle Theme', `Cycle Theme is first for "theme" (got ${await cur()})`);
await p.keyboard.press('Tab');
await p.waitForTimeout(80);
f.want((await p.$eval('.cc-chip', (x) => x.textContent)).startsWith('Theme') && (await rows()).includes('Light'), 'Tab lists the theme choices');
await f.shot('theme-choices');
await p.keyboard.press('Escape');
f.want(!(await p.$('.cc-chip')) && await p.$eval('.cc input', (i) => i.value) === 'theme', 'Esc goes back to the search');
await typeIn('hat underline');
await p.keyboard.press('Shift+Enter');
await p.waitForTimeout(80);
f.want(await p.evaluate(() => localStorage.getItem('falcon.hatLine')) === 'single' && await st() === 'Single→Double', 'Enter on a Cycle row steps to the next choice');
await typeIn('light');
f.want((await rows()).includes('Theme: Light'), '"light" lists Theme: Light directly');
await p.click('.cc-row:has-text("Theme: Light")');
await p.waitForTimeout(150);
f.want(await p.evaluate(() => localStorage.getItem('falcon.theme')) === 'light', 'clicking it switched to the Light theme');
await f.shot('light-theme');

// headings, and cards by their cite
await openCC();
await typeIn('h warming');
f.want(await p.$eval('.cc-chip.src', (x) => x.textContent) === 'In this file', 'h narrows to the file');
f.want((await rows()).slice(0, 2).join() === 'Warming Block,Warming is real', `h warming: ${await rows()}`);
await p.keyboard.press('Enter');
await p.waitForTimeout(400);
f.want(await caretText() === 'Warming Block', 'Enter on a heading moves there');
await openCC();
await typeIn('smith');
f.want(await cur() === 'Growth is slowing', `a cite finds its card (got ${await cur()})`);
await f.shot('cite-search');
await p.keyboard.press('Escape');
f.want(!(await open()), 'one Esc closes, like CardMirror');

// typed values
await openCC();
await typeIn('card 2');
f.want(await cur() === 'Go to card 2: Warming is real', `card 2 (got ${await cur()})`);
await typeIn('zoom 150');
await p.keyboard.press('Enter');
await p.waitForTimeout(100);
f.want(await p.$eval('.status .zoom', (x) => x.textContent) === '150%', 'zoom 150 set the zoom');
await openCC();
await typeIn('zoom in');
await p.keyboard.press('Shift+Enter');
await p.keyboard.press('Shift+Enter');
await p.waitForTimeout(100);
f.want(await p.$eval('.status .zoom', (x) => x.textContent) === '170%' && await open(), 'Shift-Enter twice zooms twice and stays open');
await p.keyboard.press('Escape');

// find takes the typed text
await openCC();
await typeIn('needle');
await p.keyboard.press('ArrowUp'); // wraps to the last row: Replace, with Find above it
await p.keyboard.press('ArrowUp');
f.want(await cur() === 'Find “needle” in this file', `the rows at the end find the text (got ${await cur()})`);
await p.keyboard.press('Enter');
await p.waitForTimeout(200);
f.want(await p.$eval('.findbar input', (i) => i.value) === 'needle' && await p.$eval('.findbar .count', (x) => x.textContent) === '1/1', 'the find bar opened on it');
await p.keyboard.press('Escape');

// Tab opens the row in Settings, searched
await openCC();
await typeIn('smart paste');
await p.keyboard.press('Tab');
await p.waitForTimeout(200);
f.want(!(await open()) && await p.$eval('.st-search input', (i) => i.value) === 'Smart paste', 'Tab opened Settings searched for the row');
await f.shot('tab-settings');
await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
await p.waitForTimeout(100);

// help, and no file search
await openCC();
await typeIn('?');
f.want((await rows()).some((r) => r.startsWith('card 12')), '? lists what you can type');
await typeIn('search files');
f.want(!(await rows()).includes('Search files'), 'file search is not in here (Cmd-K keeps it)');
await p.keyboard.press(`${MOD}+Shift+Space`);
f.want(!(await open()), 'Mod-Shift-Space toggles it closed');
await f.done();
