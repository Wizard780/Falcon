// Open the seed through Open…, edit it, save with Mod-S (a download on the web), then reopen the saved
// file in a fresh browser and check every paragraph and mark survived. Also reads the saved .docx itself.
import fs from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { openFalcon, SEED, MOD } from '../lib/falcon.mjs';

const expected = fs.readFileSync(new URL('../fixtures/seed.markmap.txt', import.meta.url), 'utf8').trim();
const f = await openFalcon('open-save-docx');
const { page, want } = f;
await f.shot('empty');
await f.open(SEED);
want(await page.locator('.doc-row .doc-nm[aria-label="seed"]').count() === 1, 'rail shows the opened file as "seed"');
const opened = await f.markMap();
fs.writeFileSync(`${f.out}/opened.markmap.txt`, opened + '\n');
want(opened === expected, 'opened mark map matches fixtures/seed.markmap.txt');
await f.shot('opened');

await f.select('needle');
await page.keyboard.type('thread');
want(await page.locator('.doc-row i[aria-label="unsaved"]').count() === 1, 'typing marks the file unsaved');
const edited = await f.markMap();
want(edited === expected.replace('needle', 'thread'), 'typing over the selection replaced "needle" with "thread"');
await f.shot('edited');

const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press(`${MOD}+s`)]);
want(dl.suggestedFilename() === 'seed.docx', `the download is named after the doc (${dl.suggestedFilename()})`);
const saved = `${f.out}/seed-saved.docx`;
await dl.saveAs(saved);
await page.waitForTimeout(300);
want(await page.locator('.doc-row i[aria-label="unsaved"]').count() === 0, 'Mod-S clears the unsaved dot');
const xml = strFromU8(unzipSync(fs.readFileSync(saved), { filter: (x) => x.name === 'word/document.xml' })['word/document.xml']);
want(xml.includes('thread finds this line') && !xml.includes('needle'), `saved word/document.xml has the edit (${fs.statSync(saved).size} bytes)`);
await f.shot('saved');
await f.done();

// second, independent view: a fresh browser opens what was written to disk
const g = await openFalcon('open-save-docx/reopen');
await g.open(saved);
const reopened = await g.markMap();
fs.writeFileSync(`${g.out}/reopened.markmap.txt`, reopened + '\n');
g.want(reopened === edited, 'reopened saved file has the same paragraphs, styles and marks');
await g.shot('reopened');
await g.done();
