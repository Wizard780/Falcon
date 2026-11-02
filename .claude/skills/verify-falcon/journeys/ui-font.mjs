// Interface font: Geist by default; picking another in Settings changes the menus, tooltips and Settings, leaves the document's font alone,
// and survives a reload. Picking the editor font leaves the interface alone.
import { openFalcon, SEED } from '../lib/falcon.mjs';

const f = await openFalcon('ui-font');
const { page, want } = f;
await f.open(SEED);
const fam = (sel) => page.$eval(sel, (e) => getComputedStyle(e).fontFamily);
const docBefore = await fam('.ProseMirror');
const tile = (label, name) => page.click(`[role=radiogroup][aria-label="${label}"] [role=radio][aria-label="${name}"]`);
const checked = (label, name) => page.getAttribute(`[role=radiogroup][aria-label="${label}"] [aria-label="${name}"]`, 'aria-checked');
const openDoc = async () => { await page.locator('[data-pop="doc"]').dispatchEvent('mousedown'); await page.waitForSelector('.pop.menu .mn-i'); };
const closeDoc = async () => { await page.keyboard.press('Escape'); await page.mouse.click(700, 600); };

const settings = async () => {
  await page.click('.fstrip [aria-label="Settings"]');
  await page.click('[aria-label="Settings sections"] button:has-text("Appearance")');
};
await settings();
want(await checked('Interface font', 'Geist') === 'true', 'Geist is the default interface font');
want((await fam('.st-row')).startsWith('"Geist Variable"'), `Settings is in Geist by default: ${await fam('.st-row')}`);
want(await page.evaluate(() => document.fonts.check("13px 'Geist Variable'")), 'Geist is loaded (bundled, no network)');
want((await page.$$('[role=radiogroup][aria-label="Interface font"] [role=radio]')).length === 6, 'six interface font tiles');
want((await fam('[aria-label="Interface font"] [aria-label="Inter"] .st-aa')).startsWith('"Inter Variable"'), 'the Inter tile draws Aa in Inter');
await f.shot('settings-default');
await tile('Interface font', 'Inter'); await page.waitForTimeout(300);
want((await fam('.st-row')).startsWith('"Inter Variable"'), `clicking Inter switches Settings: ${await fam('.st-row')}`);
want(await page.evaluate(() => localStorage.getItem('falcon.uiFont')) === 'inter', 'stored as falcon.uiFont=inter');
await f.shot('settings-inter');
await page.click('[aria-label="Close settings"]');

await openDoc();
want((await fam('.pop.menu .mn-i')).startsWith('"Inter Variable"'), `Doc tools menu items use Inter: ${await fam('.pop.menu .mn-i')}`);
await f.shot('doc-menu-inter');
await closeDoc();

const tag = page.locator('[title^="Tag (F7)"], [data-tip^="Tag (F7)"]').first();
await tag.hover(); await page.waitForSelector('.tip');
want((await fam('.tip')).startsWith('"Inter Variable"'), `tooltip uses Inter: ${await fam('.tip')}`);
await f.shot('tooltip-inter');
await page.mouse.move(700, 600);
want(await fam('.ProseMirror') === docBefore, `document font unchanged: ${await fam('.ProseMirror')}`);

// the editor font is its own setting
await settings();
await page.click('[aria-label="Settings sections"] button:has-text("Formatting")');
await tile('Editor font', 'Georgia');
await page.waitForTimeout(200);
await page.click('[aria-label="Close settings"]');
want((await fam('.ProseMirror')).startsWith('Georgia'), `editor font now Georgia: ${await fam('.ProseMirror')}`);
await openDoc();
want((await fam('.pop.menu .mn-i')).startsWith('"Inter Variable"'), 'menus still Inter after the editor font changed');
await closeDoc();

await page.reload(); await page.waitForSelector('.ProseMirror'); await page.keyboard.press('Escape');
await openDoc();
want((await fam('.pop.menu .mn-i')).startsWith('"Inter Variable"'), 'interface font survives a reload');
await closeDoc();

// System puts the old stack back
await settings();
await tile('Interface font', 'System');
await page.waitForTimeout(200);
want((await fam('.st-row')).startsWith('system-ui'), `System restores the system font: ${await fam('.st-row')}`);
await f.done();
