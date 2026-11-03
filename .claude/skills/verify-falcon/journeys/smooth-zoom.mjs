// Smooth zoom: a trackpad pinch (a wheel event with ctrlKey and no Ctrl held) zooms with no steps and keeps the
// line under the fingers still, keys glide to the next 10%, Cmd-+ works, and the % in the status bar catches up.
import { openFalcon, SEED, MOD } from '../lib/falcon.mjs';
const f = await openFalcon('smooth-zoom', { viewport: { width: 1440, height: 860 } });
const p = f.page;
await f.open(SEED);
const z = () => p.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue('--zoom')));
const pct = () => p.$eval('.status .zoom', (b) => b.textContent);
const line = await p.locator('.ProseMirror :text("Global growth")').first().boundingBox();
const x = line.x + 30, y = line.y + line.height / 2;
const at = () => p.locator('.ProseMirror :text("Global growth")').first().boundingBox();

// pinch out a little at a time, like a real gesture
const pinch = (dy, n) => p.evaluate(async ([dy, n, x, y]) => {
  const t = document.elementFromPoint(x, y);
  for (let i = 0; i < n; i++) {
    t.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    await new Promise((r) => requestAnimationFrame(r));
  }
}, [dy, n, x, y]);
await pinch(-3, 10);
const z1 = await z();
f.want(z1 > 1.3 && z1 < 1.4, `a pinch zooms in without 10% steps (${z1.toFixed(3)})`);
const b1 = await at();
f.want(Math.abs(b1.y + b1.height / 2 - y) < 6, `the line under the fingers stays put (${(b1.y + b1.height / 2).toFixed(1)} vs ${y.toFixed(1)})`);
await p.waitForTimeout(350);
f.want(await pct() === `${Math.round(z1 * 100)}%`, `the status bar catches up once the pinch stops (${await pct()})`);
await f.shot('pinched-in');
await pinch(4, 20);
f.want(await z() < 1, `pinching in zooms out (${(await z()).toFixed(3)})`);
await p.waitForTimeout(350);

// keys: Mod-0 glides back to 100%, Mod-= and Mod-+ go up 10% each, quick presses add up
await p.click('.ProseMirror');
await p.keyboard.press(`${MOD}+0`); await p.waitForTimeout(60);
const mid = await z();
await p.waitForTimeout(300);
f.want(await z() === 1 && await pct() === '100%', `Mod-0 goes back to 100% (mid-glide it was ${mid.toFixed(3)})`);
await p.keyboard.press(`${MOD}+Equal`); await p.keyboard.press(`${MOD}+Equal`); await p.waitForTimeout(300);
f.want(await z() === 1.2, `two quick Mod-= land on 120% (${await z()})`);
await p.keyboard.press(`${MOD}+Shift+Equal`); await p.waitForTimeout(300);
f.want(await z() === 1.3 && await pct() === '130%', `Mod-+ zooms in too (${await z()})`);
await p.keyboard.press(`${MOD}+Minus`); await p.waitForTimeout(300);
f.want(await z() === 1.2, `Mod-- zooms out (${await z()})`);

// a real Ctrl held with the wheel is a mouse, not a pinch: off by default
await p.keyboard.down('Control');
await pinch(-30, 3);
await p.keyboard.up('Control');
f.want(await z() === 1.2, `Ctrl and the mouse wheel do nothing with the setting off (${await z()})`);
await f.done();
