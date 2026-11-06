// The top bar's one timer button: a stopwatch and the speech clock, with no Read button beside it.
// The hand starts at twelve and winds back as the speech runs. Read mode stays on the tool row's eye.
import { openFalcon } from '../lib/falcon.mjs';

const f = await openFalcon('timer-button', { storage: { 'falcon.speech': '1', 'falcon.lowTime': '30' } });
const { page, want } = f;
const bar = page.locator('.toolbar button.timer.clock');
const hand = () => bar.locator('svg path').nth(1).getAttribute('d');
const expected = (left) => { const a = left * 2 * Math.PI; return `M8 9.2L${(8 + 3.3 * Math.sin(a)).toFixed(2)} ${(9.2 - 3.3 * Math.cos(a)).toFixed(2)}`; };
const secs = async () => { const [m, s] = (await bar.textContent()).trim().split(':').map(Number); return m * 60 + s; };
const crop = async (name) => {
  const b = await page.locator('.toolbar').boundingBox();
  await page.screenshot({ path: `${f.out}/${name}.png`, clip: { x: b.x + b.width - 420, y: b.y, width: 420, height: b.height } });
};

want(await page.locator('.toolbar .bar .end').getByText('Read', { exact: true }).count() === 0, 'no Read button in the top bar');
want(await bar.locator('svg').count() === 1 && (await bar.textContent()).trim() === '1:00', 'one button: stopwatch and 1:00');
want(await hand() === expected(1), `idle hand at twelve (${await hand()})`);
const tb = await page.locator('.toolbar').boundingBox(), bb = await bar.boundingBox();
want(Math.abs((tb.y + tb.height / 2) - (bb.y + bb.height / 2)) <= 1, 'the button sits centered in the bar');
await crop('01-idle');

const [win] = await Promise.all([page.waitForEvent('popup'), bar.click()]);
await win.waitForSelector('.tw');
want(true, 'clicking the button still opens the timer window');
await win.getByRole('button', { name: 'Start' }).click();
await page.waitForTimeout(3300);
await win.getByRole('button', { name: 'Pause' }).click();
await page.waitForTimeout(300);
const left = await secs();
want(left < 60 && await hand() === expected(left / 60), `the hand tracks ${left}s left (${await hand()})`);
await crop('02-paused');
await win.getByRole('button', { name: 'Start' }).click();
await page.waitForTimeout(1200);
// --ink-ui is the highlighter in use, so read it off the page rather than naming a color
const run = await bar.evaluate((x) => { const t = document.createElement('i'); t.style.color = 'var(--ink-ui)'; x.append(t); const ink = getComputedStyle(t).color; t.remove(); return { ink, text: getComputedStyle(x).color, icon: getComputedStyle(x.querySelector('svg')).color }; });
want(await bar.getAttribute('data-on') !== null && run.text === run.ink && run.icon === run.ink, `running: the icon and time take the ink color (${run.ink})`);
await bar.evaluate((x) => x.getAnimations().forEach((a) => a.cancel()));
await crop('03-running');
await win.getByRole('button', { name: 'Pause' }).click();
await win.close();

await bar.click({ button: 'right' });
await page.waitForTimeout(150);
want((await bar.textContent()).trim() === '1:00' && await hand() === expected(1), 'right-click resets the clock and the hand');

await page.click('.tools [aria-label="Read mode"]');
await page.waitForTimeout(200);
want(await page.locator('.ProseMirror.f-read').count() === 1, 'the tool row eye still turns on Read mode');
await page.click('.tools [aria-label="Read mode"]');
await page.waitForTimeout(200);
want(await page.locator('.ProseMirror.f-read').count() === 0, 'and turns it off');
await page.mouse.move(700, 600);
await page.waitForTimeout(500);
await page.hover('.tools [aria-label="Read mode"]');
await page.waitForTimeout(500);
want((await page.locator('.tip').innerText()).includes('Space drops a marker'), 'the eye keeps the longer hint');
await page.mouse.move(700, 600);
await f.done();

// the low flash, the widest clock, and the button with Send and Prep beside it
const g = await openFalcon('timer-button-low', { storage: { 'falcon.speech': '1', 'falcon.lowTime': '60' } });
const lowBar = g.page.locator('.toolbar button.timer.clock');
const [w2] = await Promise.all([g.page.waitForEvent('popup'), lowBar.click()]);
await w2.waitForSelector('.tw');
await w2.getByRole('button', { name: 'Start' }).click();
await g.page.waitForTimeout(1500);
const lowColors = await lowBar.evaluate((x) => [x.classList.contains('low'), getComputedStyle(x).color, getComputedStyle(x.querySelector('svg')).color]);
g.want(lowColors[0] && lowColors[1] === 'rgb(255, 107, 107)' && lowColors[2] === lowColors[1], `low time: the icon flashes red with the clock (${lowColors})`);
await w2.close();
await g.done();

const w = async (m) => {
  const h = await openFalcon(`timer-button-${m}`, { storage: { 'falcon.speech': String(m) } });
  const x = (await h.page.locator('.toolbar button.timer.clock').boundingBox()).width;
  await h.done();
  return x;
};
const [w8, w10] = [await w(8), await w(10)];
const k = await openFalcon('timer-button-width', { storage: { 'falcon.speech': '10', 'falcon.showPrep': 'on', 'falcon.showSend': 'on' } });
k.want(w8 === w10, `10:00 is no wider than 8:00 (${w8}, ${w10})`);
const r = await Promise.all(['.toolbar button.timer.clock', '.toolbar button.timer.prep', '.toolbar .end button:not(.timer)'].map((s) => k.page.locator(s).boundingBox()));
k.want(r[1].x > r[0].x && r[2].x > r[0].x && r[2].y < r[1].y, 'Send and Prep stack beside the timer');
const t = await k.page.locator('.toolbar').boundingBox();
await k.page.screenshot({ path: `${k.out}/01-send-and-prep.png`, clip: { x: t.x + t.width - 420, y: t.y, width: 420, height: t.height } });
await k.done();

const l = await openFalcon('timer-button-light', { storage: { 'falcon.theme': 'light' } });
l.want(await l.page.evaluate(() => document.documentElement.dataset.chrome) === 'light', 'the light theme is on');
const lb = l.page.locator('.toolbar button.timer.clock');
l.want(await lb.evaluate((x) => getComputedStyle(x.querySelector('svg')).color === getComputedStyle(x).color), 'the icon matches the clock text');
const lt = await l.page.locator('.toolbar').boundingBox();
await l.page.screenshot({ path: `${l.out}/01-light.png`, clip: { x: lt.x + lt.width - 420, y: lt.y, width: 420, height: lt.height } });
await l.done();
