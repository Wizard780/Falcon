// The timer window: click the speech timer in the top bar, and a small window opens with the round's
// speech clock, our prep and their prep. Drive it with real clicks and check the top bar follows it.
import { openFalcon } from '../lib/falcon.mjs';

const f = await openFalcon('timer-window', { storage: { 'falcon.showPrep': 'on' } });
const { page, want } = f;
const bar = page.locator('.toolbar button.timer').first();
want((await bar.textContent()).trim() === '8:00', 'the top bar timer starts at 8:00');

const [win] = await Promise.all([page.waitForEvent('popup'), bar.click()]);
await win.setViewportSize({ width: 300, height: 312 });
await win.waitForSelector('.tw');
want(await win.title() === 'Timer', 'the window is titled Timer');
want(await win.locator('.tw-pick b').textContent() === '1AC', 'it starts on the 1AC');
want(await win.locator('[role=timer]').textContent() === '8:00', 'the speech clock reads 8:00');
const shot = async (name) => { await win.screenshot({ path: `${f.out}/${name}.png` }); };
await shot('01-opened');

// their prep runs, then starting the speech pauses it
const theirs = win.locator('.tw-p').nth(1);
await theirs.click();
await win.waitForTimeout(2200);
want(/Their prep7:5\d/.test(await theirs.textContent()), `their prep counts down (${await theirs.textContent()})`);
await shot('02-their-prep');
await win.getByRole('button', { name: 'Next speech' }).click();
await win.getByRole('button', { name: 'Next speech' }).click();
want(await win.locator('.tw-pick b').textContent() === '1NC', 'the arrows step to the 1NC');
await win.getByRole('button', { name: 'Start' }).click();
await win.waitForTimeout(2200);
want(await theirs.getAttribute('data-on') === null, 'starting the speech pauses their prep');
want(await win.getByRole('button', { name: 'Pause' }).count() === 1, 'Start turns into Pause');
const speech = await win.locator('[role=timer]').textContent();
want(/^7:5\d$/.test(speech), `the speech clock counts down (${speech})`);
want((await bar.textContent()).trim() === speech, 'the top bar shows the same speech clock');
await shot('03-speech-running');
await page.screenshot({ path: `${f.out}/04-main-window.png` });

// right-click resets a prep row
await theirs.click({ button: 'right' });
want(/Their prep8:00/.test(await theirs.textContent()), 'right-click resets their prep');

// closing the window and clicking again opens it once more
await win.close();
await page.waitForTimeout(600);
const [again] = await Promise.all([page.waitForEvent('popup'), bar.click()]);
await again.waitForSelector('.tw');
want(/^7:\d\d$/.test(await again.locator('[role=timer]').textContent()), 'the reopened window picks up the running clock');

// Settings > Speech and timers > Round: PF. The window starts a PF round with 3 minutes of prep a side
await page.click('.fstrip [aria-label="Settings"]');
await page.click('[aria-label="Settings sections"] button:has-text("Speech and timers")');
await page.getByRole('button', { name: 'PF', exact: true }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${f.out}/05-settings-round.png` });
want(await page.evaluate(() => localStorage.getItem('falcon.round')) === 'pf', 'Round PF is saved');
want(await page.evaluate(() => localStorage.getItem('falcon.prepMin')) === '3', 'and sets prep to 3 minutes');
await page.click('[aria-label="Close settings"]');
await again.setViewportSize({ width: 300, height: 312 });
want(await again.locator('.tw-pick b').textContent() === '1st Con', `the window starts a PF round (${await again.locator('.tw-pick b').textContent()})`);
want(await again.locator('[role=timer]').textContent() === '4:00', 'the 1st constructive runs 4:00');
want((await again.locator('.tw-p').allTextContents()).join() === 'Our prep3:00,Their prep3:00', 'each side has 3:00 of prep');
for (let i = 0; i < 8; i++) await again.getByRole('button', { name: 'Next speech' }).click();
want(await again.locator('.tw-pick b').textContent() === 'GCF', 'the picker reaches grand crossfire');
await again.screenshot({ path: `${f.out}/06-pf-gcf.png` });
await page.click('.fstrip [aria-label="Settings"]');
await page.getByRole('button', { name: 'LD', exact: true }).click();
await page.click('[aria-label="Close settings"]');
want(await again.locator('.tw-pick b').textContent() === 'AC', 'LD starts on the AC');
want(await again.locator('[role=timer]').textContent() === '6:00', 'the AC runs 6:00');
await again.screenshot({ path: `${f.out}/07-ld.png` });
await f.done();
