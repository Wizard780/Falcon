// Interface font: picking it in Settings changes the menus, tooltips and Settings, leaves the document's font alone,
// and survives a reload. Picking the editor font leaves the interface alone.
import { openFalcon, SEED } from '../lib/falcon.mjs';

const f = await openFalcon('ui-font');
const { page, want } = f;
await f.open(SEED);
const fam = (sel) => page.$eval(sel, (e) => getComputedStyle(e).fontFamily);
const docBefore = await fam('.ProseMirror');
const openDoc = async () => { await page.locator('[data-pop="doc"]').dispatchEvent('mousedown'); await page.waitForSelector('.pop.menu .mn-i'); };
const closeDoc = async () => { await page.keyboard.press('Escape'); await page.mouse.click(700, 600); };

const settings = async () => {
  await page.click('.fstrip [aria-label="Settings"]');
  await page.click('[aria-label="Settings sections"] button:has-text("Appearance")');
};
await settings();
await page.selectOption('select[aria-label="Interface font"]', 'geist');
await page.waitForTimeout(300);
want((await fam('.st-row')).startsWith('"Geist Variable"'), `Settings itself switches to Geist: ${await fam('.st-row')}`);
want(await page.evaluate(() => localStorage.getItem('falcon.uiFont')) === 'geist', 'stored as falcon.uiFont=geist');
want(await page.evaluate(() => document.fonts.check("13px 'Geist Variable'")), 'Geist is loaded (bundled, no network)');
await f.shot('settings-geist');
await page.click('[aria-label="Close settings"]');

await openDoc();
want((await fam('.pop.menu .mn-i')).startsWith('"Geist Variable"'), `Doc tools menu items use Geist: ${await fam('.pop.menu .mn-i')}`);
await f.shot('doc-menu-geist');
await closeDoc();

const tag = page.locator('[title^="Tag (F7)"], [data-tip^="Tag (F7)"]').first();
await tag.hover(); await page.waitForSelector('.tip');
want((await fam('.tip')).startsWith('"Geist Variable"'), `tooltip uses Geist: ${await fam('.tip')}`);
await f.shot('tooltip-geist');
await page.mouse.move(700, 600);
want(await fam('.ProseMirror') === docBefore, `document font unchanged: ${await fam('.ProseMirror')}`);

// the editor font is its own setting
await settings();
await page.click('[aria-label="Settings sections"] button:has-text("Formatting")');
await page.selectOption('select[aria-label="Editor font"]', 'georgia');
await page.waitForTimeout(200);
await page.click('[aria-label="Close settings"]');
want((await fam('.ProseMirror')).startsWith('Georgia'), `editor font now Georgia: ${await fam('.ProseMirror')}`);
await openDoc();
want((await fam('.pop.menu .mn-i')).startsWith('"Geist Variable"'), 'menus still Geist after the editor font changed');
await closeDoc();

await page.reload(); await page.waitForSelector('.ProseMirror'); await page.keyboard.press('Escape');
await openDoc();
want((await fam('.pop.menu .mn-i')).startsWith('"Geist Variable"'), 'interface font survives a reload');
await closeDoc();

// System puts the old stack back
await settings();
await page.selectOption('select[aria-label="Interface font"]', 'system');
await page.waitForTimeout(200);
want((await fam('.st-row')).startsWith('system-ui'), `System restores the system font: ${await fam('.st-row')}`);
await f.done();
